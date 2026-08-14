// conductor/tests/e2e.test.ts — Task 13.1 (plan lines 2916-2960): the scripted
// end-to-end acceptance suite. No model, no opencode server, no network.
//
// WHAT IS REAL HERE, and it is nearly everything. Each scenario drives the REAL
// plugin factory (conductor/plugin/index.ts) for the hooks a live session uses —
// `chat.message` creates the run, `tool.execute.before` adjudicates every gate —
// and the REAL handler layer (adapter/tools.ts) for the §3.3 stages, against a
// REAL git repository in a temp dir with a REAL Node test suite that really goes
// red and really goes green. The state store, the evidence ledger, the journal,
// the decision ledger, the questions ledger, the quarantine and the git commits
// are all the shipped code writing real bytes.
//
// THE ONE FAKE is the opencode SDK (tests/fixtures/fake-sdk.ts): sub-sessions do
// not run a model. In its place each scenario installs a SCRIPTED RESPONDER whose
// replies are schema-valid §2.10 payloads AND WHOSE SIDE EFFECTS ARE REAL — when
// the fan-out engine prompts a `testWriter`, the responder writes the item's test
// file to disk; when it prompts an `implementer`, the responder writes the
// module. Nothing tells the handlers that the work happened: they re-derive it by
// SPAWNING the repo's own test command and reading its exit code (G6). That is
// what makes a green here a measured green rather than a claimed one — a
// responder that lies about having written the file produces a red the pipeline
// refuses to advance past, which is exactly the property this suite exists to
// prove end to end.
//
// The responder discriminates by the §3.5 REGISTRY ROLE the engine writes before
// the first prompt, and — where one role serves two stages (a `reviewer` vets a
// test at RED and reviews an item at VALIDATED) — by the item's own persisted FSM
// position at the instant of the prompt. It never keys on prompt wording, so a
// reworded doctrine pack cannot silently re-route a reply.
//
// The five scenarios (plan lines 2916-2957), each a `test()` whose name carries
// the scenario token the §11 acceptance checker greps for in the TAP output:
//
//   full-pipeline   intake -> classify -> decompose(2) -> plan -> plan review
//                   (a major refuted, a major upheld -> revision -> clean round)
//                   -> wave dispatch -> both items through the whole item FSM to
//                   a REAL commit -> report -> stop done. Along the way every
//                   §3.5 gate denial the plan names, and an override that is
//                   spent and then visible in the report.
//   trivial         classified trivial with a full §2.10 trivialItem, ridden
//                   through EXECUTING(trivial) to report-lite and TRIVIAL_DONE.
//   worktree        a two-item wave under parallel.writes "worktrees": both
//                   implement in OUT-OF-REPO worktrees, merge back serially, and
//                   are re-validated after the merge.
//   non-behavioral  a docs-only item (behavioral:false) walks to PUBLISHED with
//                   no test ever written, and a second item claiming
//                   behavioral:false over src/** is REJECTED at decompose naming
//                   the intersecting glob.
//   bad-ending      conductor_report REFUSES to close a run whose items are
//                   still PENDING; an item then blocks on exhausted test repair;
//                   the run closes with that block DISCLOSED — the closing verify
//                   excludes the unevaluable test and REGISTERS the exclusion on
//                   the §2.11 stale-red registry — and a SECOND run in the same
//                   repo publishes an item on a green full verify that names the
//                   exclusion it rests on, instead of dying on a leftover red no
//                   later item owns.
//
// TWO BEHAVIOURS THIS SUITE MEASURED AND THE PLAN SKETCHED DIFFERENTLY, recorded
// here rather than smoothed over:
//   * `blocked` is a FINAL disposition, so conductor_report closes a run holding
//     a blocked item rather than refusing it. The refusal the plan describes is
//     real, but it fires on UNSETTLED work (items still PENDING), which is what
//     scenario 5 asserts.
//   * The wave driver does NOT itself recover an item stranded by a sibling's
//     commit. When one member publishes, HEAD moves and every sibling's green
//     fails §2.6 condition 2; publish refuses it by name, and the REVIEWED->GREEN
//     drop back to re-validation is left to the orchestrator. Scenario 1 asserts
//     the refusal, and `drainWaves` performs the documented recovery.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ConductorPlugin } from "../plugin/index.ts";
import {
  handleClassify,
  handleDecompose,
  demoteReviewedToGreen,
  handleDispatchWave,
  handleOverride,
  handlePlan,
  handlePlanReview,
  handlePublish,
  handleReport,
} from "../adapter/tools.ts";
import type { OverrideGrant } from "../adapter/tools.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout } from "../adapter/fanout.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import type { Config, EvidenceRecord, Item, Run } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Structural mirrors of the opencode hook shapes (the composition.test.ts
// convention: kept local so this file runs under Node type-stripping and under
// bun, and the installed 1.18.15 d.ts stays the source they mirror).
// ---------------------------------------------------------------------------

interface ChatMessageHookInput {
  sessionID: string;
  agent?: string;
  messageID?: string;
}
interface ChatMessageHookOutput {
  message: Record<string, unknown>;
  parts: Array<Record<string, unknown>>;
}
interface ToolBeforeHookInput {
  tool: string;
  sessionID: string;
  callID: string;
}
interface ToolBeforeHookOutput {
  args: Record<string, unknown>;
}
interface PluginHooks {
  tool?: Record<string, unknown>;
  "tool.execute.before"?: (i: ToolBeforeHookInput, o: ToolBeforeHookOutput) => Promise<void> | void;
  "chat.message"?: (i: ChatMessageHookInput, o: ChatMessageHookOutput) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const doctrineDir = path.resolve(testsDir, "..", "doctrine");

// The REAL doctrine packs, read off disk. handleValidate refuses to dispatch a
// DEBUG fix without debug.md, so a scenario that hands over an empty pack set is
// testing a configuration nobody ships.
const PACKS: Record<string, string> = {};
for (const name of readdirSync(doctrineDir)) {
  if (name.endsWith(".md")) PACKS[name.slice(0, -3)] = readFileSync(path.join(doctrineDir, name), "utf8");
}

const ORCH = "ses_e2e_orchestrator";
const STRAY = "ses_e2e_stray";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-e2e-${tag}-`));
  tmpDirs.push(dir);
  return realpathSync(dir);
}

// Hermetic git: no global or system config can leak into a fixture.
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor E2E",
  GIT_AUTHOR_EMAIL: "conductor-e2e@example.invalid",
  GIT_COMMITTER_NAME: "Conductor E2E",
  GIT_COMMITTER_EMAIL: "conductor-e2e@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// A committed fixture repo with the layout the scenarios script against: src/ for
// behavioral code, tests/ for the item tests the pipeline writes, docs/ for the
// non-behavioral path. The author identity goes into the repo's OWN config too,
// because the handlers' commits run under adapter/gitio.ts's environment rather
// than under this file's GIT_ENV.
function fixtureRepo(tag: string): string {
  const dir = scratch(tag);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor E2E"]);
  git(dir, ["config", "user.email", "conductor-e2e@example.invalid"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  writeFileSync(path.join(dir, "docs", "guide.md"), "# guide\n\nplaceholder.\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function commitSubjects(dir: string): string[] {
  return git(dir, ["log", "--pretty=%s"]).split("\n").filter((l) => l.trim().length > 0);
}

// Every path the PIPELINE committed: everything from the fixture's last commit
// to HEAD. Publishes land one commit per item and the stale-publish recovery can
// add more, so a fixed HEAD/HEAD~1 window would silently stop looking at the
// commit it was written to inspect; and starting from the fixture baseline keeps
// the seed commits out, so "nothing outside scope shipped" means what it says.
function publishedFiles(dir: string, since: string): string[] {
  return git(dir, ["log", "--pretty=format:", "--name-only", `${since}..HEAD`])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The fixture repo's own verify command. A GLOB positional, never a bare
// directory: `node --test tests/` reports a bogus failing test on node 26.x, and
// a suite that is red for a reason the pipeline did not cause proves nothing.
const VERIFY_CMD = [process.execPath, "--test", "tests/*.test.ts"];

interface ConfigOpts {
  writes?: Config["parallel"]["writes"];
  behavioralPaths?: string[];
  testRepairAttempts?: number;
  maxOverridesPerItem?: number;
  maxOverridesPerRun?: number;
}

function makeConfig(opts: ConfigOpts = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        unit: {
          command: [...VERIFY_CMD],
          timeoutMs: 120_000,
          itemTest: [process.execPath, "--test", "{files}"],
        },
      },
      behavioralPaths: opts.behavioralPaths ?? ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 2,
      planReviewMaxRounds: 3,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 2,
      vetCritics: 1,
      vetMaxRounds: 2,
      testRepairAttempts: opts.testRepairAttempts ?? 2,
      debugFixCap: 2,
      maxOverridesPerItem: opts.maxOverridesPerItem ?? 1,
      maxOverridesPerRun: opts.maxOverridesPerRun ?? 1,
    },
    parallel: {
      writes: opts.writes ?? "off",
      maxImplementers: 2,
      maxReaders: 2,
      subSessionTimeoutMs: 120_000,
    },
    models: { default: "e2e-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// The plugin loads config from the repo's own .conductor/config.json, so the gate
// hook adjudicates under the SAME config the handlers use. Written before the
// plugin is constructed and committed, so it is never run-start dirt.
function writeRepoConfig(root: string, config: Config): void {
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  git(root, ["add", "-f", ".conductor/config.json"]);
  git(root, ["commit", "-m", "conductor config"]);
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

interface Rec {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}
interface JournalCapture {
  records: Rec[];
  sink: {
    log: (
      level: string,
      component: string,
      event: string,
      data: Record<string, unknown>,
      corr: { runId?: string; itemId?: string; sessionID?: string },
    ) => void;
    flushSync: () => void;
  };
}

function makeJournal(): JournalCapture {
  const records: Rec[] = [];
  return {
    records,
    sink: {
      log(level, component, event, data, corr): void {
        records.push({ level, component, event, data, corr });
      },
      flushSync(): void {
        /* nothing buffered */
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The scripted responder
// ---------------------------------------------------------------------------

// What a scenario tells the fake sub-session layer to DO for one prompt. The
// `write` side effects are how a fake sub-session does real work.
interface Reply {
  body: unknown;
  write?: Array<{ rel: string; text: string }>;
}

interface RespondCtx {
  role: string;
  itemId: string;
  itemState: string;
  nth: number;
  text: string;
  // The §3.5 tree the engine resolved for this sub-session. Under
  // parallel.writes "worktrees" it is an OUT-OF-REPO worktree, not the repo
  // root, and a responder that wrote to the root instead would make the
  // merge-back a no-op and the worktree scenario vacuous.
  tree: string;
}

type Script = (ctx: RespondCtx) => Reply;

const OK_CRITERION = { pass: true, note: "measured against the acceptance line" };
function testVet(mustFix: string[] = []): unknown {
  return {
    verdictsByCriterion: {
      observableBehavior: OK_CRITERION,
      wouldCatchWrongImpl: OK_CRITERION,
      rightLevel: OK_CRITERION,
      pinsAcceptance: OK_CRITERION,
      antiPatterns: OK_CRITERION,
    },
    mustFix,
  };
}

function done(summary: string): unknown {
  return { status: "DONE", summary, concerns: [], neededContext: null, blockReason: null };
}

function noFindings(): unknown {
  return { findings: [] };
}

interface Wiring {
  fanout: Fanout;
  sdk: ReturnType<typeof makeFakeSdk>;
  prompted: RespondCtx[];
  treeState: { isFrozen: (t: string) => boolean; onClear: (f: (t: string) => void) => () => void; notifyClear: (t: string) => void };
  byRole: (role: string) => RespondCtx[];
}

// Build the fan-out engine over the fake SDK with a scripted responder. Every
// prompt is recorded with the role, the item and the item's PERSISTED FSM
// position at prompt time, which is both the scenario's routing key and the
// witness the ordering assertions read.
function makeWiring(
  store: StateStore,
  runId: string,
  root: string,
  config: Config,
  journal: JournalCapture,
  script: Script,
): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: string }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: RespondCtx[] = [];
  const counts = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    const itemId = req.entry?.itemId ?? "";
    let itemState = "";
    if (itemId.length > 0) {
      try {
        itemState = store.loadItem(runId, itemId).state;
      } catch {
        itemState = "";
      }
    }
    const key = `${role}::${itemId}`;
    const nth = counts.get(key) ?? 0;
    counts.set(key, nth + 1);
    const treeRaw = req.entry?.tree;
    const tree = typeof treeRaw === "string" && treeRaw.length > 0 && existsSync(treeRaw) ? treeRaw : root;
    const ctx: RespondCtx = { role, itemId, itemState, nth, text: req.text, tree };
    prompted.push(ctx);
    const reply = script(ctx);
    for (const w of reply.write ?? []) {
      const abs = path.join(tree, w.rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, w.text);
    }
    return { kind: "reply", text: JSON.stringify(reply.body) };
  });

  const listeners: Array<(t: string) => void> = [];
  const treeState = {
    isFrozen: (): boolean => false,
    onClear: (listener: (t: string) => void): (() => void) => {
      listeners.push(listener);
      return (): void => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    notifyClear: (t: string): void => {
      for (const l of [...listeners]) l(t);
    },
  };

  const fanout = createFanout(
    sdk.client,
    config,
    journal.sink as unknown as Parameters<typeof createFanout>[2],
    registry,
    treeState,
    runId,
  );
  return { fanout, sdk, prompted, treeState, byRole: (r) => prompted.filter((p) => p.role === r) };
}

// ---------------------------------------------------------------------------
// Driving the real plugin
// ---------------------------------------------------------------------------

function pluginInput(directory: string): unknown {
  return {
    client: {},
    project: { id: "prj_e2e", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: (): undefined => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: (): undefined => undefined,
  };
}

async function startPlugin(directory: string): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(pluginInput(directory));
}

async function sendPrompt(hooks: PluginHooks, sessionID: string, text: string): Promise<void> {
  const hook = hooks["chat.message"];
  assert.equal(typeof hook, "function", "the plugin must expose chat.message or no run is ever created");
  await (hook as (i: ChatMessageHookInput, o: ChatMessageHookOutput) => Promise<void>)(
    { sessionID, agent: "conductor", messageID: "msg_e2e" },
    {
      message: { id: "msg_e2e", sessionID, role: "user", time: { created: 1_754_560_000_000 } },
      parts: [{ id: "prt_0", type: "text", text }],
    },
  );
}

async function callGate(
  hooks: PluginHooks,
  input: { tool: string; sessionID: string; args: Record<string, unknown> },
): Promise<void> {
  const hook = hooks["tool.execute.before"];
  assert.equal(typeof hook, "function", "the plugin must keep its tool.execute.before gate hook");
  await (hook as (i: ToolBeforeHookInput, o: ToolBeforeHookOutput) => Promise<void>)(
    { tool: input.tool, sessionID: input.sessionID, callID: "call_e2e" },
    { args: input.args },
  );
}

// Await a call that MUST deny, handing the Error back so the caller asserts on
// what the refusal names. Non-vacuous: a call that did not throw fails here.
async function expectDeny(fn: () => Promise<void>, ctx: string): Promise<Error> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert.equal(threw, true, `${ctx}: the call was ALLOWED; a gate that never denies is not a gate`);
  assert.ok(caught instanceof Error, `${ctx}: denial must be a thrown Error (opencode reads its message back to the model)`);
  return caught as Error;
}

// ---------------------------------------------------------------------------
// Bench: one fixture repo, one live run, one fan-out engine
// ---------------------------------------------------------------------------

interface Bench {
  root: string;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  journal: JournalCapture;
  wiring: Wiring;
  hooks: PluginHooks;
  // The repo's HEAD before the run existed: the baseline every publish assertion
  // measures against.
  baseCommit: string;
}

interface BenchOpts {
  tag: string;
  prompt: string;
  config?: Config;
  script: Script;
  seed?: (root: string) => void;
}

// The run is created by the REAL chat.message hook — the same path a live session
// takes — and only then does the test open its own store over the same root to
// drive the handler layer. The plugin's store released nothing, so both views
// read and write the same files; the lock is per-workspace and re-entrant for the
// session that holds it, which is why both use ORCH.
async function makeBench(opts: BenchOpts): Promise<Bench> {
  const config = opts.config ?? makeConfig();
  const root = fixtureRepo(opts.tag);
  if (opts.seed !== undefined) {
    opts.seed(root);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "fixture seed"]);
  }
  writeRepoConfig(root, config);

  const baseCommit = git(root, ["rev-parse", "HEAD"]).trim();
  const hooks = await startPlugin(root);
  await sendPrompt(hooks, ORCH, opts.prompt);

  const journal = makeJournal();
  const store = openWorkspace({
    root,
    config,
    journal: journal.sink,
    version: "0.1.0-e2e",
    sessionID: ORCH,
    now: () => Date.now(),
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  });
  const run = store.currentRun();
  assert.ok(run !== null, "the real chat.message hook must have created a run");
  const runId = (run as Run).runId;
  const runDir = path.join(root, ".conductor", "runs", runId);
  const wiring = makeWiring(store, runId, root, config, journal, opts.script);
  return {
    root,
    stateHome: scratch(`${opts.tag}-state`),
    store,
    runId,
    runDir,
    config,
    journal,
    wiring,
    hooks,
    baseCommit,
  };
}

// Re-point a bench at a NEW run in the same workspace, with its own scripted
// sub-session layer. The store, the repo and the plugin are the SAME ones — that
// is the whole point of the second run in scenario 5: it inherits the first
// run's leftovers.
function rebind(b: Bench, runId: string, script: Script): Bench {
  const journal = makeJournal();
  return {
    ...b,
    runId,
    runDir: path.join(b.root, ".conductor", "runs", runId),
    journal,
    wiring: makeWiring(b.store, runId, b.root, b.config, journal, script),
  };
}

function stageBase(b: Bench): {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  config: Config;
  journal: JournalCapture["sink"];
  sessionID: string;
} {
  return {
    store: b.store,
    fanout: b.wiring.fanout,
    runId: b.runId,
    config: b.config,
    journal: b.journal.sink,
    sessionID: ORCH,
  };
}

function waveArgs(b: Bench): Parameters<typeof handleDispatchWave>[0] {
  return {
    store: b.store,
    fanout: b.wiring.fanout,
    treeState: b.wiring.treeState,
    runId: b.runId,
    config: b.config,
    journal: b.journal.sink,
    stateHome: b.stateHome,
    workspaceKey: "e2e",
    packs: PACKS,
  } as unknown as Parameters<typeof handleDispatchWave>[0];
}

function reportArgs(b: Bench): Parameters<typeof handleReport>[0] {
  return {
    store: b.store,
    fanout: b.wiring.fanout,
    runId: b.runId,
    config: b.config,
    journal: b.journal.sink,
    stateHome: b.stateHome,
    workspaceKey: "e2e",
  } as unknown as Parameters<typeof handleReport>[0];
}

// Drive dispatch_wave until every item is settled or the driver stops making
// progress. A live session re-enters through the §3.7 continuation engine for
// exactly this reason: publishing serializes, so a wave whose first member
// commits leaves the second needing a fresh validate against the new HEAD.
async function drainWaves(
  b: Bench,
  max = 8,
): Promise<Awaited<ReturnType<typeof handleDispatchWave>>> {
  let last = await handleDispatchWave(waveArgs(b));
  for (let i = 1; i < max; i += 1) {
    if (last.items.every((d) => d.state === "PUBLISHED" || d.blocked !== null || d.deferred !== null)) break;
    // THE STALE-PUBLISH RECOVERY, performed here because the wave driver leaves
    // it to the orchestrator. When a wave member commits, HEAD moves, and every
    // sibling's green was measured on the previous tree — §2.6 condition 2, and
    // publish refuses it by design ("a green produced on one tree is not a green
    // on another"). The sanctioned way back is the ONE administrative
    // REVIEWED->GREEN drop publish itself uses, after which the next wave
    // re-validates and re-reviews the item against the tree that now exists.
    // Scenario 1 asserts the refusal itself before ever calling this.
    let recovered = false;
    for (const d of last.items) {
      if (d.state !== "REVIEWED" || d.stoppedAt === null) continue;
      demoteReviewedToGreen({
        store: b.store,
        runId: b.runId,
        itemId: d.itemId,
        journal: b.journal.sink,
        reason: "a sibling's publish moved HEAD after this item's verify",
        hypothesis: "re-validate against the integrated tree (§2.6 condition 2)",
      } as unknown as Parameters<typeof demoteReviewedToGreen>[0]);
      recovered = true;
    }
    let next: Awaited<ReturnType<typeof handleDispatchWave>>;
    try {
      next = await handleDispatchWave(waveArgs(b));
    } catch {
      break; // the phase gate closed the wave: every item is settled
    }
    last = next;
    if (!recovered && last.items.every((d) => d.stoppedAt !== null && d.state !== "PUBLISHED")) {
      // No item moved and nothing was recovered: another dispatch changes nothing.
      break;
    }
  }
  return last;
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvidenceRecord);
}

function readAnomalies(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "anomalies.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function itemOf(b: Bench, id: string): Item {
  return b.store.loadItem(b.runId, id);
}

// ---------------------------------------------------------------------------
// Payload builders shared by the scenarios
// ---------------------------------------------------------------------------

function queueItem(over: {
  id: string;
  title: string;
  fileScope: string[];
  testScope: string[];
  behavioral?: boolean;
  dependsOn?: string[];
  acceptance?: string[];
}): unknown {
  return {
    id: over.id,
    title: over.title,
    rationale: `the prompt asks for ${over.title}`,
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: over.acceptance ?? [`${over.title} behaves as specified`],
    behavioral: over.behavioral ?? true,
    dependsOn: [...(over.dependsOn ?? [])],
    ponytail: {
      necessary: "the user's prompt asks for it",
      reuse: "checked the existing modules; nothing covers this",
      ladderRung: "minimal-code",
    },
  };
}

// The item test the fake testWriter writes: it imports the module the item is
// contracted to build, so its FIRST failure is a missing-subject red (§2.6.1) and
// its second is a real assertion once the module exists but is wrong.
function itemTestSource(subject: string, call: string, expected: string): string {
  return (
    `import test from "node:test";\n` +
    `import assert from "node:assert/strict";\n` +
    `import { fn } from "../${subject}";\n\n` +
    `test("${subject} behaves", () => {\n` +
    `  assert.equal(fn(${call}), ${expected});\n` +
    `});\n`
  );
}

// ===========================================================================
// Scenario 1 — full-pipeline
// ===========================================================================

test(
  "[13.1-full-pipeline] the whole §3.2/§3.3 pipeline on a real fixture repo: the real chat.message hook creates the run, classify/decompose/plan/plan-review run through the real fan-out engine (a major refuted, a major upheld and revised to a clean round), the wave drives TWO items through the entire item FSM to REAL git commits whose contents are asserted, an override is spent and surfaces in the report, every gate denial the plan names really denies, and conductor_report closes the run done",
  { timeout: 120_000 },
  async () => {
    // The two items: disjoint scopes, so the scheduler runs them in one wave.
    const QUEUE = {
      items: [
        queueItem({
          id: "I1",
          title: "slugify",
          fileScope: ["src/slug.ts"],
          testScope: ["tests/slug.test.ts"],
          acceptance: ['slugify("A B") === "a-b"'],
        }),
        queueItem({
          id: "I2",
          title: "titlecase",
          fileScope: ["src/title.ts"],
          testScope: ["tests/title.test.ts"],
          acceptance: ['titlecase("a b") === "A B"'],
        }),
      ],
    };

    const SUBJECT: Record<string, { file: string; testRel: string; call: string; expected: string; impl: string }> = {
      I1: {
        file: "src/slug.ts",
        testRel: "tests/slug.test.ts",
        call: '"A B"',
        expected: '"a-b"',
        impl: 'export function fn(s) { return s.toLowerCase().split(" ").join("-"); }\n',
      },
      I2: {
        file: "src/title.ts",
        testRel: "tests/title.test.ts",
        call: '"a b"',
        expected: '"A B"',
        impl:
          'export function fn(s) { return s.split(" ").map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" "); }\n',
      },
    };

    // The plan-review round trip: round 1 raises two majors, the skeptic refutes
    // the first and upholds the second; the revision answers it and round 2 is
    // clean. `planRound` counts reviewer waves so the script is a real sequence
    // rather than a constant.
    let planRound = 0;

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return {
          body: {
            kind: "work",
            rationale: "two behavioural additions with tests",
            confidence: "high",
            trivialItem: null,
          },
        };
      }
      if (ctx.role === "planner") {
        // The first planner prompt is decompose (schema Queue); every later one
        // is plan or plan revision (schema Plan).
        if (ctx.nth === 0) return { body: QUEUE };
        return {
          body: {
            markdown:
              planRound === 0
                ? "# plan\n\nBuild slugify, then titlecase.\n"
                : "# plan\n\nBuild slugify, then titlecase. Both are pure functions with no shared state, which is the revision the upheld finding asked for.\n",
            decisions: [],
          },
        };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") {
        // Plan review. Round 1: two majors. Round 2 (after the revision): clean.
        if (planRound === 0) {
          return {
            body: {
              findings: [
                {
                  id: "PF1",
                  severity: "major",
                  lens: "scope",
                  claim: "the two items share a helper and cannot parallelize",
                  evidence: "both titles mention string handling",
                  suggestedFix: "serialize them",
                },
                {
                  id: "PF2",
                  severity: "major",
                  lens: "plan-completeness",
                  claim: "the plan never says the two functions are independent",
                  evidence: "the markdown lists them without stating their relationship",
                  suggestedFix: "state that they share no state",
                },
              ],
            },
          };
        }
        return { body: noFindings() };
      }
      if (ctx.role === "skeptic") {
        // The classification check is the only skeptic before any finding exists.
        if (ctx.text.includes("PF1")) {
          return { body: { findingId: "PF1", upheld: false, reasoning: "the scopes are disjoint; the claim reads titles, not scopes" } };
        }
        if (ctx.text.includes("PF2")) {
          return { body: { findingId: "PF2", upheld: true, reasoning: "the plan really is silent on independence" } };
        }
        if (ctx.text.includes("IF1")) {
          return { body: { findingId: "IF1", upheld: false, reasoning: "the module already handles the case the finding claims is missing" } };
        }
        return { body: { agreed: true, correctedKind: null, note: "a behavioural change with tests" } };
      }
      const subject = SUBJECT[ctx.itemId];
      if (ctx.role === "testWriter" && subject !== undefined) {
        return {
          body: done(`wrote ${subject.testRel}`),
          write: [
            {
              rel: subject.testRel,
              text: itemTestSource(subject.file, subject.call, subject.expected),
            },
          ],
        };
      }
      if (ctx.role === "implementer" && subject !== undefined) {
        return { body: done(`wrote ${subject.file}`), write: [{ rel: subject.file, text: subject.impl }] };
      }
      if (ctx.role === "reviewer" && subject !== undefined) {
        // One role, two stages: a RED item is being test-vetted, a VALIDATED one
        // is being reviewed. The item's own persisted FSM position decides.
        if (ctx.itemState === "RED") return { body: testVet() };
        if (ctx.itemId === "I1" && ctx.nth === 1) {
          return {
            body: {
              findings: [
                {
                  id: "IF1",
                  severity: "major",
                  lens: "correctness",
                  claim: "the function drops interior whitespace",
                  evidence: "no test covers a double space",
                  suggestedFix: "collapse runs of whitespace",
                },
              ],
            },
          };
        }
        return { body: noFindings() };
      }
      return { body: done("no work required") };
    };

    const bench = await makeBench({
      tag: "full",
      prompt: "add slugify and titlecase utilities with tests",
      script,
    });

    // --- the gate hook really gates -----------------------------------------
    // An UNREGISTERED session's write is denied: the registry is the plugin's
    // own, and nothing has registered the stray session.
    const strayDenial = await expectDeny(
      () => callGate(bench.hooks, { tool: "write", sessionID: STRAY, args: { filePath: path.join(bench.root, "src/slug.ts"), content: "x" } }),
      "an unregistered session's write",
    );
    assert.match(strayDenial.message, /regist/i, "the refusal must name the registry rule it enforced");

    // A sub-agent spawn is denied outright: conductor owns dispatch (§3.5).
    const spawnDenial = await expectDeny(
      () => callGate(bench.hooks, { tool: "task", sessionID: ORCH, args: { description: "spawn a helper" } }),
      "an orchestrator sub-agent spawn",
    );
    assert.ok(spawnDenial.message.length > 0, "the spawn refusal must carry a reason");

    // The ORCHESTRATOR's own edit is denied while it holds no inline claim.
    const orchDenial = await expectDeny(
      () => callGate(bench.hooks, { tool: "edit", sessionID: ORCH, args: { filePath: path.join(bench.root, "src/slug.ts"), content: "x" } }),
      "an orchestrator edit with no inline claim",
    );
    assert.ok(orchDenial.message.length > 0, "the orchestrator-edit refusal must carry a reason");

    // --- an out-of-order stage tool is refused by the phase gate ------------
    await assert.rejects(
      async () => handlePlan({ ...stageBase(bench) }),
      /legal|INTAKE|classif/i,
      "conductor_plan before classify must be refused by the §3.2 phase gate",
    );

    // --- intake ------------------------------------------------------------
    const classified = await handleClassify({ ...stageBase(bench) });
    assert.equal(classified.kind, "work", "the scripted classifier and its skeptic agreed on `work`");

    const decomposed = await handleDecompose({ ...stageBase(bench) });
    assert.deepEqual([...decomposed.itemIds].sort(), ["I1", "I2"], "both items entered the queue");

    const planned = await handlePlan({ ...stageBase(bench) });
    assert.ok(existsSync(planned.planPath), "plan.md was really written to the run dir");

    const reviewed = await handlePlanReview({ ...stageBase(bench) });
    assert.equal(reviewed.runState, "PLAN_REVIEWED", "the plan review reached a clean round and advanced the run");
    assert.ok(reviewed.rounds >= 1, "the review really ran a revision round rather than passing on round 1");

    // The refuted finding cost no revision and the upheld one did: both verdicts
    // were really consulted.
    const skeptics = bench.wiring.byRole("skeptic");
    assert.ok(
      skeptics.some((s) => s.text.includes("PF1")) && skeptics.some((s) => s.text.includes("PF2")),
      "both plan-review majors went to a skeptic before either changed the plan",
    );

    // --- the wave ----------------------------------------------------------
    planRound = 1;
    const firstWave = await handleDispatchWave(waveArgs(bench));
    assert.equal(firstWave.runState, "EXECUTING", "the first dispatch performed PLAN_REVIEWED -> EXECUTING");

    // §2.6 condition 2, end to end and measured: the first member of the wave
    // commits, HEAD moves, and the sibling's green — which really was green, on
    // the tree that existed when it ran — is refused. This is the condition a
    // `git switch` between validate and publish also produces, and the reason
    // the freshness rule carries a head term at all.
    const laggard = firstWave.items.find((d) => d.state !== "PUBLISHED");
    assert.ok(laggard !== undefined, "one member of a two-item wave publishes first and strands the other on a stale green");
    const staleDenial = await handlePublish({
      store: bench.store,
      fanout: bench.wiring.fanout,
      runId: bench.runId,
      itemId: (laggard as { itemId: string }).itemId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "e2e",
    } as unknown as Parameters<typeof handlePublish>[0]);
    assert.equal(staleDenial.ok, false, "publishing on a verify measured before a sibling's commit must be REFUSED");
    assert.match(
      String(staleDenial.denial),
      /HEAD is now/,
      "the refusal must name the head mismatch, not merely say `stale` — an operator has to know to re-validate",
    );

    const wave = await drainWaves(bench);
    for (const d of wave.items) {
      assert.equal(
        d.state,
        "PUBLISHED",
        `${d.itemId} must reach PUBLISHED; it stopped at ${String(d.stoppedAt)} (${String(d.envError)})`,
      );
    }

    // --- the evidence is measured, not claimed ------------------------------
    const evidence = readEvidence(bench.runDir);
    const reds = evidence.filter((r) => r.kind === "red");
    const greens = evidence.filter((r) => r.kind === "green");
    assert.ok(reds.length >= 2, "each behavioral item recorded a real red before any implementation existed");
    assert.ok(greens.length >= 2, "each behavioral item recorded a real green from a real spawn");
    assert.ok(
      reds.some((r) => (r as { failureClass?: string }).failureClass === "missing-subject"),
      "the greenfield first red is classified missing-subject (§2.6.1) — the legal red that makes greenfield TDD possible",
    );

    // --- the commits are real and carry the right contents ------------------
    const subjects = commitSubjects(bench.root);
    assert.ok(subjects.length >= 4, `two publishes on top of the two fixture commits (saw ${subjects.length})`);
    for (const s of subjects) {
      assert.equal(/Co-Authored-By|Generated with/i.test(s), false, `commit subject must be trailer-free: ${s}`);
    }
    const published = publishedFiles(bench.root, bench.baseCommit);
    assert.ok(published.includes("src/slug.ts") && published.includes("tests/slug.test.ts"), "I1's module and test both shipped");
    assert.ok(published.includes("src/title.ts") && published.includes("tests/title.test.ts"), "I2's module and test both shipped");
    assert.equal(published.includes("README.md"), false, "nothing outside the items' scopes was swept into a publish");

    // --- an override is spent, tainted and reported -------------------------
    const grants = new Map<string, OverrideGrant>();
    const override = await handleOverride({
      store: bench.store,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      sessionID: ORCH,
      itemId: "I1",
      gate: "publish-freshness",
      reason: "the operator accepts the stale window for this e2e",
      grantedAction: "conductor_publish I1",
      overrideGrants: grants,
      stateHome: bench.stateHome,
      workspaceKey: "e2e",
    } as unknown as Parameters<typeof handleOverride>[0]);
    assert.ok(override !== null, "the override handler returned a grant record");
    const anomalies = readAnomalies(bench.runDir);
    assert.ok(
      anomalies.some((a) => a.kind === "override"),
      "the override is recorded on the §2.8 anomaly ledger — the model's only fabrication path is a loud one",
    );

    // --- report -------------------------------------------------------------
    const report = await handleReport(reportArgs(bench));
    assert.equal(report.runState, "REPORTED", "conductor_report closed the run");
    const reportPath = path.join(bench.runDir, "report.md");
    assert.ok(existsSync(reportPath), "report.md was written");
    const md = readFileSync(reportPath, "utf8");
    assert.match(md, /I1/, "the report names the first item");
    assert.match(md, /I2/, "the report names the second item");
    assert.match(md, /override/i, "the spent override is visible in the report rather than buried in a ledger");

    const finalRun = bench.store.loadRun(bench.runId);
    assert.equal(finalRun.stop?.kind, "done", "the run's recorded stop is `done`");
  },
);

// ===========================================================================
// Scenario 2 — trivial
// ===========================================================================

test(
  "[13.1-trivial] a prompt classified `trivial` carries a complete §2.10 trivialItem, rides EXECUTING(trivial) through the whole item FSM with the merged lens set, and closes report-lite to TRIVIAL_DONE",
  { timeout: 120_000 },
  async () => {
    const TEST_REL = "tests/trim.test.ts";
    const FILE = "src/trim.ts";
    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return {
          body: {
            kind: "trivial",
            rationale: "a single pure helper with one acceptance line",
            confidence: "high",
            trivialItem: {
              title: "trim",
              rationale: "the caller needs a trimmed label",
              fileScope: [FILE],
              testScope: [TEST_REL],
              acceptance: ['fn(" a ") === "a"'],
              behavioral: true,
              ponytail: {
                necessary: "the prompt asks for it",
                reuse: "checked src/; nothing trims",
                ladderRung: "one-liner",
              },
            },
          },
        };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "one file, one function" } };
      if (ctx.role === "testWriter") {
        return {
          body: done("wrote the test"),
          write: [{ rel: TEST_REL, text: itemTestSource(FILE, '" a "', '"a"') }],
        };
      }
      if (ctx.role === "implementer") {
        return { body: done("wrote the module"), write: [{ rel: FILE, text: "export function fn(s) { return s.trim(); }\n" }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({ tag: "trivial", prompt: "trim the label", script });

    const classified = await handleClassify({ ...stageBase(bench) });
    assert.equal(classified.kind, "trivial", "the classifier and its skeptic agreed on `trivial`");
    assert.ok(typeof classified.itemId === "string" && classified.itemId.length > 0, "a trivial classification mints the single item");
    const itemId = classified.itemId as string;

    const wave = await drainWaves(bench);
    const disposition = wave.items.find((d) => d.itemId === itemId);
    assert.ok(disposition !== undefined, "the trivial item was scheduled");
    assert.equal(
      disposition?.state,
      "PUBLISHED",
      `the trivial item must reach PUBLISHED; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
    );

    const report = await handleReport(reportArgs(bench));
    assert.equal(report.runState, "TRIVIAL_DONE", "a trivial run closes report-lite to TRIVIAL_DONE, not REPORTED");
    const md = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
    assert.match(md, new RegExp(itemId), "the lite report still names the item it published");
    assert.equal(bench.store.loadRun(bench.runId).stop?.kind, "done", "the trivial run stopped done");
  },
);

// ===========================================================================
// Scenario 3 — worktrees
// ===========================================================================

test(
  "[13.1-worktree] a two-item wave under parallel.writes `worktrees`: both items implement concurrently in OUT-OF-REPO worktrees, merge back serially, and are re-validated after the merge — with the wave driver's interleaving read off the fan-out call log",
  { timeout: 180_000 },
  async () => {
    const SUBJECT: Record<string, { file: string; testRel: string; call: string; expected: string; impl: string }> = {
      W1: {
        file: "src/upper.ts",
        testRel: "tests/upper.test.ts",
        call: '"ab"',
        expected: '"AB"',
        impl: "export function fn(s) { return s.toUpperCase(); }\n",
      },
      W2: {
        file: "src/lower.ts",
        testRel: "tests/lower.test.ts",
        call: '"AB"',
        expected: '"ab"',
        impl: "export function fn(s) { return s.toLowerCase(); }\n",
      },
    };
    const QUEUE = {
      items: [
        queueItem({ id: "W1", title: "upper", fileScope: ["src/upper.ts"], testScope: ["tests/upper.test.ts"] }),
        queueItem({ id: "W2", title: "lower", fileScope: ["src/lower.ts"], testScope: ["tests/lower.test.ts"] }),
      ],
    };

    // Under `worktrees` the sub-session's tree is NOT the repo root. makeWiring
    // resolves the §3.5 tree the engine registered and writes there, so a
    // testWriter's file really lands in the out-of-repo worktree and only
    // reaches the repo through the merge-back.
    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "two independent helpers", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nTwo independent case helpers.\n", decisions: [] } };
      }
      const subject = SUBJECT[ctx.itemId];
      if (ctx.role === "testWriter" && subject !== undefined) {
        return {
          body: done(`wrote ${subject.testRel}`),
          write: [{ rel: subject.testRel, text: itemTestSource(subject.file, subject.call, subject.expected) }],
        };
      }
      if (ctx.role === "implementer" && subject !== undefined) {
        return { body: done(`wrote ${subject.file}`), write: [{ rel: subject.file, text: subject.impl }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("no work required") };
    };

    const config = makeConfig({ writes: "worktrees" });
    const bench = await makeBench({ tag: "worktree", prompt: "add upper and lower helpers", config, script });

    // The trees the engine handed the sub-sessions are recorded on every prompt;
    // at least one must be OUT of the repo, or the scenario is testing nothing.
    const treesSeen = new Set<string>();

    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });
    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });

    const wave = await drainWaves(bench);
    for (const p of bench.wiring.prompted) treesSeen.add(p.tree);
    assert.equal(wave.wave.parallel.length, 2, "both disjoint items were scheduled into ONE wave");
    assert.ok(
      [...treesSeen].some((t) => t !== bench.root && !t.startsWith(bench.root)),
      `at least one sub-session worked in an OUT-OF-REPO worktree (saw ${JSON.stringify([...treesSeen])})`,
    );
    for (const d of wave.items) {
      assert.equal(
        d.state,
        "PUBLISHED",
        `${d.itemId} must merge back and publish; it stopped at ${String(d.stoppedAt)} (${String(d.envError)})`,
      );
    }

    // Out-of-repo is the load-bearing half: a worktree inside .conductor/ would
    // be swept into the repo's own verify and its own commits.
    const worktreeRecords = bench.journal.records.filter((r) => JSON.stringify(r.data).includes("worktree"));
    assert.ok(worktreeRecords.length > 0, "the run journaled its worktree lifecycle");
    for (const id of ["W1", "W2"]) {
      const item = itemOf(bench, id);
      assert.equal(item.state, "PUBLISHED", `${id} is PUBLISHED in persisted state, not merely in the compact return`);
    }
    const published = publishedFiles(bench.root, bench.baseCommit);
    assert.ok(published.includes("src/upper.ts"), "W1's module reached the repo through the merge-back");
    assert.ok(published.includes("src/lower.ts"), "W2's module reached the repo through the merge-back");

    // The post-merge re-validation is what makes serial merge-back safe: each
    // item has a green recorded at or after its merge.
    const greens = readEvidence(bench.runDir).filter((r) => r.kind === "green");
    assert.ok(greens.length >= 2, "each merged item was re-validated against the merged tree");
  },
);

// ===========================================================================
// Scenario 4 — non-behavioral
// ===========================================================================

test(
  "[13.1-non-behavioral] a docs-only item declared behavioral:false walks PENDING -> GREEN -> VALIDATED -> REVIEWED -> PUBLISHED with no test ever written, while a second item claiming behavioral:false over src/** is REJECTED at decompose naming the intersecting glob — the change shape that had no legal trajectory, plus the arithmetic that keeps it from becoming a TDD bypass",
  { timeout: 120_000 },
  async () => {
    const ILLEGAL_QUEUE = {
      items: [
        queueItem({
          id: "D1",
          title: "document the guide",
          fileScope: ["docs/guide.md"],
          testScope: [],
          behavioral: false,
        }),
        queueItem({
          id: "D2",
          title: "quietly rewrite the parser",
          fileScope: ["src/parser.ts"],
          testScope: [],
          behavioral: false,
        }),
      ],
    };
    const LEGAL_QUEUE = { items: [ILLEGAL_QUEUE.items[0]] };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a documentation change", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "docs work is still work" } };
      if (ctx.role === "planner") {
        // The first decompose reply smuggles a behavioral:false item over
        // src/**; the guard rejects it and RE-PROMPTS, and the second reply
        // drops it. Two prompts, one rejection — the loop is the product.
        if (ctx.nth === 0) return { body: ILLEGAL_QUEUE };
        if (ctx.nth === 1) return { body: LEGAL_QUEUE };
        return { body: { markdown: "# plan\n\nRewrite the guide.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      if (ctx.role === "implementer") {
        return {
          body: done("rewrote the guide"),
          write: [{ rel: "docs/guide.md", text: "# guide\n\nThe rewritten guide body.\n" }],
        };
      }
      return { body: done("no test is required for a non-behavioral item") };
    };

    const bench = await makeBench({ tag: "nonbehavioral", prompt: "rewrite the docs guide", script });

    await handleClassify({ ...stageBase(bench) });

    // The illegal queue is REJECTED and the planner is RE-PROMPTED with a
    // rejection that NAMES the intersecting glob and the offending item — a
    // rejection a reader cannot act on is the same as no rejection. The guard is
    // a re-prompt loop rather than a throw, so the witness is the second prompt's
    // text, not an exception.
    const decomposed = await handleDecompose({ ...stageBase(bench) });
    const plannerPrompts = bench.wiring.byRole("planner");
    assert.ok(plannerPrompts.length >= 2, "the illegal queue cost a real re-prompt rather than being accepted");
    const rejectionText = plannerPrompts[1].text;
    assert.match(rejectionText, /D2/, "the rejection handed back to the planner names the offending item");
    assert.match(
      rejectionText,
      /src\/\*\*/,
      "the rejection names the verify.behavioralPaths glob the item's fileScope intersects",
    );
    assert.match(rejectionText, /behavioral/i, "the rejection names the rule it enforced");

    assert.deepEqual(decomposed.itemIds, ["D1"], "only the genuinely non-behavioral item survived");

    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });
    const wave = await drainWaves(bench);
    const d1 = wave.items.find((d) => d.itemId === "D1");
    assert.equal(
      d1?.state,
      "PUBLISHED",
      `the docs item must publish; it stopped at ${String(d1?.stoppedAt)} (${String(d1?.envError)})`,
    );

    // No test was ever written, and no red was ever recorded — that is the whole
    // point of the non-behavioral path.
    assert.equal(
      readEvidence(bench.runDir).some((r) => r.kind === "red"),
      false,
      "a non-behavioral item records no red: there is no test to fail",
    );
    assert.equal(
      bench.wiring.byRole("testWriter").length,
      0,
      "no test-writer sub-session was ever dispatched for the non-behavioral item",
    );
    assert.equal(existsSync(path.join(bench.root, "tests", "guide.test.ts")), false, "no test file was invented");

    const shipped = publishedFiles(bench.root, bench.baseCommit);
    assert.ok(shipped.includes("docs/guide.md"), "the docs change really shipped");
  },
);

// ===========================================================================
// Scenario 5 — the bad ending
// ===========================================================================

test(
  "[13.1-bad-ending] conductor_report REFUSES to close a run whose items are still unsettled; the item then BLOCKS on an exhausted test-repair budget and the run closes with that block DISCLOSED — the closing verify excludes the unevaluable test and REGISTERS the exclusion on the §2.11 stale-red registry — and a SECOND run in the same fixture repo publishes an item on a green full verify that names the exclusion it rests on, instead of dying on a leftover red no later item owns",
  { timeout: 180_000 },
  async () => {
    const BAD_TEST = "tests/broken.test.ts";
    // A test with a genuine syntax error: it cannot be evaluated at all, so
    // §2.6.1 classifies it `error` — never a legal red, however many times it is
    // repaired.
    const BROKEN_SOURCE = 'import test from "node:test";\ntest("broken", () => {\n  assert.equal(((;\n});\n';

    const QUEUE = {
      items: [queueItem({ id: "B1", title: "broken thing", fileScope: ["src/broken.ts"], testScope: [BAD_TEST] })],
    };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a behavioural change", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nBuild the broken thing.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
      if (ctx.role === "testWriter") {
        // Every repair attempt writes the same unevaluable test: the repair
        // budget really is exhausted rather than short-circuited.
        return { body: done("wrote the test"), write: [{ rel: BAD_TEST, text: BROKEN_SOURCE }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({
      tag: "badending",
      prompt: "build the broken thing",
      config: makeConfig({ testRepairAttempts: 1 }),
      script,
    });

    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });

    // conductor_report REFUSES while the run has unsettled work: closing a run is
    // a claim, and a claim over an item nobody has driven is the fabrication the
    // whole design exists to make impossible.
    await assert.rejects(
      async () => handleReport(reportArgs(bench)),
      /legal|settle|EXECUT|PLANNED|report/i,
      "conductor_report must refuse to close a run whose items are still PENDING",
    );

    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });

    const wave = await handleDispatchWave(waveArgs(bench));
    const d = wave.items.find((x) => x.itemId === "B1");
    assert.ok(d !== undefined, "the item was scheduled");
    assert.notEqual(d?.state, "PUBLISHED", "an item whose test never became a legal red must not publish");

    // The wave itself blocked the item and minted its question: a test whose
    // repair budget is exhausted is a question for a human, not a retry loop.
    const blockedItem = itemOf(bench, "B1");
    assert.ok(blockedItem.blocked !== null, "the item is BLOCKED after its repair budget was exhausted");
    const questionId = blockedItem.blocked?.questionId ?? "";
    assert.ok(questionId.length > 0, "the block carries a question id a human can answer");
    const ledger = readQuestions(bench.runDir);
    const question = ledger.find((q) => q.id === questionId);
    assert.ok(question !== undefined, "the blocking question is on the §2.11 ledger, not only in memory");
    assert.equal(question?.answeredIso, null, "it is genuinely unanswered — that is why the run cannot close cleanly");

    // The run CAN close, because `blocked` is a real final disposition — but it
    // closes with the failure disclosed rather than hidden: the closing verify
    // EXCLUDES the unevaluable test and the exclusion is written to the §2.11
    // stale-red registry, which is what stops it poisoning every later run.
    const report = await handleReport(reportArgs(bench));
    assert.equal(report.green, true, "the closing verify was green — with the dead test excluded, not with it pretended away");
    assert.ok(
      report.excluded.includes(BAD_TEST),
      `the closing verify excluded the unevaluable test (saw ${JSON.stringify(report.excluded)})`,
    );
    assert.ok(
      report.staleRedAdded.includes(BAD_TEST),
      "the exclusion was REGISTERED, not merely applied: a silent exclusion is indistinguishable from a green",
    );

    const md = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
    assert.match(md, /B1/, "the closing report names the item that never published");
    assert.match(md, new RegExp(questionId), "the report names the question id that blocked it");
    assert.match(md, new RegExp(BAD_TEST.replace(".", "\\.")), "the report names the excluded test file by path");

    assert.ok(
      readQuestions(bench.runDir).some((q) => q.id === questionId),
      "the question survives on the §2.11 ledger for the next run to read",
    );

    // --- the second run in the SAME repo ------------------------------------
    // The leftover unevaluable test is still on disk. Before the stale-red
    // registry existed, this repo was poisoned: every later run's verify died on
    // a file no later item owned. Now the next run walks a fresh item all the way
    // to PUBLISHED, which it can only do if its full verify was green.
    assert.ok(existsSync(path.join(bench.root, BAD_TEST)), "the leftover red test really is still on disk");
    const registry = bench.store.readStaleRed();
    assert.ok(
      JSON.stringify(registry).includes("broken"),
      "the leftover red test is on the §2.11 stale-red registry — the record that stops it poisoning later runs",
    );

    const GOOD_FILE = "src/good.ts";
    const GOOD_TEST = "tests/good.test.ts";
    const secondScript: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a fresh helper", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      if (ctx.role === "planner") {
        if (ctx.nth === 0) {
          return {
            body: {
              items: [
                queueItem({ id: "G1", title: "good", fileScope: [GOOD_FILE], testScope: [GOOD_TEST] }),
              ],
            },
          };
        }
        return { body: { markdown: "# plan\n\nA fresh helper in a repo with a known-dead test.\n", decisions: [] } };
      }
      if (ctx.role === "testWriter") {
        return {
          body: done("wrote the test"),
          write: [{ rel: GOOD_TEST, text: itemTestSource(GOOD_FILE, '"x"', '"X"') }],
        };
      }
      if (ctx.role === "implementer") {
        return { body: done("wrote the module"), write: [{ rel: GOOD_FILE, text: "export function fn(s) { return s.toUpperCase(); }\n" }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    await sendPrompt(bench.hooks, ORCH, "add a good helper with tests");
    const second = bench.store.currentRun();
    assert.ok(second !== null, "the second prompt created a second run");
    const secondRunId = (second as Run).runId;
    assert.notEqual(secondRunId, bench.runId, "it really is a NEW run, not the closed one re-entered");

    const bench2 = rebind(bench, secondRunId, secondScript);
    await handleClassify({ ...stageBase(bench2) });
    await handleDecompose({ ...stageBase(bench2) });
    await handlePlan({ ...stageBase(bench2) });
    await handlePlanReview({ ...stageBase(bench2) });
    const wave2 = await drainWaves(bench2);
    const g1 = wave2.items.find((x) => x.itemId === "G1");
    assert.equal(
      g1?.state,
      "PUBLISHED",
      `the second run publishes despite the leftover red on disk; it stopped at ${String(g1?.stoppedAt)} (${String(g1?.envError)})`,
    );

    // And the proof is in the second run's own evidence: a green FULL verify —
    // the run-wide one, not the item-targeted one — whose record names the file
    // it excluded. A verify that excluded nothing would have died on the leftover
    // test, and a verify that excluded silently would be indistinguishable from
    // one that narrowed the suite to hide a failure.
    const secondVerifies = readEvidence(bench2.runDir).filter((r) => r.kind === "verify");
    assert.ok(secondVerifies.length > 0, "the second run ran a real full verify of its own");
    const greenVerify = secondVerifies.find((r) => (r as { green?: boolean }).green === true);
    assert.ok(greenVerify !== undefined, "the second run's full verify was GREEN with the leftover red still on disk");
    assert.ok(
      JSON.stringify(greenVerify).includes("broken"),
      `the green verify DISCLOSES the exclusion it rests on (§2.11): ${JSON.stringify(greenVerify)}`,
    );

  },
);
