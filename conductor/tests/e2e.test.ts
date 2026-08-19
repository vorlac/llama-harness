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

import { test, after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
import { isTerminal } from "../core/stops.ts";
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
import { childEnv } from "../adapter/evidence.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { fetchMetricsSummary } from "../adapter/router-client.ts";
import type { MetricsSummary, RouterClientConfig } from "../adapter/router-client.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import { validate } from "../core/types.ts";
import type { Config, EvidenceRecord, Item, Run, TreePath } from "../core/types.ts";

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
interface BusEventHookInput {
  event: { type: string; properties?: Record<string, unknown> };
}
interface PluginHooks {
  tool?: Record<string, unknown>;
  "tool.execute.before"?: (i: ToolBeforeHookInput, o: ToolBeforeHookOutput) => Promise<void> | void;
  "chat.message"?: (i: ChatMessageHookInput, o: ChatMessageHookOutput) => Promise<void> | void;
  // The bus hook. `session.idle` and `permission.asked` arrive here and NOWHERE
  // else — the typed `permission.ask` plugin hook is never dispatched at
  // 1.18.15 — so this is the SOLE production entry to the §3.7 continuation
  // engine. A scenario that calls handleSessionIdle directly would prove the
  // engine works and prove nothing about whether anything ever reaches it.
  event?: (i: BusEventHookInput) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const doctrineDir = path.resolve(testsDir, "..", "doctrine");

// The REAL doctrine packs, read off disk, keyed the way the SHIPPED loader keys
// them — by FILE NAME, extension included (adapter/inject.ts loadPacks writes
// `packs[file]`, and the handlers read `packs["debug.md"]` /
// `packs["receive-review.md"]`). Keyed any other way this map is a set of packs
// no handler can find: handleValidate refuses to dispatch a DEBUG fix without
// debug.md and conductor_item_review refuses to dispatch a review fix without
// receive-review.md, so a scenario that hands over a map the handlers cannot
// read is testing a configuration nobody ships.
const PACKS: Record<string, string> = {};
for (const name of readdirSync(doctrineDir)) {
  if (name.endsWith(".md")) PACKS[name] = readFileSync(path.join(doctrineDir, name), "utf8");
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

// A git QUESTION, whose answer may legitimately be "no": `git cat-file -e
// <commit>:<path>` exits non-zero when that commit's tree does not carry the
// path, which is the whole point of asking.
function gitOk(dir: string, args: string[]): boolean {
  return (
    spawnSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8", stdio: "ignore" }).status === 0
  );
}

// The fixture's own BASELINE test and the subject module it measures. It exists so
// the scope glob below matches at least one file from the very first verify onward:
// `tests/` was created EMPTY, and on node 26.7.0 a glob matching zero files exits 0
// having run nothing, so every verify taken before the pipeline wrote its first test
// file was a vacuous green — an item could reach VALIDATED on a process structurally
// incapable of going red. This file makes the suite non-empty and, because it really
// imports a real subject, makes it DISCRIMINATE.
//
// It is committed in the fixture's OWN seed commit, so it can never be mistaken for
// pipeline output; it is in no item's fileScope and no item's testScope, so it is
// never quarantined, never excluded, and never part of any item's foreign-red set.
const BASELINE_TEST_REL = "tests/baseline.test.ts";
const BASELINE_SUBJECT_REL = "src/baseline.ts";
const BASELINE_SUBJECT = "export function baseline() {\n  return 'baseline';\n}\n";
const BASELINE_TEST_NAME = "the fixture baseline subject is importable and behaves";

// The execution WITNESS is written FIRST and only when the environment asks for one
// (the control below asks; a pipeline verify never does), so the baseline can prove
// it RAN — even on the run where importing its subject fails — without ever writing
// a byte into the fixture repo and dirtying a tree the publish assertions measure.
const BASELINE_TEST_SOURCE =
  'import { writeFileSync } from "node:fs";\n' +
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  "\n" +
  "const witness = process.env.CONDUCTOR_E2E_BASELINE_WITNESS;\n" +
  'if (witness !== undefined && witness.length > 0) writeFileSync(witness, "ran");\n' +
  "\n" +
  `const mod = await import("../${BASELINE_SUBJECT_REL}");\n` +
  "\n" +
  `test(${JSON.stringify(BASELINE_TEST_NAME)}, () => {\n` +
  '  assert.equal(mod.baseline(), "baseline");\n' +
  "});\n";

// A committed fixture repo with the layout the scenarios script against: src/ for
// behavioral code, tests/ for the item tests the pipeline writes, docs/ for the
// non-behavioral path, and the committed baseline test above so `tests/` is never
// empty. The author identity goes into the repo's OWN config too, because the
// handlers' commits run under adapter/gitio.ts's environment rather than under this
// file's GIT_ENV.
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
  writeFileSync(path.join(dir, BASELINE_SUBJECT_REL), BASELINE_SUBJECT);
  writeFileSync(path.join(dir, BASELINE_TEST_REL), BASELINE_TEST_SOURCE);
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
// G5 — the router seam, and the facts the two G5 arms compare (plan 2884-2888)
// ---------------------------------------------------------------------------
//
// conductor_report takes Task 7.2's fetchMetricsSummary as its `metrics` input,
// and this suite passes the REAL one — unstubbed, over a real socket. That seam
// is the ONLY place the pipeline touches the C++ llama-router, so it is also the
// only thing that can make the plan's G5 pair ("run this e2e once with the router
// in the loop, once without") two DIFFERENT runs rather than one command run
// twice. Where the socket points is read HERE, and nowhere else:
//
//   CONDUCTOR_E2E_ROUTER_PORT unset  — the WITHOUT arm, and the default every
//     plain `node --test` takes: the seam is aimed at port 1, where nothing can
//     be listening, so fetchMetricsSummary meets a refused connection and returns
//     null. The suite therefore needs neither the C++ router nor a model, which
//     is what conductor/tests/router-client.test.ts:5 promises for the whole
//     node suite and what a fresh worktree with no submodules can honour.
//   CONDUCTOR_E2E_ROUTER_PORT=<port> — the WITH arm, driven by
//     conductor/tools/g5-equivalence.ts against a real llama-router process.
//
// Nothing else in this file reads the environment for the router, which is the
// point: the three facts plan:2884-2888 compares — terminal state, item
// dispositions, commit set — must come out identical across the arms while the
// metrics section legitimately differs.
const DEAD_ROUTER_PORT = 1;
const ROUTER_SEAM_HOST = process.env.CONDUCTOR_E2E_ROUTER_HOST ?? "127.0.0.1";
const ROUTER_SEAM_PORT = Number.parseInt(
  process.env.CONDUCTOR_E2E_ROUTER_PORT ?? String(DEAD_ROUTER_PORT),
  10,
);
const ROUTER_SEAM_CFG: RouterClientConfig = {
  listen: { host: ROUTER_SEAM_HOST, port: ROUTER_SEAM_PORT },
  probeTimeoutMs: 2000,
};

// Every crossing of the seam, recorded as it happens: "the metrics function ran"
// is then an OBSERVATION, not an inference from a line in a report that renders
// the same way when the field is absent entirely.
const seamCalls: Array<{ port: number; available: boolean }> = [];
// The last MetricsSummary that actually reached a report through the ambient
// seam. The equivalence driver compares it against what the router itself served,
// which is how the WITH arm proves the router was CONTACTED rather than merely up.
let lastSeamSummary: MetricsSummary | null = null;

async function reportMetrics(): Promise<MetricsSummary | null> {
  const summary = await fetchMetricsSummary(ROUTER_SEAM_CFG);
  seamCalls.push({ port: ROUTER_SEAM_CFG.listen.port, available: summary !== null });
  lastSeamSummary = summary;
  return summary;
}

// The three facts the plan names, plus the metrics evidence that is deliberately
// NOT part of the comparison (the metrics section is what SHOULD differ).
interface ScenarioFacts {
  scenario: string;
  // Which metrics wiring the scenario's report used: the ambient seam (the arm's
  // own port), an explicitly dead endpoint, or no `metrics` field at all.
  seam: "ambient" | "dead-endpoint" | "omitted" | "none";
  terminalState: string;
  dispositions: Array<{ id: string; state: string; blocked: boolean; deferred: boolean }>;
  commitSet: string[];
  commitCount: number;
  metricsAvailable: boolean | null;
  metricsSummary: MetricsSummary | null;
}

const scenarioFacts: ScenarioFacts[] = [];

// Derived from the PERSISTED run, the persisted items and real git — never from a
// handler's return value, so a handler that reported one thing and wrote another
// cannot make the two arms agree.
function factsOf(
  b: Bench,
  scenario: string,
  seam: ScenarioFacts["seam"],
  report: Awaited<ReturnType<typeof handleReport>> | null,
): ScenarioFacts {
  const run = b.store.loadRun(b.runId);
  const queuePath = path.join(b.runDir, "queue.json");
  const ids = existsSync(queuePath)
    ? (JSON.parse(readFileSync(queuePath, "utf8")) as { items: Array<{ id: string }> }).items.map(
        (entry) => entry.id,
      )
    : [];
  const dispositions = ids.map((id) => {
    const persisted = b.store.loadItem(b.runId, id);
    return {
      id,
      state: String(persisted.state),
      blocked: persisted.blocked !== null && persisted.blocked !== undefined,
      deferred: persisted.deferred !== null && persisted.deferred !== undefined,
    };
  });
  return {
    scenario,
    seam,
    terminalState: String(run.state) + "/" + String(run.stop === null ? "none" : run.stop.kind),
    dispositions,
    commitSet: [...new Set(publishedFiles(b.root, b.baseCommit))].sort(),
    commitCount: Number.parseInt(
      git(b.root, ["rev-list", "--count", `${b.baseCommit}..HEAD`]).trim(),
      10,
    ),
    metricsAvailable: report === null ? null : report.metricsAvailable,
    metricsSummary: seam === "ambient" ? lastSeamSummary : null,
  };
}

function recordFacts(
  b: Bench,
  scenario: string,
  seam: ScenarioFacts["seam"],
  report: Awaited<ReturnType<typeof handleReport>> | null,
): ScenarioFacts {
  const facts = factsOf(b, scenario, seam, report);
  scenarioFacts.push(facts);
  return facts;
}

// The equivalence driver reads this file back; a plain `node --test` writes
// nothing at all.
after(() => {
  const dest = process.env.CONDUCTOR_E2E_FACTS;
  if (dest === undefined || dest.length === 0) return;
  writeFileSync(
    dest,
    JSON.stringify(
      {
        seamPortFromEnv: process.env.CONDUCTOR_E2E_ROUTER_PORT ?? null,
        seamHost: ROUTER_SEAM_HOST,
        seamPort: ROUTER_SEAM_PORT,
        seamCalls,
        scenarios: scenarioFacts,
      },
      null,
      2,
    ) + "\n",
  );
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The fixture repo's own verify command. A GLOB positional, never a bare
// directory: `node --test tests/` reports a bogus failing test on node 26.x, and
// a suite that is red for a reason the pipeline did not cause proves nothing. The
// other half of that trap is the glob that matches NOTHING, which exits 0 — which
// is why the fixture ships a committed baseline test the glob always matches, and
// why the control below runs THIS command and proves it goes both ways.
const VERIFY_CMD = [process.execPath, "--test", "tests/*.test.ts"];

// A CONTROL run of the fixture's OWN suite, through the exact argv the scope config
// hands the pipeline, spawned without a shell (node expands the glob) and under
// evidence.ts's childEnv. Stripping NODE_TEST_CONTEXT is load-bearing: inherited, a
// `node --test` child mistakes itself for a test child of THIS run and reports exit
// 0 for a suite that actually failed — which would make the control itself vacuous.
// The verify/item-test runs go through evidence.ts, which strips it for the same
// reason; the control must match. (Committed idiom: tools-9.4b.test.ts's
// controlSuite; this one runs the CONFIGURED command, because the command is what
// is on trial.)
function controlSuite(repo: string, witness?: string): { status: number | null; output: string } {
  const env = childEnv();
  if (witness !== undefined) env.CONDUCTOR_E2E_BASELINE_WITNESS = witness;
  const r = spawnSync(VERIFY_CMD[0], VERIFY_CMD.slice(1), {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

interface ConfigOpts {
  writes?: Config["parallel"]["writes"];
  behavioralPaths?: string[];
  testRepairAttempts?: number;
  maxOverridesPerItem?: number;
  maxOverridesPerRun?: number;
  maxImplementers?: number;
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
      maxImplementers: opts.maxImplementers ?? 2,
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
  // PARK this sub-session instead of answering it. The prompt stays IN FLIGHT
  // until the scenario releases it, which is the only way to read the DRIVER's
  // interleaving off the fan-out layer: how many sub-sessions the engine had
  // open at one instant is a fact about the driver, whereas how long a wave took
  // is a fact about the machine. The `write` side effects still happen at park
  // time — a real sub-session edits its tree before it replies.
  park?: boolean;
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

// One sub-session the fan-out engine has OPEN right now: the fake SDK's own
// pending list, joined to the role/item/tree the engine registered for it.
interface InFlight {
  sessionID: string;
  role: string;
  itemId: string;
  tree: string;
}

interface Wiring {
  fanout: Fanout;
  sdk: ReturnType<typeof makeFakeSdk>;
  prompted: RespondCtx[];
  treeState: { isFrozen: (t: TreePath) => boolean; onClear: (f: (t: TreePath) => void) => () => void; notifyClear: (t: TreePath) => void };
  byRole: (role: string) => RespondCtx[];
  // The parked sub-sessions, in the fake SDK's own order, and the release that
  // lets them all answer at once.
  inFlight: () => InFlight[];
  releaseParked: () => number;
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
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: RespondCtx[] = [];
  const counts = new Map<string, number>();
  // sessionID -> the answer a parked sub-session will give when released.
  const parked = new Map<string, { ctx: RespondCtx; text: string }>();
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
    const text = JSON.stringify(reply.body);
    if (reply.park === true) {
      parked.set(req.sessionID, { ctx, text });
      return { kind: "pending" };
    }
    return { kind: "reply", text };
  });

  const listeners: Array<(t: TreePath) => void> = [];
  const treeState = {
    isFrozen: (): boolean => false,
    onClear: (listener: (t: TreePath) => void): (() => void) => {
      listeners.push(listener);
      return (): void => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    notifyClear: (t: TreePath): void => {
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
  // The engine's OPEN sub-sessions, read out of the fake's own pending list so
  // the count is the SDK's, not a tally this file keeps.
  const inFlight = (): InFlight[] =>
    sdk.pending.map((p) => {
      const rec = parked.get(p.sessionID);
      return {
        sessionID: p.sessionID,
        role: rec === undefined ? "" : rec.ctx.role,
        itemId: rec === undefined ? "" : rec.ctx.itemId,
        tree: rec === undefined ? "" : rec.ctx.tree,
      };
    });

  const releaseParked = (): number => {
    const ids = sdk.pending.map((p) => p.sessionID);
    for (const id of ids) {
      const rec = parked.get(id);
      parked.delete(id);
      sdk.resolvePending(id, { kind: "reply", text: rec === undefined ? "{}" : rec.text });
    }
    return ids.length;
  };

  return {
    fanout,
    sdk,
    prompted,
    treeState,
    byRole: (r) => prompted.filter((p) => p.role === r),
    inFlight,
    releaseParked,
  };
}

// ---------------------------------------------------------------------------
// Reading the DRIVER's interleaving off the fan-out layer
// ---------------------------------------------------------------------------

// Poll the parked sub-sessions while a wave runs and keep the LARGEST set that
// was open at one instant, then let them answer so the wave proceeds.
//
// Deliberately NOT a wall-clock proof. "Two stages overlapped for N ms" is a
// statement about the machine and goes flaky the moment the machine is busy;
// "the engine had two sub-sessions open at the same instant" is a statement
// about the DRIVER, and a strictly serial driver cannot make it true however
// fast or slow the machine is — its second job does not exist until the first
// one's promise settles.
//
// The release rule is what keeps that honest in both directions: the watcher
// lets a parked set go as soon as it reaches `expect` (so a concurrent driver is
// never made to wait), and otherwise only after the set has stood UNCHANGED for
// the whole settle window (so a concurrent driver that was a few turns from
// opening its second session is never cut short and mis-read as serial).
interface Watcher {
  peak: () => InFlight[];
  stop: () => Promise<void>;
}

// `expectItems` is the number of DISTINCT items whose sub-sessions must be open
// together before the watcher stops waiting; the peak it keeps is the parked set
// that spanned the most items, which is the quantity the concurrency claim is
// about (two sessions of the SAME item overlapping says nothing about whether
// the driver interleaves ITEMS).
function watchInterleaving(wiring: Wiring, expectItems: number): Watcher {
  const POLL_MS = 4;
  const SETTLE_POLLS = 12; // ~50ms of an UNCHANGING parked set before releasing
  const spread = (live: InFlight[]): number => new Set(live.map((p) => p.itemId)).size;
  let peak: InFlight[] = [];
  let running = true;
  const loop = (async (): Promise<void> => {
    let lastKey = "";
    let stable = 0;
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const live = wiring.inFlight();
      if (live.length === 0) {
        lastKey = "";
        stable = 0;
        continue;
      }
      if (spread(live) > spread(peak) || (spread(live) === spread(peak) && live.length > peak.length)) {
        peak = live;
      }
      const key = live
        .map((p) => `${p.role}:${p.itemId}:${p.sessionID}`)
        .sort()
        .join(",");
      stable = key === lastKey ? stable + 1 : 0;
      lastKey = key;
      if (spread(live) >= expectItems || stable >= SETTLE_POLLS) {
        wiring.releaseParked();
        lastKey = "";
        stable = 0;
      }
    }
  })();
  return {
    peak: () => peak,
    stop: async (): Promise<void> => {
      running = false;
      await loop;
      wiring.releaseParked();
    },
  };
}

// ---------------------------------------------------------------------------
// Driving the real plugin
// ---------------------------------------------------------------------------

function pluginInput(directory: string, client: unknown): unknown {
  return {
    client,
    project: { id: "prj_e2e", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: (): undefined => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: (): undefined => undefined,
  };
}

async function startPlugin(directory: string, client: unknown = {}): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(pluginInput(directory, client));
}

// The opencode client the §3.7 idle engine re-prompts the ORCHESTRATOR through.
// The plugin hands its own `input.client` straight to the continuation engine, so
// this is the only place a re-prompt can be observed — and the only shape that
// makes one countable. An engine whose client cannot be prompted takes a
// SYNCHRONOUS throw out of `session.prompt`, and it deliberately charges nothing
// to a session it never reached ("an accusation against a session that was never
// asked once"), so the futility counter would sit at zero forever and the whole
// wedge path would be unreachable.
//
// This one answers, and the scripted orchestrator does nothing in response. That
// is what makes the re-prompts here FUTILE rather than merely undeliverable: the
// orchestrator really was asked, three times, and the run really did not move.
interface ContinuationClientCapture {
  client: unknown;
  prompts: Array<{ sessionID: string; text: string }>;
}

function makeContinuationClient(): ContinuationClientCapture {
  const prompts: Array<{ sessionID: string; text: string }> = [];
  const envelope = async (): Promise<{ data: null; error: null }> => ({ data: null, error: null });
  const client = {
    session: {
      create: envelope,
      prompt: async (opts: {
        path: { id: string };
        body: { parts?: Array<{ text?: string }> };
      }): Promise<{ data: null; error: null }> => {
        const parts = opts.body.parts ?? [];
        prompts.push({ sessionID: opts.path.id, text: parts.map((p) => p.text ?? "").join("") });
        return { data: null, error: null };
      },
      abort: envelope,
      messages: envelope,
    },
    postSessionIdPermissionsPermissionId: envelope,
  };
  return { client, prompts };
}

// §3.7.4 (adapter/continuation.ts:154): re-prompts are paced from the LAST one,
// and the plugin's event hook binds the engine's clock to Date.now — there is no
// injection seam on that path, which is the point: this suite drives the wall
// clock the shipped hook actually reads rather than a clock only a test can see.
const CONTINUATION_DEBOUNCE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One `session.idle` bus event, through the REAL plugin hook.
async function sendIdle(hooks: PluginHooks, sessionID: string): Promise<void> {
  const hook = hooks.event;
  assert.equal(
    typeof hook,
    "function",
    "the plugin must keep its `event` bus hook: it is the SOLE production entry to the §3.7 continuation engine",
  );
  await (hook as (i: BusEventHookInput) => Promise<void>)({
    event: { type: "session.idle", properties: { sessionID } },
  });
  // The re-prompt is FIRED, not awaited (the one-in-flight latch is what bounds
  // concurrency), so yield a macrotask to let its .then(settle) land before the
  // next pass reads that latch.
  await sleep(0);
}

// The plugin's OWN journal — <runDir>/journal.jsonl, appended synchronously by
// adapter/journal.ts. The scenarios drive the handler layer with a capturing
// sink of their own, but the continuation engine is reached only through the
// plugin, so its records land here and nowhere the capture can see them.
function readRunJournal(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function rePromptRecords(runDir: string): Array<Record<string, unknown>> {
  return readRunJournal(runDir).filter((r) => r.component === "continuation" && r.event === "reprompt");
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
  // The opencode client the plugin hands the §3.7 continuation engine. Only the
  // scenario that drives `session.idle` needs a real one.
  client?: unknown;
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
  const hooks = await startPlugin(root, opts.client ?? {});
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
  packs: Record<string, string>;
  sessionID: string;
} {
  return {
    store: b.store,
    fanout: b.wiring.fanout,
    runId: b.runId,
    config: b.config,
    journal: b.journal.sink,
    // GAP-005: the plan-level dispatch prompts compose their doctrine slice out of
    // this map, so the e2e stages carry the REAL packs exactly as the root does.
    packs: PACKS,
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

// `metrics` defaults to the AMBIENT G5 seam (reportMetrics, the real
// fetchMetricsSummary aimed at whatever port this arm was given), so every report
// this suite writes really crosses adapter/router-client.ts. Pass `null` for the
// pre-G5 shape — the field omitted entirely, which handleReport short-circuits —
// and a function to aim the seam somewhere specific.
function reportArgs(
  b: Bench,
  metrics?: (() => Promise<MetricsSummary | null>) | null,
): Parameters<typeof handleReport>[0] {
  const base = {
    store: b.store,
    fanout: b.wiring.fanout,
    runId: b.runId,
    config: b.config,
    journal: b.journal.sink,
    stateHome: b.stateHome,
    workspaceKey: "e2e",
  };
  if (metrics === null) return base as unknown as Parameters<typeof handleReport>[0];
  return {
    ...base,
    metrics: metrics ?? reportMetrics,
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

// The §2.6 ledger, narrowed to one record kind (and optionally one item) with the
// union discriminated rather than cast away — an assertion that reads
// `failureClass` off a `verify` record is an assertion about nothing.
function evidenceOf<K extends EvidenceRecord["kind"]>(
  records: readonly EvidenceRecord[],
  kind: K,
  itemId?: string,
): Array<Extract<EvidenceRecord, { kind: K }>> {
  return records.filter(
    (record): record is Extract<EvidenceRecord, { kind: K }> =>
      record.kind === kind && (itemId === undefined || record.itemId === itemId),
  );
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
// Control — the fixture suite itself, before any scenario leans on it
// ===========================================================================

test(
  "[13.1-fixture-suite-discriminates] the fixture repo's configured verify command is ONE glob positional that really matches, and the suite it runs DISCRIMINATES: with the baseline subject present the suite exits 0 having executed the fixture's own committed test, and with that subject removed the same command exits non-zero naming that same test file — so no later `the verify was green` assertion in this file can be resting on a command that ran nothing",
  { timeout: 120_000 },
  () => {
    // (a) The SHAPE of the command every scenario's verify runs. Both node 26.7.0
    // traps look exactly like a working command: a directory positional
    // (`tests/`) is resolved as a module and reports a bogus failing test, and a
    // glob matching zero files exits 0 having run nothing.
    const positionals = VERIFY_CMD.slice(1).filter((arg) => !arg.startsWith("-"));
    assert.equal(
      positionals.length,
      1,
      `the scope command must carry exactly ONE positional (saw ${JSON.stringify(VERIFY_CMD)})`,
    );
    const scope = positionals[0];
    assert.ok(scope.includes("*"), `the positional must be a GLOB, never a directory positional: ${scope}`);
    assert.equal(scope.endsWith("/"), false, `a trailing slash is a directory positional in disguise: ${scope}`);

    const root = fixtureRepo("control");
    const subjectAbs = path.join(root, BASELINE_SUBJECT_REL);
    const witness = path.join(scratch("control-witness"), "ran.txt");

    // The baseline is SEED, not pipeline output: both files are in the fixture's
    // own first commit and the tree is clean before a run ever starts. An
    // uncommitted baseline would show up as run-start dirt and could be mistaken
    // for something a sub-session wrote.
    const seeded = git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]);
    assert.ok(seeded.includes(BASELINE_TEST_REL), `${BASELINE_TEST_REL} is in the fixture's seed commit:\n${seeded}`);
    assert.ok(seeded.includes(BASELINE_SUBJECT_REL), `${BASELINE_SUBJECT_REL} is in the fixture's seed commit:\n${seeded}`);
    assert.equal(git(root, ["status", "--porcelain"]).trim(), "", "the seeded baseline leaves the fixture tree CLEAN");

    // (b) SUBJECT PRESENT: the committed suite is green, and the witness proves it
    // was green because a real test file RAN — not because the glob matched
    // nothing. This is the assertion a zero-match glob cannot survive.
    const present = controlSuite(root, witness);
    assert.equal(
      present.status,
      0,
      `control: with ${BASELINE_SUBJECT_REL} present the fixture suite must exit 0\n${present.output}`,
    );
    assert.equal(
      existsSync(witness),
      true,
      `control: the suite EXECUTED ${BASELINE_TEST_REL}; an exit 0 with no execution witness is the zero-match vacuous green this fixture exists to rule out\n${present.output}`,
    );
    assert.equal(readFileSync(witness, "utf8"), "ran", "control: the witness is the baseline test's own byte");
    // Reporter-agnostic second witness: both node reporters print the NAME of
    // every test they ran, and a zero-match glob prints no name at all. (The file
    // PATH is printed only on failure, which is why the red half below can assert
    // on it and this half cannot.)
    assert.ok(
      present.output.includes(BASELINE_TEST_NAME),
      `control: the green run must report the baseline test by name; a run that names no test ran no test\n${present.output}`,
    );

    // (c) SUBJECT REMOVED: the very same command now FAILS, and the failure names
    // the fixture's own test file. A suite that cannot be made to fail measures
    // nothing, and every later scenario's green rests on this half.
    rmSync(witness, { force: true });
    rmSync(subjectAbs, { force: true });
    const removed = controlSuite(root, witness);
    assert.notEqual(
      removed.status,
      0,
      `control: with ${BASELINE_SUBJECT_REL} removed the fixture suite must exit NON-ZERO\n${removed.output}`,
    );
    assert.ok(
      removed.output.includes("baseline.test.ts"),
      `control: the failure must name the fixture's own test file, not some unrelated error\n${removed.output}`,
    );
    assert.equal(
      existsSync(witness),
      true,
      `control: the failing run still EXECUTED the test file — the red is the subject's absence, not a glob that matched nothing\n${removed.output}`,
    );

    // And the fixture hands every scenario the PRESENT state, not this mutilated
    // one: the removal above happened in a repo of this test's own.
    writeFileSync(subjectAbs, BASELINE_SUBJECT);
    assert.equal(controlSuite(root).status, 0, "control: restoring the subject restores the green — the suite tracks the subject, both ways");
  },
);

// ===========================================================================
// Scenario 1 — full-pipeline
// ===========================================================================

// ===========================================================================
// Scenario 1 — the whole pipeline, run ONCE and then read ROW BY ROW
//
// M7 traceability: every row of docs/build/specs/task-13.1.assertions.json has
// to name the test that proves it, and one 400-line `test()` can name nothing.
// The expensive part still happens exactly once — `before()` walks the entire
// pipeline and CAPTURES what the rows read (the persisted run and items, the
// evidence and anomaly ledgers, plan.md, the fan-out call log, real git,
// report.md, the G5 seam counter) and ASSERTS NOTHING ITSELF. Each row below is
// its own `it()` carrying its own row id, so a red names the row that broke and
// a deleted test names the row that just lost its proof.
//
// Several rows are named here by a test that proves LESS than the row's full
// text. Every one of those carries a "NOT proven here" comment naming exactly
// which clauses are unasserted, because the alternative — a title that claims a
// row it does not prove — is worse than a gap somebody can read.
//
// The setup deliberately does not throw. A `before()` that throws leaves node
// reporting its subtests as CANCELLED; stashing the failure and rethrowing it
// from `caps()` makes EVERY row in this describe fail with the setup's own
// stack, which cannot be misread as a skip or a pass.
// ===========================================================================

// What a call that was supposed to be DENIED actually did, without judging it:
// the judgement belongs to the row that owns the gate, so a gate that stopped
// denying reddens THAT row rather than a shared setup every row fails behind.
interface Attempt {
  threw: boolean;
  error: Error | null;
}

async function attempt(fn: () => Promise<unknown>): Promise<Attempt> {
  try {
    await fn();
    return { threw: false, error: null };
  } catch (err) {
    return { threw: true, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

type WaveResult = Awaited<ReturnType<typeof handleDispatchWave>>;
type WaveItem = WaveResult["items"][number];

interface FullPipeline {
  bench: Bench;
  gateHookPresent: boolean;
  strayWrite: Attempt;
  spawnFromOrchestrator: Attempt;
  orchestratorEdit: Attempt;
  planBeforeClassify: Attempt;
  classified: Awaited<ReturnType<typeof handleClassify>>;
  decomposed: Awaited<ReturnType<typeof handleDecompose>>;
  planned: Awaited<ReturnType<typeof handlePlan>>;
  planExists: boolean;
  finalPlan: string;
  planIndependence: string;
  planVerification: string;
  reviewed: Awaited<ReturnType<typeof handlePlanReview>>;
  questionCount: number;
  planners: RespondCtx[];
  skeptics: RespondCtx[];
  firstWave: WaveResult;
  laggard: WaveItem | undefined;
  staleDenial: Awaited<ReturnType<typeof handlePublish>> | null;
  wave: WaveResult;
  evidence: EvidenceRecord[];
  if1Panel: RespondCtx[];
  if1Fixers: RespondCtx[];
  subjects: string[];
  publishedPaths: string[];
  override: Awaited<ReturnType<typeof handleOverride>>;
  anomalies: Array<Record<string, unknown>>;
  seamCallsBefore: number;
  seamCallsAfterReport: number;
  report: Awaited<ReturnType<typeof handleReport>>;
  reportExists: boolean;
  reportMd: string;
  finalRun: Run;
}

async function runFullPipeline(): Promise<FullPipeline> {
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

  // The plan-review round trip, driven by the DOCUMENT and never by a counter.
  // Each lens judges the plan.md text it was actually handed and stops raising
  // a finding only once the revision it demanded is really in that text; the
  // scripted planner resolves exactly the findings its own re-prompt carries
  // and keeps what it has already written. So a clean round is reachable ONLY
  // if the handler really re-wrote plan.md and really re-reviewed the REVISED
  // document — a loop that re-read the old text would raise the same finding
  // every round and leave at the cap with questions, which is what this
  // scenario used to do while asserting nothing that could tell the difference.
  const PLAN_BASE = "# plan\n\nBuild slugify, then titlecase.\n";
  const PLAN_INDEPENDENCE = "The two functions share no state, so either build order works.";
  const PLAN_VERIFICATION =
    "Each item is verified by its own test file under tests/, run by the repo's verify command.";
  let plannerDraft = PLAN_BASE;

  // Round 1 raises PF1 (refuted by its skeptic, so it buys no revision) and PF2
  // (upheld). Round 2, over the revised plan, raises PF3 (upheld). Round 3 is
  // clean. Two revisions are spent, so `run.planReviewRounds` is 2.
  const PF1 = {
    id: "PF1",
    severity: "major",
    lens: "scope",
    claim: "the two items share a helper and cannot parallelize",
    evidence: "both titles mention string handling",
    suggestedFix: "serialize them",
  };
  const PF2 = {
    id: "PF2",
    severity: "major",
    lens: "plan-completeness",
    claim: "the plan never says the two functions are independent",
    evidence: "the markdown lists them without stating their relationship",
    suggestedFix: "state that they share no state",
  };
  const PF3 = {
    id: "PF3",
    severity: "major",
    lens: "plan-completeness",
    claim: "the plan never says how either item is verified",
    evidence: "the markdown names no test file and no verify command",
    suggestedFix: "state that each item is verified by its own test file",
  };

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
      // is plan or plan revision (schema Plan). A revision carries the findings
      // that survived their skeptics, and this planner answers EXACTLY those —
      // nothing else moves the document, so a finding that never reached the
      // planner is a finding the next review round raises again.
      if (ctx.nth === 0) return { body: QUEUE };
      if (ctx.text.includes("PF2")) plannerDraft += PLAN_INDEPENDENCE + "\n";
      if (ctx.text.includes("PF3")) plannerDraft += PLAN_VERIFICATION + "\n";
      return { body: { markdown: plannerDraft, decisions: [] } };
    }
    if (ctx.role === "reviewer" && ctx.itemId === "") {
      // Plan review, judged against the plan THIS lens was handed.
      if (!ctx.text.includes(PLAN_INDEPENDENCE)) return { body: { findings: [PF1, PF2] } };
      if (!ctx.text.includes(PLAN_VERIFICATION)) return { body: { findings: [PF3] } };
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
      if (ctx.text.includes("PF3")) {
        return { body: { findingId: "PF3", upheld: true, reasoning: "the plan really names no test file and no verify command" } };
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
  // An UNREGISTERED session's write, a sub-agent spawn and the ORCHESTRATOR's
  // own edit, all through the REAL tool.execute.before hook. Each outcome is
  // captured rather than judged; the three §3.5 rows below judge them.
  const gateHookPresent = typeof bench.hooks["tool.execute.before"] === "function";
  const strayWrite = await attempt(() =>
    callGate(bench.hooks, { tool: "write", sessionID: STRAY, args: { filePath: path.join(bench.root, "src/slug.ts"), content: "x" } }),
  );
  const spawnFromOrchestrator = await attempt(() =>
    callGate(bench.hooks, { tool: "task", sessionID: ORCH, args: { description: "spawn a helper" } }),
  );
  const orchestratorEdit = await attempt(() =>
    callGate(bench.hooks, { tool: "edit", sessionID: ORCH, args: { filePath: path.join(bench.root, "src/slug.ts"), content: "x" } }),
  );

  // --- an out-of-order stage tool is put to the phase gate -----------------
  const planBeforeClassify = await attempt(() => handlePlan({ ...stageBase(bench) }));

  // --- intake ------------------------------------------------------------
  const classified = await handleClassify({ ...stageBase(bench) });
  const decomposed = await handleDecompose({ ...stageBase(bench) });
  const planned = await handlePlan({ ...stageBase(bench) });
  const reviewed = await handlePlanReview({ ...stageBase(bench) });
  const questionCount = readQuestions(bench.runDir).length;
  const planners = bench.wiring.byRole("planner");
  const skeptics = bench.wiring.byRole("skeptic");
  const planExists = existsSync(planned.planPath);
  const finalPlan = planExists ? readFileSync(planned.planPath, "utf8") : "";

  // --- the wave ----------------------------------------------------------
  const firstWave = await handleDispatchWave(waveArgs(bench));

  // §2.6 condition 2, end to end and measured: the first member of the wave
  // commits, HEAD moves, and the sibling's green — which really was green, on
  // the tree that existed when it ran — is refused. This is the condition a
  // `git switch` between validate and publish also produces, and the reason
  // the freshness rule carries a head term at all.
  const laggard = firstWave.items.find((d) => d.state !== "PUBLISHED");
  const staleDenial =
    laggard === undefined
      ? null
      : await handlePublish({
          store: bench.store,
          fanout: bench.wiring.fanout,
          runId: bench.runId,
          itemId: laggard.itemId,
          config: bench.config,
          journal: bench.journal.sink,
          stateHome: bench.stateHome,
          workspaceKey: "e2e",
        } as unknown as Parameters<typeof handlePublish>[0]);

  const wave = await drainWaves(bench);

  // --- the ledgers and the tree, as they stand once the wave is done -------
  const evidence = readEvidence(bench.runDir);
  // IF1 is the one item-level finding this scenario raises, and its skeptic
  // REFUTES it. Both halves are load-bearing: a finding that never reached a
  // skeptic panel would have been routed as a fix, and a refuted finding that
  // still dispatched one would mean the verdict changed nothing.
  const if1Panel = bench.wiring.prompted.filter((p) => p.role === "skeptic" && p.text.includes("IF1"));
  const if1Fixers = bench.wiring.prompted.filter(
    (p) => (p.role === "implementer" || p.role === "testWriter") && p.text.includes("IF1"),
  );
  const subjects = commitSubjects(bench.root);
  const publishedPaths = publishedFiles(bench.root, bench.baseCommit);

  // --- an override is spent, tainted and reported -------------------------
  const grants = new Map<string, OverrideGrant>();
  const override = await handleOverride({
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    sessionID: ORCH,
    itemId: "I1",
    // A gate with a CONSUMPTION POINT (§3.6's closed vocabulary is session /
    // git / edit — the three gateBeforeToolCall can convert). A name outside it
    // buys a bypass that can never be spent, so it is refused before the budget
    // is touched, and a scenario that spent one would be asserting over an
    // override the machine cannot honour.
    gate: "edit",
    reason: "the operator accepts one scoped write outside the item's fileScope for this e2e",
    grantedAction: "conductor_publish I1",
    overrideGrants: grants,
    stateHome: bench.stateHome,
    workspaceKey: "e2e",
  } as unknown as Parameters<typeof handleOverride>[0]);
  const anomalies = readAnomalies(bench.runDir);

  // --- report -------------------------------------------------------------
  const seamCallsBefore = seamCalls.length;
  const report = await handleReport(reportArgs(bench));
  const seamCallsAfterReport = seamCalls.length;
  const reportPath = path.join(bench.runDir, "report.md");
  const reportExists = existsSync(reportPath);
  const reportMd = reportExists ? readFileSync(reportPath, "utf8") : "";
  const finalRun = bench.store.loadRun(bench.runId);

  recordFacts(bench, "full-pipeline", "ambient", report);

  return {
    bench,
    gateHookPresent,
    strayWrite,
    spawnFromOrchestrator,
    orchestratorEdit,
    planBeforeClassify,
    classified,
    decomposed,
    planned,
    planExists,
    finalPlan,
    planIndependence: PLAN_INDEPENDENCE,
    planVerification: PLAN_VERIFICATION,
    reviewed,
    questionCount,
    planners,
    skeptics,
    firstWave,
    laggard,
    staleDenial,
    wave,
    evidence,
    if1Panel,
    if1Fixers,
    subjects,
    publishedPaths,
    override,
    anomalies,
    seamCallsBefore,
    seamCallsAfterReport,
    report,
    reportExists,
    reportMd,
    finalRun,
  };
}

describe(
  "[13.1-full-pipeline] the whole §3.2/§3.3 pipeline on a real fixture repo: the real chat.message hook creates the run, classify/decompose/plan/plan-review run through the real fan-out engine (a major refuted, a major upheld and revised to a clean round), the wave drives TWO items through the entire item FSM to REAL git commits whose contents are asserted, an override is spent and surfaces in the report, every gate denial the plan names really denies, and conductor_report closes the run done",
  { timeout: 240_000 },
  () => {
    let captured: FullPipeline | null = null;
    let setupError: unknown = null;

    before(
      async () => {
        try {
          captured = await runFullPipeline();
        } catch (err) {
          setupError = err;
        }
      },
      { timeout: 180_000 },
    );

    // Never returns a half-built capture and never lets a broken setup read as
    // a green: if the pipeline threw, every row below fails carrying the
    // setup's own stack.
    function caps(): FullPipeline {
      if (setupError !== null) {
        const detail =
          setupError instanceof Error ? (setupError.stack ?? setupError.message) : String(setupError);
        throw new Error(`[13.1-full-pipeline] the shared pipeline setup FAILED, so this row proved nothing: ${detail}`);
      }
      if (captured === null) {
        throw new Error("[13.1-full-pipeline] the shared pipeline setup produced no captures");
      }
      return captured;
    }

    // ---- §3.2 intake ----------------------------------------------------

    it("[13.1-s1-classify-work-stays-intake] conductor_classify's mechanical classifier and its skeptic agree on `work`", () => {
      const c = caps();
      assert.equal(c.classified.kind, "work", "the scripted classifier and its skeptic agreed on `work`");
      // NOT proven here, and reported as an M7 gap rather than implied by this
      // title: that run.json READ BACK carries state INTAKE with
      // run.classification recorded, that EXACTLY ONE skeptic seat was spent on
      // the check, and that legalTools then names conductor_decompose as the
      // recommended next tool. The stays-at-INTAKE half survives only
      // indirectly, in that the decompose below is what advanced the run.
    });

    it("[13.1-s1-decompose-two-disjoint-items] conductor_decompose validates the canned queue and yields EXACTLY the two items I1 and I2", () => {
      const c = caps();
      assert.deepEqual([...c.decomposed.itemIds].sort(), ["I1", "I2"], "both items entered the queue");
      // NOT proven here: the INTAKE->DECOMPOSED edge itself, pairwise glob
      // disjointness of the two fileScopes, behavioral:true with a non-empty
      // testScope on both, the acyclic dependsOn, and queue.json's presence on
      // disk as the thing later stages read.
    });

    it("[13.1-s1-plan-writes-plan-md-and-decisions] conductor_plan writes runs/<runId>/plan.md, read back off disk", () => {
      const c = caps();
      assert.ok(c.planExists, "plan.md was really written to the run dir");
      assert.ok(c.finalPlan.length > 0, "and it is not an empty file");
      // NOT proven here: the PLANNED transition, that plan.md carries the
      // per-item TEST STRATEGY, and the entire decisions.jsonl half of this row
      // — the canned planner returns `decisions: []`, so this scenario cannot
      // show the plan's design alternatives being extracted at all.
    });

    it(
      "[13.1-s1-plan-review-refute-revise-clean] the plan review round-trips as §3.2:1132-1140: round 1's REFUTED major buys no revision, its UPHELD sibling re-prompts the planner, round 2's upheld major revises again, round 3 is CLEAN — two rounds spent, no cap question, no blocked item, and plan.md on disk carrying both revisions",
      () => {
        const c = caps();
        assert.equal(c.reviewed.runState, "PLAN_REVIEWED", "the plan review reached a clean round and advanced the run");
        // PLAN_REVIEWED is reached on BOTH exits — a clean round and the round cap —
        // so the run state alone cannot tell them apart. These three can: the cap
        // exit spends every configured round, mints one question per surviving
        // finding and blocks the items those findings name.
        assert.equal(
          c.reviewed.rounds,
          2,
          "the review spent exactly two REVISION rounds and then found a clean one; a different count means the loop exited at the cap",
        );
        assert.deepEqual(
          c.reviewed.questionIds,
          [],
          "a CLEAN round mints no plan-review-cap question: an unanswered question carried to REPORTED is the cap exit wearing a clean round's face",
        );
        assert.deepEqual(c.reviewed.blockedItemIds, [], "and it blocks no item");
        assert.equal(c.questionCount, 0, "the §2.11 ledger is empty: nothing was escalated to a human");

        // The revisions really happened, to plan.md, in the order the findings
        // arrived — and the planner was re-prompted with the UPHELD finding only.
        assert.equal(c.planners.length, 4, "decompose + the first plan + exactly two revision re-prompts");
        assert.ok(c.planners[2].text.includes("PF2"), "the first revision re-prompt carried the UPHELD finding");
        assert.equal(
          c.planners[2].text.includes("PF1"),
          false,
          "the REFUTED finding was never sent back to the planner — a refutation that still costs a revision is not a refutation",
        );
        assert.ok(
          c.planners[2].text.includes("Build slugify, then titlecase."),
          "the revision re-prompt carried the plan AS IT STANDS, so the planner revises rather than restarts",
        );
        assert.ok(c.planners[3].text.includes("PF3"), "the second revision re-prompt carried the SECOND round's upheld finding");
        assert.ok(
          c.finalPlan.includes(c.planIndependence) && c.finalPlan.includes(c.planVerification),
          `plan.md on disk carries BOTH revisions the review demanded: ${JSON.stringify(c.finalPlan)}`,
        );

        // The refuted finding cost no revision and the upheld ones did: every verdict
        // was really consulted.
        assert.ok(
          c.skeptics.some((s) => s.text.includes("PF1")) &&
            c.skeptics.some((s) => s.text.includes("PF2")) &&
            c.skeptics.some((s) => s.text.includes("PF3")),
          "every plan-review major went to a skeptic before it could change the plan",
        );
        // NOT proven here: that `run.planReviewRounds` is the PERSISTED 2 — the
        // count read is the handler's returned `rounds`, not run.json's field.
      },
    );

    // ---- §3.3 the wave and the item FSM ----------------------------------

    it("[13.1-s1-wave-dispatch-enters-executing] the first conductor_dispatch_wave performs PLAN_REVIEWED -> EXECUTING and then drives both items' pipelines itself", () => {
      const c = caps();
      assert.equal(c.firstWave.runState, "EXECUTING", "the first dispatch performed PLAN_REVIEWED -> EXECUTING");
      assert.equal(c.firstWave.items.length, 2, "and it drove BOTH items of the wave, not one");
      // The driver — not an orchestrator tool call — walked the pipelines: no
      // stage handler between dispatch and the assertions below is called by
      // this file, yet the items moved off PENDING.
      assert.ok(
        c.firstWave.items.some((d) => d.state === "PUBLISHED"),
        "at least one item was walked all the way to PUBLISHED inside the dispatch call itself",
      );
      // NOT proven here: that the transition went through core legalRunTransition
      // specifically, that no `executors` override was passed (waveArgs simply
      // omits the field), and the `wave.parallel` nextWave the row names.
    });

    it("[13.1-s1-greenfield-missing-subject-legal-red] a REAL child test process that cannot resolve the not-yet-written module is persisted to evidence.jsonl with failureClass exactly 'missing-subject' and accepted as a legal red", () => {
      const c = caps();
      const reds = evidenceOf(c.evidence, "red");
      assert.ok(reds.length >= 2, "each behavioral item recorded a real red before any implementation existed");
      assert.ok(
        reds.some((r) => r.failureClass === "missing-subject"),
        "the greenfield first red is classified missing-subject (§2.6.1) — the legal red that makes greenfield TDD possible",
      );
      // NOT proven here: that the missing-subject red is I1's FIRST red
      // specifically (the assertion is an existential over the ledger), and that
      // the test-writer never created the missing module.
    });

    it("[13.1-s1-i2-compressed-published] I2 walks the SAME item FSM as I1 all the way to PUBLISHED on canned outputs that are clean on the first round of every loop", () => {
      const c = caps();
      for (const d of c.wave.items) {
        assert.equal(
          d.state,
          "PUBLISHED",
          `${d.itemId} must reach PUBLISHED; it stopped at ${String(d.stoppedAt)} (${String(d.envError)})`,
        );
      }
      assert.ok(
        c.wave.items.some((d) => d.itemId === "I2"),
        "I2 is one of the items the assertion above just held to PUBLISHED",
      );
      const greens = evidenceOf(c.evidence, "green");
      assert.ok(greens.length >= 2, "each behavioral item recorded a real green from a real spawn");
      // NOT proven here: that EXACTLY two new commits exist, that I1's commit
      // precedes I2's, and that I2's own verify record's head was re-established
      // after I1's commit. What stands in for the last of those is the §2.6
      // condition 2 refusal asserted below — the machine refuses a green
      // measured before a sibling's commit — not a reading of I2's record.
    });

    it("§2.6 condition 2 (no row of its own): a wave member's publish moves HEAD and its sibling's earlier green is REFUSED by name", () => {
      const c = caps();
      assert.ok(c.laggard !== undefined, "one member of a two-item wave publishes first and strands the other on a stale green");
      assert.ok(c.staleDenial !== null, "the stranded item's publish was really attempted");
      const denial = c.staleDenial as Awaited<ReturnType<typeof handlePublish>>;
      assert.equal(denial.ok, false, "publishing on a verify measured before a sibling's commit must be REFUSED");
      assert.match(
        String(denial.denial),
        /HEAD is now/,
        "the refusal must name the head mismatch, not merely say `stale` — an operator has to know to re-validate",
      );
    });

    it("the item-review finding IF1 was adjudicated (no row of its own): one skeptic seat, and a REFUTED finding dispatches no fix", () => {
      const c = caps();
      assert.equal(
        c.if1Panel.length,
        1,
        "the item-review finding was adjudicated by exactly one skeptic seat (workflow.skepticsPerFinding=1)",
      );
      assert.equal(c.if1Fixers.length, 0, "a REFUTED item-review finding dispatches no fix to anybody");
    });

    // ---- §3.3 publish ----------------------------------------------------

    it("[13.1-s1-publish-real-commit-content] conductor_publish creates REAL commits whose name-status is read back with git: each item's module AND its test file shipped together, and nothing outside the items' scopes was swept in", () => {
      const c = caps();
      assert.ok(c.subjects.length >= 4, `two publishes on top of the two fixture commits (saw ${c.subjects.length})`);
      assert.ok(
        c.publishedPaths.includes("src/slug.ts") && c.publishedPaths.includes("tests/slug.test.ts"),
        "I1's module and test both shipped",
      );
      assert.ok(
        c.publishedPaths.includes("src/title.ts") && c.publishedPaths.includes("tests/title.test.ts"),
        "I2's module and test both shipped",
      );
      assert.equal(c.publishedPaths.includes("README.md"), false, "nothing outside the items' scopes was swept into a publish");
      // NOT proven here, and NOT EXERCISED anywhere in this scenario: the
      // run.startDirty half of the row — a file already dirty inside I1's scope
      // BEFORE the run started, excluded from the commit under
      // git.preexistingDirty 'exclude', left byte-identical in the worktree, and
      // its skipped path carried to the report. This scenario seeds no such file.
    });

    it("[13.1-s1-publish-message-trailer-free] every commit subject the pipeline created is read back off the real commit objects and carries no Co-Authored-By and no 'Generated with', case-insensitively", () => {
      const c = caps();
      assert.ok(c.subjects.length > 0, "there are real commit subjects to read");
      for (const s of c.subjects) {
        assert.equal(/Co-Authored-By|Generated with/i.test(s), false, `commit subject must be trailer-free: ${s}`);
      }
      // NOT proven here: the rest of the §3.3:1295 denylist (Signed-off-by,
      // U+1F916), that the message BODY is trailer-free — trailers live in the
      // body, and this reads `git log --pretty=%s`, subjects only — that the
      // message names the item and its red proof, and that ZERO model
      // sub-sessions were dispatched during the publish call.
    });

    // ---- §3.4 report and stop -------------------------------------------

    it("[13.1-s1-stop-done-reported] run.json READ BACK FROM DISK carries stop {kind:'done'} and conductor_report reports the run at REPORTED", () => {
      const c = caps();
      assert.equal(c.report.runState, "REPORTED", "conductor_report closed the run");
      assert.equal(c.finalRun.stop?.kind, "done", "the run's recorded stop is `done`");
      // NOT proven here: that run.json's own `state` field is REPORTED (the
      // REPORTED reading is the handler's return value, while only the stop is
      // read back off disk), the stop's reasonDisplay/tsMs, the journaled
      // fsm:transition for the EXECUTING->REPORTED edge, and that a subsequent
      // conductor tool call against the terminal run is refused.
    });

    it("the report crosses the G5 metrics seam exactly once (no row of its own)", () => {
      const c = caps();
      // G5's touchpoint, asserted as an OBSERVED CALL: the report's metrics section
      // is there because adapter/router-client.ts really ran over a real socket, not
      // because the `metrics` field was absent and handleReport rendered the same
      // line for free. Whether the summary came back is the arm's business; that the
      // seam was crossed is this file's.
      assert.equal(
        c.seamCallsAfterReport,
        c.seamCallsBefore + 1,
        "conductor_report must CALL the injected metrics seam exactly once — a report that never reaches router-client.ts makes the two G5 arms indistinguishable",
      );
    });

    // ---- §3.5 the gates --------------------------------------------------

    it("[13.1-s1-out-of-order-tool-denied] an out-of-order conductor stage tool is REFUSED by the §3.2 phase gate with a legality-naming message", () => {
      const c = caps();
      assert.equal(
        c.planBeforeClassify.threw,
        true,
        "conductor_plan before classify must be refused by the §3.2 phase gate; a gate that never denies is not a gate",
      );
      const err = c.planBeforeClassify.error as Error;
      assert.ok(err instanceof Error, "the refusal must be a thrown Error");
      assert.match(err.message, /legal|INTAKE|classif/i, "the refusal must name the legality it enforced");
      // NOT proven here: the row's own case — conductor_publish named at an item
      // still at PENDING, called through the PLUGIN'S TOOL MAP rather than the
      // handler directly — and the whole SG-2 half, that the item file, run.json,
      // the evidence ledger and git HEAD are byte-identical after the throw.
    });

    it("[13.1-s1-orchestrator-edit-denied] an ORCHESTRATOR edit to a source file is denied through the REAL tool.execute.before hook", () => {
      const c = caps();
      assert.ok(c.gateHookPresent, "the plugin must keep its tool.execute.before gate hook");
      assert.equal(c.orchestratorEdit.threw, true, "an orchestrator edit with no inline claim was ALLOWED; a gate that never denies is not a gate");
      const err = c.orchestratorEdit.error as Error;
      assert.ok(err instanceof Error, "denial must be a thrown Error (opencode reads its message back to the model)");
      assert.ok(err.message.length > 0, "the orchestrator-edit refusal must carry a reason");
      // NOT proven here: that the message names the RULE and the legal
      // alternative (the assertion above only requires a non-empty reason), that
      // the file is byte-identical afterwards, and that the deny is journaled at
      // warn level as gates/deny with the §7.4 snapshot.
    });

    it("[13.1-s1-spawn-denied-everywhere] a sub-agent spawn through the real hook is DENIED for the orchestrator session", () => {
      const c = caps();
      assert.ok(c.gateHookPresent, "the plugin must keep its tool.execute.before gate hook");
      assert.equal(c.spawnFromOrchestrator.threw, true, "an orchestrator sub-agent spawn was ALLOWED; conductor owns dispatch (§3.5)");
      const err = c.spawnFromOrchestrator.error as Error;
      assert.ok(err instanceof Error, "denial must be a thrown Error");
      assert.ok(err.message.length > 0, "the spawn refusal must carry a reason");
      // NOT proven here, and it is the row's entire point: "everywhere". The
      // spawn is attempted from ONE session — the orchestrator — while the row
      // demands it from a REGISTERED IMPLEMENTER and from an UNREGISTERED session
      // both, because a registry-based gate whose registry can be bypassed by a
      // tool call is not a gate.
    });

    it("[13.1-s1-unregistered-write-denied] a session with NO registry entry has its write denied through the real hook, and the refusal names the registry rule", () => {
      const c = caps();
      assert.ok(c.gateHookPresent, "the plugin must keep its tool.execute.before gate hook");
      assert.equal(c.strayWrite.threw, true, "an unregistered session's write was ALLOWED; a gate that never denies is not a gate");
      const err = c.strayWrite.error as Error;
      assert.ok(err instanceof Error, "denial must be a thrown Error (opencode reads its message back to the model)");
      assert.match(err.message, /regist/i, "the refusal must name the registry rule it enforced");
      // NOT proven here: the write-shaped BASH half of the disposition table,
      // and — the half the row calls load-bearing — that the same unregistered
      // session's READ is ALLOWED, without which this proves only that something
      // was denied, not that the right thing was.
    });

    // ---- §3.6 the override ----------------------------------------------

    it("[13.1-s1-override-once-taint-in-report] conductor_override is spent ONCE, records an `override` anomaly on the §2.8 ledger, and the taint reaches report.md", () => {
      const c = caps();
      assert.ok(c.override !== null, "the override handler returned a grant record");
      assert.ok(
        c.anomalies.some((a) => a.kind === "override"),
        "the override is recorded on the §2.8 anomaly ledger — the model's only fabrication path is a loud one",
      );
      assert.equal(
        c.anomalies.filter((a) => a.kind === "override").length,
        1,
        "exactly one override was spent in this run (SG-9 bounds it at one)",
      );
      assert.match(c.reportMd, /override/i, "the spent override is visible in the report rather than buried in a ledger");
      // NOT proven here: the one-shot EDIT mechanics the grant buys — that the
      // next orchestrator edit inside the item's fileScope is ALLOWED and lands
      // on disk, that the SECOND identical edit is re-DENIED, that the entry is
      // appended to the item's taint[], and that run.counters.overridesUsed is 1.
      // This scenario spends the grant and asserts the LEDGER trail; the
      // conversion at the gate is conductor/tests/tools-9.5c.test.ts's subject.
    });

    // ---- §4.4 the report document ---------------------------------------

    it("[13.1-s1-report-content] runs/<runId>/report.md is written and names both items, the spent override's taint, and a §4.4 metrics section", () => {
      const c = caps();
      assert.ok(c.reportExists, "report.md was written");
      assert.match(c.reportMd, /I1/, "the report names the first item");
      assert.match(c.reportMd, /I2/, "the report names the second item");
      assert.match(c.reportMd, /override/i, "the spent override is visible in the report");
      assert.match(c.reportMd, /## Metrics/, "the report carries the §4.4 metrics section the seam feeds");
      // NOT proven here — most of the row: per-item WHAT-SHIPPED with each
      // item's red proof and review rounds (naming "I1" is not naming what
      // shipped), the EXCLUSIONS the closing verify applied, the publish-skipped
      // pre-existing dirty path (never seeded in this scenario), the
      // decision-ledger summary (the canned planner emits no decisions), and the
      // deferred section stating none (SG-5). The row's "OPEN QUESTION with its
      // exact Q-id" clause is not merely unasserted but UNREACHABLE here: this
      // scenario mints zero questions, as the plan-review row asserts.
    });
  },
);

// ===========================================================================
// Scenario 1's CORRECTION LOOPS, each walked end to end
//
// The scenario above rides the happy path: every critic approves, every review
// lens is silent, and the one item-level finding is refuted. That leaves the
// §3.3 correction loops — the loops the whole design exists for — untravelled,
// which is exactly how a suite stays green while the budgets that bound those
// loops are set to zero. Each test below drives ONE loop, and each of them feeds
// the machine something it MUST refuse: a test that does not pin its acceptance,
// an implementation that ignores an acceptance line, a test that does not pin
// the behaviour once the implementation exists, and a test that cannot be parsed
// at all. Every scripted reply is derived from the text the handler actually
// sent — the critics judge the test they were shown, the reviewers judge the
// tree as it stands, and the fixers act on the finding they were handed — so a
// loop that stopped re-reading, stopped re-dispatching or stopped re-running
// cannot reach the end of any of these tests.
// ===========================================================================

test(
  "[13.1-s1-vet-mustfix-then-vetted] the RED->TEST_VETTED vet loop really turns: round 1's critics return ONE mustFix over a test that does not pin its acceptance, the handler routes it BACK TO THE TEST-WRITER (never the implementer) carrying the union, the repaired test is re-run and must still be a §2.6.1-legal red, round 2 is clean — and the item's persisted §2.6 red pointer names the POST-repair failure rather than the pre-repair one (C-032)",
  { timeout: 120_000 },
  async () => {
    const FILE = "src/shout.ts";
    const TEST_REL = "tests/shout.test.ts";
    const ACCEPTANCE = 'shout("hi") === "HI!"';
    // The must-fix the critics raise, and the assertion that answers it. The
    // scripted critic looks for the ASSERTION in the test it is shown, and the
    // scripted writer looks for the MUST-FIX in the prompt it is given: neither
    // side counts rounds, so a handler that stopped delivering the union, or
    // stopped re-reading the repaired test, never reaches a clean round.
    const MUST_FIX = 'assert the acceptance line ' + ACCEPTANCE + ", not merely the subject's type";
    const STRONG_ASSERT = 'assert.equal(shout("hi"), "HI!");';
    const IMPORTS =
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { shout } from "../' +
      FILE +
      '";\n\n';
    // A tautology dressed as a test: it imports the subject (so its failure is a
    // legal missing-subject red) and asserts nothing a wrong implementation
    // would fail. This is the input the vet exists to REFUSE.
    const WEAK_TEST = IMPORTS + 'test("shout exists", () => {\n  assert.equal(typeof shout, "function");\n});\n';
    const STRONG_TEST = IMPORTS + 'test("shout shouts", () => {\n  ' + STRONG_ASSERT + "\n});\n";
    const IMPL = 'export function shout(s) { return s.toUpperCase() + "!"; }\n';

    const QUEUE = {
      items: [
        queueItem({
          id: "V1",
          title: "shout",
          fileScope: [FILE],
          testScope: [TEST_REL],
          acceptance: [ACCEPTANCE],
        }),
      ],
    };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a behavioural helper", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nBuild shout, verified by its own test file.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
      if (ctx.role === "testWriter") {
        // The repair dispatch is recognised by the critics' OWN must-fix line,
        // never by a call counter: a union that never reached the writer leaves
        // this responder writing the weak test again, and the vet caps out.
        if (ctx.text.includes(MUST_FIX)) {
          return { body: done("rewrote the test around the acceptance line"), write: [{ rel: TEST_REL, text: STRONG_TEST }] };
        }
        return { body: done("wrote the test"), write: [{ rel: TEST_REL, text: WEAK_TEST }] };
      }
      if (ctx.role === "implementer") {
        return { body: done("wrote the module"), write: [{ rel: FILE, text: IMPL }] };
      }
      if (ctx.role === "reviewer") {
        // The critics judge the test they were SHOWN — that is the whole loop.
        if (ctx.itemState === "RED") {
          return { body: ctx.text.includes(STRONG_ASSERT) ? testVet() : testVet([MUST_FIX]) };
        }
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({ tag: "vetloop", prompt: "add a shout helper with tests", script });
    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });
    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });
    const wave = await drainWaves(bench);
    const disposition = wave.items.find((d) => d.itemId === "V1");
    assert.equal(
      disposition?.state,
      "PUBLISHED",
      `the item must clear the vet loop and publish; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
    );

    const item = itemOf(bench, "V1");
    assert.equal(item.attempts.vetRounds, 2, "the vet really ran a SECOND round, over the repaired test");
    assert.equal(item.blocked, null, "the loop settled the item itself rather than blocking it");
    assert.equal(
      readQuestions(bench.runDir).length,
      0,
      "no §2.11 question: a loop that closed inside its budget asks nobody anything",
    );

    // The re-dispatch went BACK TO THE TEST-WRITER, carrying the critics' union —
    // and no implementer was ever asked to fix a test.
    const redWriters = bench.wiring.prompted.filter((p) => p.role === "testWriter" && p.itemState === "RED");
    assert.equal(redWriters.length, 1, "exactly one must-fix repair dispatch, and it went to the test-writer");
    assert.ok(
      redWriters[0].text.includes(MUST_FIX),
      "the repair prompt carried the critics' own must-fix line: a re-dispatch that does not say what to fix is a re-roll",
    );
    assert.equal(
      bench.wiring.prompted.filter((p) => p.role === "implementer" && p.itemState === "RED").length,
      0,
      "a test defect is never routed to the implementer — it is gated to fileScope, so that dispatch is a guaranteed denial",
    );

    // C-032, end to end: the repaired test was RE-RUN and the item's §2.6 pointer
    // names THAT failure. Pointing at the pre-repair red would vet one test and
    // ship another.
    const reds = evidenceOf(readEvidence(bench.runDir), "red", "V1");
    assert.equal(reds.length, 2, "both the pre-repair red and the post-repair re-run are on the ledger");
    assert.equal(
      item.evidence.red?.seq,
      reds[1].seq,
      "the item's persisted red pointer names the POST-repair failure (C-032)",
    );
    assert.notEqual(item.evidence.red?.seq, reds[0].seq, "and not the pre-repair one the critics rejected");

    const shipped = publishedFiles(bench.root, bench.baseCommit);
    assert.ok(shipped.includes(TEST_REL), "the vetted test is what shipped");
    assert.equal(
      readFileSync(path.join(bench.root, TEST_REL), "utf8"),
      STRONG_TEST,
      "and it is the REPAIRED test, not the tautology the critics refused",
    );
  },
);

test(
  "[13.1-s1-review-spec-finding-routed-to-implementer] a surviving spec/contract finding whose suggested fix touches fileScope ONLY dispatches an implementer and ZERO test-writers, the fixed tree is re-validated and then re-reviewed by fresh lenses that see the fix, and the item advances on that clean second round with the FIXED module in the commit",
  { timeout: 120_000 },
  async () => {
    const FILE = "src/pad.ts";
    const TEST_REL = "tests/pad.test.ts";
    // The SECOND half of the acceptance line is the one the first implementation
    // ignores and the item's test never pins — a spec/contract defect that a
    // green verify cannot see, which is why the lens exists. (One line, not two:
    // §3.2's one-cluster item budget rejects a queue item whose acceptance
    // spans two clusters, so the second check rides the same criterion.)
    const ACCEPTANCE = ['pad("a") === "[a]", and pad("") === ""'];
    const SPEC_FIX_MARKER = 'if (s.length === 0) return "";';
    const IMPL_BEFORE = 'export function pad(s) { return "[" + s + "]"; }\n';
    const IMPL_AFTER = "export function pad(s) { " + SPEC_FIX_MARKER + ' return "[" + s + "]"; }\n';
    const ITEM_TEST =
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { pad } from "../' +
      FILE +
      '";\n\ntest("pad wraps", () => {\n  assert.equal(pad("a"), "[a]");\n});\n';

    const SF1 = {
      id: "SF1",
      severity: "major",
      lens: "spec/contract",
      claim: 'the implementation ignores the second half of the item\'s acceptance line: pad("") must return the empty string',
      evidence: "the module wraps every input, the empty one included",
      suggestedFix: "return the empty string for an empty input in " + FILE,
    };

    const QUEUE = {
      items: [
        queueItem({ id: "S1", title: "pad", fileScope: [FILE], testScope: [TEST_REL], acceptance: ACCEPTANCE }),
      ],
    };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a behavioural helper", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") {
        if (ctx.text.includes("SF1")) {
          return {
            body: { findingId: "SF1", upheld: true, reasoning: "the acceptance line really is unimplemented in the module as it stands" },
          };
        }
        return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      }
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nBuild pad, verified by its own test file.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
      if (ctx.role === "testWriter") {
        return { body: done("wrote the test"), write: [{ rel: TEST_REL, text: ITEM_TEST }] };
      }
      if (ctx.role === "implementer") {
        // The FIX dispatch is recognised by the finding it carries. An
        // implementer that was never handed SF1 writes the unfixed module again,
        // the next round raises it again, and the review caps out blocked.
        if (ctx.text.includes("SF1")) {
          return { body: done("handled the empty input"), write: [{ rel: FILE, text: IMPL_AFTER }] };
        }
        return { body: done("wrote the module"), write: [{ rel: FILE, text: IMPL_BEFORE }] };
      }
      if (ctx.role === "reviewer") {
        // One role, three stages: a RED item is being test-vetted; a review LENS
        // session is the one whose prompt carries the LENSES line; anything else
        // asking a reviewer about this item is the §3.3 changed-test re-vet.
        if (ctx.itemState === "RED") return { body: testVet() };
        if (!ctx.text.includes("LENSES:")) return { body: testVet() };
        if (!ctx.text.includes("LENSES: spec/contract")) return { body: noFindings() };
        // The spec lens judges the fileScope AS IT STANDS, which the handler's
        // own diff block carries into this prompt.
        if (ctx.text.includes(SPEC_FIX_MARKER)) return { body: noFindings() };
        return { body: { findings: [SF1] } };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({ tag: "specroute", prompt: "add a pad helper with tests", script });
    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });
    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });
    const wave = await drainWaves(bench);
    const disposition = wave.items.find((d) => d.itemId === "S1");
    assert.equal(
      disposition?.state,
      "PUBLISHED",
      `the item must clear the review loop and publish; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
    );

    const item = itemOf(bench, "S1");
    assert.equal(item.attempts.reviewRounds, 2, "the review really ran a SECOND round, over the fixed tree");
    assert.equal(item.blocked, null, "the finding was fixed rather than escalated");
    assert.equal(readQuestions(bench.runDir).length, 0, "no §2.11 question: the machine had a move and made it");

    // §3.3 routing by path: fileScope only means the implementer, and ONLY the
    // implementer.
    const carried = bench.wiring.prompted.filter((p) => p.text.includes("SF1"));
    assert.equal(
      carried.filter((p) => p.role === "implementer").length,
      1,
      "the surviving spec finding dispatched exactly one implementer fix",
    );
    assert.equal(
      carried.filter((p) => p.role === "testWriter").length,
      0,
      "a fix that touches only fileScope NEVER reaches the test-writer",
    );
    assert.equal(
      bench.wiring.byRole("testWriter").length,
      1,
      "the only test-writer dispatch in this item's whole life was the original RED-stage write",
    );

    // fix => re-validate => re-review, in that order and with fresh lenses that
    // really see the fixed tree.
    const lenses = bench.wiring.prompted.filter((p) => p.role === "reviewer" && p.text.includes("LENSES:"));
    assert.equal(lenses.length, 6, "two review rounds of three lens sessions each (the §3.3 three-session floor)");
    assert.equal(
      lenses.slice(0, 3).some((p) => p.text.includes(SPEC_FIX_MARKER)),
      false,
      "the first round's lenses reviewed the UNFIXED module",
    );
    assert.ok(
      lenses.slice(3).every((p) => p.text.includes(SPEC_FIX_MARKER)),
      "the second round's lenses reviewed the FIXED module — the re-review is over the tree the fix produced",
    );
    const verifies = evidenceOf(readEvidence(bench.runDir), "verify");
    assert.ok(verifies.length >= 2, `the fix round was followed by a real re-validate (saw ${verifies.length} verify record(s))`);
    assert.ok(
      verifies.every((r) => r.green),
      "every verify in this run was green: the routed fix never regressed the suite",
    );

    assert.equal(
      git(bench.root, ["show", "HEAD:" + FILE]),
      IMPL_AFTER,
      "what SHIPPED is the module the routed fix wrote, not the one the review refused",
    );
  },
);

test(
  "[13.1-s1-review-test-adequacy-routed-to-testwriter-revetted] the §3.3:1250-1258 rule: a surviving TEST-ADEQUACY finding dispatches the TEST-WRITER and NEVER the implementer, and the changed test RE-ENTERS the test discipline — re-run through evidence, then re-vetted by fresh critics — BEFORE the item is re-validated and re-reviewed",
  { timeout: 120_000 },
  async () => {
    const FILE = "src/clip.ts";
    const TEST_REL = "tests/clip.test.ts";
    const ACCEPTANCE = 'clip("  a  ") === "a"';
    const TA_ASSERT = 'assert.equal(clip("a"), "a");';
    const IMPORTS =
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clip } from "../' +
      FILE +
      '";\n\n';
    const THIN_TEST = IMPORTS + 'test("clip trims", () => {\n  assert.equal(clip("  a  "), "a");\n});\n';
    const FULL_TEST =
      THIN_TEST + '\ntest("clip leaves a trimmed string alone", () => {\n  ' + TA_ASSERT + "\n});\n";
    const IMPL = "export function clip(s) { return s.trim(); }\n";

    const TA1 = {
      id: "TA1",
      severity: "major",
      lens: "test-adequacy",
      claim: "the test never pins that an already-trimmed string comes back unchanged",
      evidence: "the only assertion feeds a padded string, so a trim-everything implementation still passes",
      suggestedFix: "add the already-trimmed case to " + TEST_REL,
    };

    const QUEUE = {
      items: [
        queueItem({ id: "A1", title: "clip", fileScope: [FILE], testScope: [TEST_REL], acceptance: [ACCEPTANCE] }),
      ],
    };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a behavioural helper", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") {
        if (ctx.text.includes("TA1")) {
          return { body: { findingId: "TA1", upheld: true, reasoning: "the untouched case really is unasserted" } };
        }
        return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      }
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nBuild clip, verified by its own test file.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
      if (ctx.role === "testWriter") {
        // The review-fix dispatch is recognised by the finding it carries.
        if (ctx.text.includes("TA1")) {
          return { body: done("added the already-trimmed case"), write: [{ rel: TEST_REL, text: FULL_TEST }] };
        }
        return { body: done("wrote the test"), write: [{ rel: TEST_REL, text: THIN_TEST }] };
      }
      if (ctx.role === "implementer") {
        return { body: done("wrote the module"), write: [{ rel: FILE, text: IMPL }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        if (!ctx.text.includes("LENSES:")) return { body: testVet() };
        if (!ctx.text.includes("LENSES: test-adequacy")) return { body: noFindings() };
        // The adequacy lens judges the test AS IT STANDS, which the handler
        // carries into this prompt.
        if (ctx.text.includes(TA_ASSERT)) return { body: noFindings() };
        return { body: { findings: [TA1] } };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({ tag: "adequacy", prompt: "add a clip helper with tests", script });
    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });
    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });
    const wave = await drainWaves(bench);
    const disposition = wave.items.find((d) => d.itemId === "A1");
    assert.equal(
      disposition?.state,
      "PUBLISHED",
      `the item must clear the review loop and publish; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
    );

    const item = itemOf(bench, "A1");
    assert.equal(item.attempts.reviewRounds, 2, "the review really ran a SECOND round, over the changed test");
    assert.equal(item.blocked, null, "the finding was fixed rather than escalated");
    assert.equal(readQuestions(bench.runDir).length, 0, "no §2.11 question was raised");

    const carried = bench.wiring.prompted.filter((p) => p.text.includes("TA1"));
    assert.equal(
      carried.filter((p) => p.role === "testWriter").length,
      1,
      "the surviving test-adequacy finding dispatched exactly one test-writer fix",
    );
    assert.equal(
      carried.filter((p) => p.role === "implementer").length,
      0,
      "and ZERO implementer dispatches carried it — the implementer is gated to fileScope (§3.3:1250-1258)",
    );

    // The changed test RE-ENTERED the test discipline: a fresh critic judged it,
    // and that critic was shown the CHANGED text.
    const revets = bench.wiring.prompted.filter(
      (p) => p.role === "reviewer" && p.itemId === "A1" && p.itemState === "VALIDATED" && !p.text.includes("LENSES:"),
    );
    assert.equal(revets.length, 1, "the changed test was re-vetted by exactly one fresh critic (readFanout('vet') = 1)");
    assert.ok(revets[0].text.includes(TA_ASSERT), "the re-vet judged the CHANGED test, not the one the finding condemned");

    // And the ORDER §3.3 demands: re-run, then re-vet, then re-validate. The
    // §2.6 ledger's own sequence numbers are the witness — the changed test's
    // re-run lands AFTER the first validate and BEFORE the re-validate.
    const records = readEvidence(bench.runDir);
    const greens = evidenceOf(records, "green", "A1");
    const verifies = evidenceOf(records, "verify");
    assert.ok(greens.length >= 2, `the changed test was really re-run (saw ${greens.length} green record(s))`);
    assert.ok(verifies.length >= 2, `and a re-validate really followed it (saw ${verifies.length} verify record(s))`);
    assert.ok(
      greens[1].seq > verifies[0].seq,
      "the changed test's re-run came after the item's first validate",
    );
    assert.ok(
      verifies[1].seq > greens[1].seq,
      "and the re-validate came after that re-run: the test discipline runs BEFORE the item is re-validated",
    );

    assert.equal(
      git(bench.root, ["show", "HEAD:" + TEST_REL]),
      FULL_TEST,
      "what SHIPPED is the strengthened test the routed fix wrote",
    );
  },
);

test(
  "[13.1-s1-syntax-error-is-not-red-and-is-repaired] a first test attempt with a genuine SYNTAX error is classified `error`, REFUSED as a red, and handed back to the test-writer with the handler's own classification; the repaired attempt goes legally red, the item advances on THAT red and is never blocked — the repair budget bounds the loop rather than ending it",
  { timeout: 120_000 },
  async () => {
    const FILE = "src/dash.ts";
    const TEST_REL = "tests/dash.test.ts";
    // Unparseable: it cannot be evaluated at all, so §2.6.1 classifies it
    // `error` and the stage refuses it as a red however plausible it looks.
    const BROKEN_TEST = 'import test from "node:test";\ntest("broken", () => {\n  assert.equal(((;\n});\n';
    const GOOD_TEST = itemTestSource(FILE, '"a b"', '"a-b"');
    const IMPL = 'export function fn(s) { return s.split(" ").join("-"); }\n';

    const QUEUE = {
      items: [
        queueItem({
          id: "Y1",
          title: "dash",
          fileScope: [FILE],
          testScope: [TEST_REL],
          acceptance: ['dash("a b") === "a-b"'],
        }),
      ],
    };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a behavioural helper", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nBuild dash, verified by its own test file.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
      if (ctx.role === "testWriter") {
        // The repair dispatch is recognised by the handler's OWN refusal — the
        // captured failure and its class, handed back. A stage that swallowed
        // the classification would leave this responder writing the unparseable
        // file again until the budget ran out.
        if (ctx.text.includes("YOUR TEST IS NOT A LEGAL RED")) {
          return { body: done("repaired the test"), write: [{ rel: TEST_REL, text: GOOD_TEST }] };
        }
        return { body: done("wrote the test"), write: [{ rel: TEST_REL, text: BROKEN_TEST }] };
      }
      if (ctx.role === "implementer") {
        return { body: done("wrote the module"), write: [{ rel: FILE, text: IMPL }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({ tag: "syntaxrepair", prompt: "add a dash helper with tests", script });
    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });
    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });
    const wave = await drainWaves(bench);
    const disposition = wave.items.find((d) => d.itemId === "Y1");
    assert.equal(
      disposition?.state,
      "PUBLISHED",
      `the repaired item must advance all the way; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
    );

    const item = itemOf(bench, "Y1");
    assert.equal(item.blocked, null, "the item was NEVER blocked: the repair budget bounded the loop, it did not end it");
    assert.equal(item.attempts.testRepairs, 1, "exactly one repair was spent of the configured workflow.testRepairAttempts");
    assert.equal(readQuestions(bench.runDir).length, 0, "no §2.11 question: nothing needed a human");

    const reds = evidenceOf(readEvidence(bench.runDir), "red", "Y1");
    assert.equal(reds.length, 2, "the refused attempt and the legal one are both on the §2.6 ledger");
    assert.equal(reds[0].failureClass, "error", "a test that cannot be PARSED is §2.6.1 class `error`");
    assert.equal(
      reds[1].failureClass,
      "missing-subject",
      "and the repaired attempt fails for a legal reason: the subject this item builds does not exist yet",
    );
    assert.equal(
      item.evidence.red?.seq,
      reds[1].seq,
      "the item advanced on the REPAIRED red; a run that advanced on the syntax error would have proved nothing about the behaviour",
    );

    const writers = bench.wiring.byRole("testWriter");
    assert.equal(writers.length, 2, "one initial write plus exactly one repair dispatch");
    assert.ok(
      writers[1].text.includes('classified as "error"'),
      "the repair prompt handed back the handler's own §2.6.1 classification, so the writer is told WHY it was refused",
    );

    assert.equal(
      git(bench.root, ["show", "HEAD:" + TEST_REL]),
      GOOD_TEST,
      "what SHIPPED is the repaired test, not the unparseable one",
    );
  },
);

// ===========================================================================
// Scenario 1's LAST unwalked loop — §3.3 DEBUG (GREEN -> VALIDATED)
//
// Every loop above corrects work the pipeline can see going wrong at the stage
// that produced it: a test that does not pin its acceptance, a test that cannot
// be parsed, a module a review lens can read the defect out of. The DEBUG loop
// exists for the one shape all of them are blind to — an implementation that
// PASSES ITS OWN ITEM TEST and REGRESSES SOMETHING ELSE. Only the FULL verify at
// GREEN->VALIDATED can see that, so it is the only stage that can enter the
// branch, and until this scenario no test in this file ever took a red there:
// `packs["debug.md"]` was never read, `attempts.debugFixes` never moved, and
// `workflow.debugFixCap` could be set to 0 with the whole suite still green.
//
// The lever is the fixture's OWN committed baseline. The item's fileScope IS
// `src/baseline.ts` — the module `tests/baseline.test.ts` measures — and the
// item asks for a new behaviour on it. The implementer delivers that behaviour
// in the shape that satisfies the new test and breaks the old contract:
//
//   the ITEM test runs `tests/suffix.test.ts` and NOTHING else  -> green -> GREEN
//   the FULL verify runs `tests/*.test.ts`                      -> red on baseline
//
// and the red lands on a test file no queue item owns, so §4.2 never quarantines
// it, no repair budget above ever sees it, and the only machinery left that can
// answer it is the DEBUG protocol.
// ===========================================================================

test(
  "[13.1-s1-debug-loop-regression] the §3.3 DEBUG loop really turns: an implementer ships a module that PASSES the item test and REGRESSES the fixture's committed baseline, conductor_validate takes a RED FULL VERIFY, sets the debug posture off the verify's OWN failure, dispatches a fix sub-session whose prompt carries doctrine debug.md VERBATIM plus that captured failure, and the repaired module re-verifies green — the item reaching VALIDATED with attempts.debugFixes moved, no §2.11 question, and a published tree whose whole suite passes",
  { timeout: 120_000 },
  async () => {
    // The item's fileScope is the COMMITTED baseline subject: that is the whole
    // lever. An item whose fileScope file is greenfield cannot regress anything,
    // which is exactly why every earlier scenario's full verify was green the
    // first time it ran.
    const FILE = BASELINE_SUBJECT_REL;
    const TEST_REL = "tests/suffix.test.ts";
    const ACCEPTANCE = 'baseline("x") === "baseline:x"';

    // The doctrine the DEBUG dispatch is contracted to carry, read off disk and
    // keyed the way the SHIPPED loader keys it. The responder below gates on this
    // TEXT and not on a call counter, so a dispatch that arrives without the
    // doctrine gets the SAME regressing module again and the loop caps out.
    const DEBUG_DOCTRINE = PACKS["debug.md"];
    assert.ok(
      typeof DEBUG_DOCTRINE === "string" && DEBUG_DOCTRINE.trim().length > 0,
      "the real doctrine/debug.md must have been read off disk; a scenario gating on an empty string gates on nothing",
    );

    const ITEM_TEST =
      'import test from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { baseline } from "../' +
      FILE +
      '";\n\n' +
      'test("baseline appends the suffix it is given", () => {\n' +
      '  assert.equal(baseline("x"), "baseline:x");\n' +
      "});\n";

    // The regression, in the shape a real implementer produces: it satisfies the
    // acceptance line exactly and quietly drops the no-argument contract the
    // committed baseline test pins (`baseline()` becomes "baseline:undefined").
    const REGRESSING = 'export function baseline(s) { return "baseline:" + s; }\n';
    // The root-cause fix: the new behaviour, WITHOUT breaking the old one.
    const REPAIRED =
      'export function baseline(s) { return s === undefined ? "baseline" : "baseline:" + s; }\n';

    const QUEUE = {
      items: [
        queueItem({
          id: "G1",
          title: "baseline takes an optional suffix",
          fileScope: [FILE],
          testScope: [TEST_REL],
          acceptance: [ACCEPTANCE],
        }),
      ],
    };

    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return { body: { kind: "work", rationale: "a behavioural change to an existing module", confidence: "high", trivialItem: null } };
      }
      if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
      if (ctx.role === "planner") {
        if (ctx.nth === 0) return { body: QUEUE };
        return { body: { markdown: "# plan\n\nExtend baseline with an optional suffix, verified by its own test file.\n", decisions: [] } };
      }
      if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
      if (ctx.role === "testWriter") {
        return { body: done("wrote the item test"), write: [{ rel: TEST_REL, text: ITEM_TEST }] };
      }
      if (ctx.role === "implementer") {
        // THE DISCRIMINATOR, and it is the doctrine itself. A fix dispatch that
        // did not carry debug.md is indistinguishable from the first
        // implementation as far as this responder is concerned — it writes the
        // regressing module again, the re-verify stays red, and the item ends at
        // the cap blocked on a `debug-architecture` question instead of PUBLISHED.
        if (ctx.text.includes(DEBUG_DOCTRINE)) {
          return {
            body: done("root cause: the suffix parameter dropped the no-argument contract; restored it"),
            write: [{ rel: FILE, text: REPAIRED }],
          };
        }
        return { body: done("wrote the module"), write: [{ rel: FILE, text: REGRESSING }] };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    const bench = await makeBench({
      tag: "debugloop",
      prompt: "let baseline take an optional suffix",
      script,
    });
    await handleClassify({ ...stageBase(bench) });
    await handleDecompose({ ...stageBase(bench) });
    await handlePlan({ ...stageBase(bench) });
    await handlePlanReview({ ...stageBase(bench) });
    const wave = await drainWaves(bench);
    const disposition = wave.items.find((d) => d.itemId === "G1");
    assert.equal(
      disposition?.state,
      "PUBLISHED",
      `the item must clear the DEBUG loop and publish; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
    );

    // --- the shape the DEBUG loop exists for, MEASURED --------------------------
    // A green item test and a red full verify, in that order, off the §2.6 ledger.
    // If these two ever agreed, this scenario would be walking some other branch.
    const records = readEvidence(bench.runDir);
    const greens = evidenceOf(records, "green", "G1");
    const verifies = evidenceOf(records, "verify", "G1");
    assert.equal(greens.length, 1, "the item test went green exactly once, at mark_green");
    assert.ok(
      greens[0].command.some((arg) => arg.includes(TEST_REL)),
      `the item test ran the item's OWN test file: ${JSON.stringify(greens[0].command)}`,
    );
    assert.equal(
      greens[0].command.some((arg) => arg.includes(BASELINE_TEST_REL)),
      false,
      "and it never ran the baseline test — an item test that already covered the whole suite could not produce this shape",
    );
    assert.ok(verifies.length >= 2, `the full verify ran at least twice (red, then post-fix): saw ${verifies.length}`);
    assert.equal(
      verifies[0].green,
      false,
      "the FIRST full verify is RED: the module that passed its own test regressed the committed baseline",
    );
    assert.ok(
      greens[0].seq < verifies[0].seq,
      "and the green item test came FIRST — the item really was at GREEN when the red verify arrived",
    );
    assert.equal(verifies[0].scopes.unit?.green, false, "the red is the `unit` scope's, named on the record");
    assert.notEqual(verifies[0].scopes.unit?.exitCode, 0, "with a real non-zero exit code behind it");
    assert.deepEqual(
      verifies[0].excluded,
      [],
      "nothing was quarantined: the regressed test belongs to no queue item, so §4.2 could not hide it",
    );
    assert.equal(verifies[1].green, true, "the SECOND full verify — the one after the debug fix — is green");
    assert.equal(
      itemOf(bench, "G1").evidence.validated?.seq,
      verifies[1].seq,
      "and VALIDATED rests on THAT verify, not on the red one that preceded it",
    );

    // --- the DEBUG dispatch, and the doctrine it carried ------------------------
    const impls = bench.wiring.prompted.filter((p) => p.role === "implementer" && p.itemId === "G1");
    assert.equal(impls.length, 2, "two implementer dispatches: the first implementation, then ONE debug fix");
    assert.equal(
      impls[0].text.includes(DEBUG_DOCTRINE),
      false,
      "the FIRST implementer dispatch carries no debug doctrine — otherwise `carries debug.md` would be a property of every prompt and prove nothing",
    );
    const fix = impls[1];
    assert.equal(fix.itemState, "GREEN", "the fix was dispatched while the item sat at GREEN — i.e. from conductor_validate, not from any earlier stage");
    assert.ok(
      fix.text.includes(DEBUG_DOCTRINE),
      "the DEBUG dispatch carries doctrine debug.md VERBATIM: the protocol that governs the fix must reach the sub-session performing it",
    );
    assert.match(
      fix.text,
      /Fix attempt 1 of workflow\.debugFixCap=2/,
      "and it says which attempt of which budget it is, so the sub-session knows how much rope is left",
    );
    assert.match(
      fix.text,
      /scope unit exited [1-9]/,
      "and it carries the VERIFY'S OWN captured failure — a paraphrase would send the fixer after a bug nobody measured",
    );
    assert.ok(fix.text.includes(ACCEPTANCE), "the fix prompt still carries the item's acceptance line");

    // --- the budget really moved, and the loop closed inside it -----------------
    const item = itemOf(bench, "G1");
    assert.equal(item.attempts.debugFixes, 1, "the item's DEBUG fix budget was really spent once");
    assert.equal(item.debugging, null, "the debug posture is CLEARED once the verify goes green");
    assert.equal(item.blocked, null, "the loop settled the item itself rather than blocking it");
    assert.equal(
      readQuestions(bench.runDir).length,
      0,
      "no §2.11 question: a debug loop that closed inside workflow.debugFixCap asks nobody anything",
    );

    // The posture was persisted BEFORE the fixer spoke, and the journal says so.
    const debugPosture = bench.journal.records.filter(
      (r) => r.event === "guard-reject" && r.data.itemId === "G1" && r.data.debugging === true,
    );
    assert.equal(debugPosture.length, 1, "the red verify logged the DEBUG posture exactly once, on the first red round");
    assert.equal(
      debugPosture[0].data.evidenceSeq,
      verifies[0].seq,
      "and it names the red verify record it was derived from",
    );

    // --- what shipped is the FIXED module, and the tree is really whole ---------
    const shipped = publishedFiles(bench.root, bench.baseCommit);
    assert.ok(shipped.includes(FILE) && shipped.includes(TEST_REL), "the modified module and its new test both shipped");
    assert.equal(
      git(bench.root, ["show", "HEAD:" + FILE]),
      REPAIRED,
      "what SHIPPED is the root-cause fix, not the regressing module the first implementer wrote",
    );
    assert.notEqual(
      git(bench.root, ["show", "HEAD:" + FILE]),
      REGRESSING,
      "and emphatically not the version whose own test passed",
    );
    // The closing control: the fixture's OWN configured suite, run against the
    // published tree. This is the same command the pipeline's verify runs, and it
    // is the one thing the regression broke — a green here is the regression
    // really being gone rather than the pipeline having stopped looking.
    const afterPublish = controlSuite(bench.root);
    assert.equal(
      afterPublish.status,
      0,
      `the published tree's whole suite passes — baseline and the new item test together:\n${afterPublish.output}`,
    );
    assert.ok(
      afterPublish.output.includes(BASELINE_TEST_NAME),
      "and that green really executed the baseline test the regression broke",
    );
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

    const seamBefore = seamCalls.length;
    const report = await handleReport(reportArgs(bench));
    assert.equal(report.runState, "TRIVIAL_DONE", "a trivial run closes report-lite to TRIVIAL_DONE, not REPORTED");
    const md = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
    assert.match(md, new RegExp(itemId), "the lite report still names the item it published");
    assert.equal(bench.store.loadRun(bench.runId).stop?.kind, "done", "the trivial run stopped done");
    assert.equal(
      seamCalls.length,
      seamBefore + 1,
      "the lite report crosses the same G5 metrics seam the full report does",
    );
    recordFacts(bench, "trivial", "ambient", report);
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
          park: true,
        };
      }
      if (ctx.role === "implementer" && subject !== undefined) {
        return { body: done(`wrote ${subject.file}`), write: [{ rel: subject.file, text: subject.impl }], park: true };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet(), park: subject !== undefined };
        return { body: noFindings(), park: subject !== undefined };
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

    // THE DRIVER'S INTERLEAVING, not the planner's schedule. `wave.parallel`
    // below is the plan the scheduler computed BEFORE anything ran; a strictly
    // serial driver satisfies it exactly. The claim that discriminates is about
    // the fan-out layer at RUNTIME: at some instant the engine held sub-sessions
    // open for BOTH items at once. Every item-scoped sub-session parks, so the
    // watcher below reads that off the fake SDK's own pending list instead of
    // inferring it from how long anything took.
    const watcher = watchInterleaving(bench.wiring, 2);
    const wave = await drainWaves(bench);
    await watcher.stop();

    const overlap = watcher.peak();
    const overlapItems = [...new Set(overlap.map((p) => p.itemId))];
    const overlapTrees = [...new Set(overlap.map((p) => p.tree))];
    const overlapSessions = [...new Set(overlap.map((p) => p.sessionID))];
    assert.ok(
      overlapItems.length >= 2,
      "at some instant the fan-out engine had sub-sessions for BOTH items simultaneously in flight — " +
        "the claim a strictly serial driver cannot satisfy. Peak simultaneous set was " +
        JSON.stringify(overlap.map((p) => ({ role: p.role, itemId: p.itemId }))),
    );
    assert.equal(
      overlapSessions.length,
      overlap.length,
      `each concurrently-open sub-session is its own session: ${JSON.stringify(overlapSessions)}`,
    );
    assert.ok(
      overlapTrees.length >= 2,
      `the concurrent sub-sessions were bound to DISTINCT trees, not one shared tree: ${JSON.stringify(overlapTrees)}`,
    );
    for (const tree of overlapTrees) {
      assert.ok(
        tree !== bench.root && !tree.startsWith(bench.root),
        `a concurrent sub-session's tree is OUT of the repo (${tree})`,
      );
    }

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

    // ---- serial merge-back + post-merge re-validation, off the LEDGER --------
    // Read from `verify` records, which are the only kind that carries a tree and
    // a start time (§2.6): a `green` record has neither, so counting greens asks
    // the wrong question of the wrong record and cannot tell an integrated
    // re-validate from an in-worktree one.
    //
    // In worktree mode a verify taken INSIDE an item's worktree records that
    // item's own tree slug, and the integrated re-validate publish runs after the
    // merge records tree "main" (adapter/tools.ts:2400, :7202). So the two are
    // distinguishable on the record itself.
    const verifies = evidenceOf(readEvidence(bench.runDir), "verify");
    const integrated: Record<string, Extract<EvidenceRecord, { kind: "verify" }>> = {};
    for (const id of ["W1", "W2"]) {
      const own = verifies.filter((r) => r.itemId === id && r.tree === id);
      const main = verifies.filter((r) => r.itemId === id && r.tree === "main");
      assert.ok(own.length > 0, `${id} was verified INSIDE its own worktree at least once (tree "${id}")`);
      assert.ok(
        main.length > 0,
        `${id} was RE-verified against the integrated tree after its merge (a verify record with tree "main")`,
      );
      const first = main[0];
      assert.equal(first.green, true, `${id}'s integrated-tree re-validate was green`);
      assert.ok(
        first.startedMs >= own[0].startedMs,
        `${id}'s integrated re-validate started AFTER its in-worktree verify — it did not publish on the ` +
          "strength of its in-worktree green alone",
      );
      integrated[id] = first;
    }

    // Serial, and in wave order: W1's merge completed before W2's began. The
    // proof is the HEAD each integrated re-validate recorded — at the instant W1
    // re-validated the integrated tree, W1's module was in it and W2's was NOT,
    // which is exactly "A's merge completed before B's began" and is impossible
    // if the two merges overlapped.
    assert.ok(
      integrated.W1.seq < integrated.W2.seq && integrated.W1.startedMs <= integrated.W2.startedMs,
      `the merge-backs re-validated in item order: W1 seq ${integrated.W1.seq} then W2 seq ${integrated.W2.seq}`,
    );
    assert.notEqual(integrated.W1.head, bench.baseCommit, "W1's merge had landed before its integrated re-validate ran");
    assert.notEqual(integrated.W2.head, integrated.W1.head, "W2's merge landed after W1's integrated re-validate ran");
    assert.ok(
      gitOk(bench.root, ["merge-base", "--is-ancestor", integrated.W1.head, integrated.W2.head]),
      "the two integrated re-validates ran on ONE serially-advancing workspace history",
    );
    assert.ok(
      gitOk(bench.root, ["cat-file", "-e", `${integrated.W1.head}:src/upper.ts`]),
      "W1's own module was already merged into the tree its integrated re-validate measured",
    );
    assert.equal(
      gitOk(bench.root, ["cat-file", "-e", `${integrated.W1.head}:src/lower.ts`]),
      false,
      "W2 had NOT yet merged when W1's integrated re-validate ran: the merge-backs are serial, not concurrent",
    );
    assert.ok(
      gitOk(bench.root, ["cat-file", "-e", `${integrated.W2.head}:src/lower.ts`]),
      "W2's own module was merged into the tree its integrated re-validate measured",
    );
    recordFacts(bench, "worktree", "none", null);
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
    recordFacts(bench, "non-behavioral", "none", null);
  },
);

// ===========================================================================
// Scenario 5 — the bad ending
// ===========================================================================

test(
  "[13.1-bad-ending] conductor_report REFUSES to close a run whose items are still unsettled; one item then BLOCKS on an exhausted test-repair budget while its sibling is never started, and the §3.7 continuation engine — entered through the PLUGIN'S OWN `event` bus hook, the only door it has — re-prompts the orchestrator three times futilely, stops the run `noop` with a §2.8 disengage anomaly, writes a STOP-REPORT that runs no closing verify, and re-prompts no more; a SECOND run in the same fixture repo then publishes an item on a green full verify that names the §2.11 exclusion it rests on, instead of dying on a leftover red no later item owns",
  { timeout: 180_000 },
  async () => {
    const BAD_TEST = "tests/broken.test.ts";
    const SIBLING_TEST = "tests/sibling.test.ts";
    // A test with a genuine syntax error: it cannot be evaluated at all, so
    // §2.6.1 classifies it `error` — never a legal red, however many times it is
    // repaired.
    const BROKEN_SOURCE = 'import test from "node:test";\ntest("broken", () => {\n  assert.equal(((;\n});\n';

    // TWO items, and the second one is what makes this a bad ending rather than
    // a tidy one. A LONE blocked item is SETTLED (core/gates-phase.ts isSettled
    // counts `blocked !== null`), so a run holding only that closes `done` and
    // conductor_report never refuses. B1 is a real, actionable, UNSTARTED item:
    // with it in the queue `allSettled` is false, the report refuses, the gate
    // still recommends a next step, and an orchestrator that answers three
    // re-prompts by doing nothing is genuinely wedged rather than finished.
    const QUEUE = {
      items: [
        queueItem({ id: "A1", title: "broken thing", fileScope: ["src/broken.ts"], testScope: [BAD_TEST] }),
        queueItem({ id: "B1", title: "the sibling nobody started", fileScope: ["src/sibling.ts"], testScope: [SIBLING_TEST] }),
      ],
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

    // The client the plugin hands the §3.7 engine. Every re-prompt this run makes
    // is recorded here and answered with silence.
    const cont = makeContinuationClient();
    const bench = await makeBench({
      tag: "badending",
      prompt: "build the broken thing",
      // maxImplementers 1 caps the wave at ONE member (§4.2 (d)), so A1 is driven
      // to its block while B1 is never dispatched at all. B1 must be genuinely
      // UNSTARTED, not merely unfinished: an item the wave already touched would
      // change the futility signature as it moved and the wedge would never form.
      config: makeConfig({ testRepairAttempts: 1, maxImplementers: 1 }),
      script,
      client: cont.client,
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
    assert.deepEqual(
      wave.wave.parallel,
      ["A1"],
      "the wave carried A1 alone; B1 is left untouched so the run wedges with real work outstanding",
    );
    const d = wave.items.find((x) => x.itemId === "A1");
    assert.ok(d !== undefined, "the item was scheduled");
    assert.notEqual(d?.state, "PUBLISHED", "an item whose test never became a legal red must not publish");

    // The wave itself blocked the item and minted its question: a test whose
    // repair budget is exhausted is a question for a human, not a retry loop.
    const blockedItem = itemOf(bench, "A1");
    assert.ok(blockedItem.blocked !== null, "A1 is BLOCKED after its repair budget was exhausted");
    const questionId = blockedItem.blocked?.questionId ?? "";
    assert.ok(questionId.length > 0, "the block carries a question id a human can answer");
    const ledger = readQuestions(bench.runDir);
    const question = ledger.find((q) => q.id === questionId);
    assert.ok(question !== undefined, "the blocking question is on the §2.11 ledger, not only in memory");
    assert.equal(question?.answeredIso, null, "it is genuinely unanswered — that is why the run cannot close cleanly");

    // And the sibling really is UNSTARTED: no sub-session was ever opened for it,
    // and it holds the PENDING disposition the stop-report has to disclose.
    const sibling = itemOf(bench, "B1");
    assert.equal(sibling.state, "PENDING", "B1 was never started");
    assert.equal(sibling.blocked, null, "B1 is not blocked — it is simply undone, which is why the run cannot close");
    assert.equal(sibling.deferred, null, "B1 was not deferred either: nobody judged it, nobody did it");
    assert.equal(
      bench.wiring.prompted.filter((p) => p.itemId === "B1").length,
      0,
      "no sub-session was ever dispatched for B1",
    );
    assert.equal(existsSync(path.join(bench.root, SIBLING_TEST)), false, "B1's test was never written");

    // NOW the refusal that matters, and it is a DIFFERENT refusal from the one
    // above: the run holds a settled blocked item and an unsettled one, and the
    // ONE derivation both the gate and the handler read (settledForReport) names
    // the unfinished item rather than merely saying some work is unfinished.
    const refusal = await expectDeny(
      async () => {
        await handleReport(reportArgs(bench));
      },
      "conductor_report over a blocked item plus an unstarted sibling",
    );
    assert.match(refusal.message, /B1/, "the refusal NAMES the item that is neither published, blocked nor deferred");
    assert.equal(
      /\bA1\b/.test(refusal.message),
      false,
      "the blocked item is SETTLED and is not named as unfinished — a lone blocked item would have closed the run",
    );
    assert.match(refusal.message, /no verify was run/i, "the refusal precedes the closing verify (§3.2, the C-018 binding)");

    // ---- the §3.7 wedge, through the plugin's own bus hook -------------------
    // Everything below enters the continuation engine the way a live session does
    // and no other way: `session.idle` on the plugin's `event` hook. Nothing in
    // this scenario imports handleSessionIdle, because a scenario that called it
    // directly would prove the engine works and prove nothing about whether
    // anything ever reaches it.
    //
    // The evidence ledger is fingerprinted here, byte for byte. A stop-report
    // "proves no claim and re-runs nothing" (§2.9), so if the wedge path appends
    // so much as one verify record the ledger below will not match.
    const evidencePath = path.join(bench.runDir, "evidence.jsonl");
    const evidenceBefore = readFileSync(evidencePath, "utf8");
    const verifiesBefore = evidenceOf(readEvidence(bench.runDir), "verify").length;

    const savedStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = bench.stateHome;
    try {
      // Three re-prompts, and the counters read 1, 2, 3 — the engine consults the
      // wedge rule with the PERSISTED counters BEFORE the pass touches them, which
      // is the only order in which "exactly three prompts, the fourth stops" and
      // "futileRePrompts reads 1,2,3" are both true (§3.7:1463-1468).
      //
      // Each pass waits out the §3.7.4 debounce, which is what makes each one a
      // real pass rather than a silently dropped one — and the run does not move
      // between them, so every signature is identical and every re-prompt is
      // futile by measurement rather than by assertion.
      for (let pass = 1; pass <= 3; pass += 1) {
        if (pass > 1) await sleep(CONTINUATION_DEBOUNCE_MS + 200);
        await sendIdle(bench.hooks, ORCH);

        const live = bench.store.loadRun(bench.runId);
        assert.equal(cont.prompts.length, pass, `idle pass ${pass} really re-prompted the orchestrator`);
        assert.equal(cont.prompts[pass - 1].sessionID, ORCH, "the re-prompt went to the ORCHESTRATOR's session");
        assert.equal(live.counters.idleRePrompts, pass, `counters.idleRePrompts reads ${pass} after pass ${pass}`);
        assert.equal(
          live.counters.futileRePrompts,
          pass,
          `counters.futileRePrompts reads ${pass}: the run-state signature was identical, so the pass was FUTILE`,
        );
        assert.equal(live.stop, null, `the run is still live after ${pass} re-prompt(s): the limit is 3, not ${pass}`);
        assert.equal(isTerminal(live), false, "and it is still non-terminal to the ONE §2.3 definition");
        // The prompt is the gate's own next step, not a slogan — a re-prompt that
        // named nothing to do would be indistinguishable from noise.
        assert.match(cont.prompts[pass - 1].text, new RegExp(bench.runId), "the re-prompt names the run it is about");
        assert.match(cont.prompts[pass - 1].text, /conductor_/, "and the §3.4 tool the phase gate recommends next");
      }
      assert.equal(rePromptRecords(bench.runDir).length, 3, "the journal recorded all three re-prompts");

      // THE FOURTH PASS STOPS. futileRePrompts is already at the §3.7 limit, so
      // the engine records the stop instead of prompting a fourth time.
      await sleep(CONTINUATION_DEBOUNCE_MS + 200);
      await sendIdle(bench.hooks, ORCH);

      const stopped = bench.store.loadRun(bench.runId);
      assert.notEqual(stopped.stop, null, "the fourth idle pass STOPPED the run rather than prompting again");
      assert.equal(stopped.stop?.kind, "noop", "the §2.9 stop kind for a wedged run is `noop`");
      assert.match(
        stopped.stop?.reasonDisplay ?? "",
        /no observable progress/i,
        "the stop says WHY in words a human reads, not only in a kind",
      );
      assert.equal(isTerminal(stopped), true, "and the run is TERMINAL to core/stops.ts isTerminal");
      assert.equal(stopped.counters.idleRePrompts, 3, "no fourth re-prompt was charged to the orchestrator");
      assert.equal(stopped.counters.futileRePrompts, 3, "the futile counter stopped at the limit it fired on");
      assert.equal(cont.prompts.length, 3, "and no fourth prompt left the process");

      // §2.8: the disengage anomaly, written AHEAD of the stop so a process killed
      // mid-disengagement still leaves its trace.
      const disengage = readAnomalies(bench.runDir).filter((a) => a.kind === "disengage");
      assert.equal(disengage.length, 1, "the wedge left exactly one §2.8 `disengage` anomaly");
      assert.match(
        String(disengage[0].detail ?? ""),
        /re-prompt/i,
        "the anomaly names what it disengaged from, not merely that it did",
      );

      // AND IT STOPS RE-PROMPTING. A fifth idle pass, waited past the debounce so
      // its silence is a decision rather than a dropped call, adds no journal
      // record and no prompt.
      await sleep(CONTINUATION_DEBOUNCE_MS + 200);
      await sendIdle(bench.hooks, ORCH);
      assert.equal(cont.prompts.length, 3, "a terminal run is never re-prompted again");
      assert.equal(
        rePromptRecords(bench.runDir).length,
        3,
        "and no further continuation:reprompt record was journaled after the stop",
      );
      assert.equal(
        bench.store.loadRun(bench.runId).counters.idleRePrompts,
        3,
        "the counters are frozen where the stop left them",
      );
    } finally {
      if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = savedStateHome;
    }

    // ---- the stop-report ----------------------------------------------------
    // A stop-report is the third mode of the ONE report writer, selected from the
    // PERSISTED stop and nothing else. It has no all-settled precondition (a
    // stopped run is by definition unsettled) and it runs NO closing verify.
    const md = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
    assert.match(md, /^# conductor stop-report — noop — run /m, "the stop KIND is the report's headline");
    assert.match(md, /^Stop kind: noop$/m, "and it is stated as a field, not only in prose");
    assert.match(md, /^Closing verify: none/m, "the report declares that it re-ran nothing");
    assert.match(md, /### A1 — /, "the stop-report names the blocked item");
    assert.match(md, /^Disposition: blocked$/m, "with its settled disposition");
    assert.match(md, new RegExp(questionId), "and the exact question id a human must answer to unwedge it");
    assert.match(md, /### B1 — PENDING/, "it names the sibling at the FSM position nobody moved it off");
    assert.match(md, /^Disposition: unfinished$/m, "and calls that disposition unfinished rather than settled");
    assert.match(
      md,
      new RegExp("- " + BAD_TEST.replace(/\./g, "\\.") + " \\(A1\\)"),
      "and it names the newly-registered stale-red path against the item that owns it",
    );
    assert.equal(
      md.includes(SIBLING_TEST),
      false,
      "B1's test was never written, so nothing about it was registered stale-red: the registry records files that EXIST",
    );

    // NO CLOSING VERIFY. Not "a verify that passed" — none at all. The ledger is
    // byte-identical across the whole wedge path.
    assert.equal(
      readFileSync(evidencePath, "utf8"),
      evidenceBefore,
      "the stop path appended NOTHING to the §2.6 evidence ledger",
    );
    assert.equal(
      evidenceOf(readEvidence(bench.runDir), "verify").length,
      verifiesBefore,
      "zero new verify records were appended during the stop path (§2.9: a stop-report proves no claim)",
    );

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

    recordFacts(bench, "bad-ending-run1", "none", null);
    recordFacts(bench2, "bad-ending-run2", "none", null);
  },
);

// ===========================================================================
// fix-wedge-detector — the blocked-DEPENDENT wedge (plan §2.9:911-915, §3.7.1)
// ===========================================================================
//
// Scenario 5 above wedges a run behind an INDEPENDENT sibling nobody started.
// This block wedges it behind a DEPENDENT one — item B carrying dependsOn:["A1"]
// while A1 is blocked — and that difference is the whole defect. §3.7.1 gates
// re-prompting on ACTIONABLE WORK ("items not PUBLISHED/blocked, or a legal next
// run transition"), and B is neither PUBLISHED nor blocked nor deferred, so the
// plan says actionable work EXISTS here. The committed code disagrees for three
// individually-correct reasons that compose into a hole:
//
//   * core/gates-phase.ts cannotEverPublish deliberately does NOT treat a BLOCKED
//     dependency as permanently stuck ("a question can be answered and the item
//     resumes"), so B is unsettled and conductor_report CORRECTLY refuses;
//   * depsReady excludes B (A1 is not PUBLISHED) and isActionable excludes A1 (it
//     is blocked), so nextWave is empty and gate.recommended is null;
//   * adapter/continuation.ts:743-750 returns WITHOUT prompting whenever
//     recommended === null.
//
// Net: no re-prompt, so counters.futileRePrompts never moves, so core/stops.ts:113
// — which §3.7.2 calls "the ONLY wedge detector" — can never fire. The run sits in
// EXECUTING forever with no human-readable artifact, which is verbatim the failure
// §2.9:911-915 says the design exists to close.
//
// THE THREE ROWS BELOW ARE THREE PROPERTIES OF ONE WALK. Building this fixture
// costs a real repo, a real fan-out and real `node --test` spawns, and the wedge
// itself costs four §3.7.4 debounce windows of wall clock, so the walk is
// performed ONCE, it OBSERVES ONLY (it contains no assertion of its own), and each
// test asserts over the record it left. Every idle pass enters through the
// PLUGIN'S OWN `event` bus hook and no other door: a test that called
// handleSessionIdle directly would prove the engine works and prove nothing about
// whether anything reaches it, which is exactly what is broken.

const WEDGE_BAD_TEST = "tests/wedge-broken.test.ts";
const WEDGE_DEP_TEST = "tests/wedge-dependent.test.ts";
// A test with a genuine syntax error: §2.6.1 classifies it `error`, never a legal
// red, however many times the repair budget re-writes it.
const WEDGE_BROKEN_SOURCE = 'import test from "node:test";\ntest("broken", () => {\n  assert.equal(((;\n});\n';
// Three futile passes, a fourth that must stop, and a fifth whose silence is a
// decision rather than a dropped call.
const WEDGE_IDLE_PASSES = 5;

interface WedgePass {
  prompts: number;
  idleRePrompts: number;
  futileRePrompts: number;
  stopKind: string | null;
  stopReason: string | null;
  terminal: boolean;
  rePromptRecords: number;
}

interface WedgeObservation {
  bench: Bench;
  questionId: string;
  ledgerQuestionIds: string[];
  itemA: Item;
  itemB: Item;
  bDispatched: number;
  reportRefusal: string | null;
  prompts: Array<{ sessionID: string; text: string }>;
  passes: WedgePass[];
  evidenceBefore: string;
  evidenceAfter: string;
  anomalies: Array<Record<string, unknown>>;
  reportMd: string | null;
  staleRed: unknown;
}

let wedgeWalkPromise: Promise<WedgeObservation> | null = null;

function wedgeWalk(): Promise<WedgeObservation> {
  if (wedgeWalkPromise === null) wedgeWalkPromise = runWedgeWalk();
  return wedgeWalkPromise;
}

async function runWedgeWalk(): Promise<WedgeObservation> {
  const QUEUE = {
    items: [
      queueItem({ id: "A1", title: "the blocker", fileScope: ["src/wedge-a.ts"], testScope: [WEDGE_BAD_TEST] }),
      queueItem({
        id: "B1",
        title: "the dependent nobody can start",
        fileScope: ["src/wedge-b.ts"],
        testScope: [WEDGE_DEP_TEST],
        dependsOn: ["A1"],
      }),
    ],
  };

  const script: Script = (ctx) => {
    if (ctx.role === "mechanical") {
      return { body: { kind: "work", rationale: "a behavioural change", confidence: "high", trivialItem: null } };
    }
    if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
    if (ctx.role === "planner") {
      if (ctx.nth === 0) return { body: QUEUE };
      return { body: { markdown: "# plan\n\nBuild the blocker, then the dependent.\n", decisions: [] } };
    }
    if (ctx.role === "reviewer" && ctx.itemId === "") return { body: noFindings() };
    if (ctx.role === "testWriter") {
      // Every repair attempt writes the same unevaluable test, so the budget is
      // really exhausted rather than short-circuited.
      return { body: done("wrote the test"), write: [{ rel: WEDGE_BAD_TEST, text: WEDGE_BROKEN_SOURCE }] };
    }
    if (ctx.role === "reviewer") {
      if (ctx.itemState === "RED") return { body: testVet() };
      return { body: noFindings() };
    }
    return { body: done("nothing to do") };
  };

  const cont = makeContinuationClient();
  const bench = await makeBench({
    tag: "wedgedep",
    prompt: "build the blocker and the thing that depends on it",
    // maxImplementers is left at its default: the DEPENDENCY is what must keep B1
    // out of the wave, not a wave-width cap. If B1 were merely crowded out this
    // fixture would be scenario 5 again.
    config: makeConfig({ testRepairAttempts: 1 }),
    script,
    client: cont.client,
  });

  await handleClassify({ ...stageBase(bench) });
  await handleDecompose({ ...stageBase(bench) });
  await handlePlan({ ...stageBase(bench) });
  await handlePlanReview({ ...stageBase(bench) });
  await handleDispatchWave(waveArgs(bench));

  const itemA = itemOf(bench, "A1");
  const itemB = itemOf(bench, "B1");
  const questionId = itemA.blocked?.questionId ?? "";
  const ledgerQuestionIds = readQuestions(bench.runDir)
    .filter((q) => q.answeredIso === null)
    .map((q) => q.id);
  const bDispatched = bench.wiring.prompted.filter((p) => p.itemId === "B1").length;

  // conductor_report's refusal is CORRECT and is not in scope for this fix
  // (FW-SG-4). It is recorded because it is what makes the wedge a wedge: the run
  // has no legal exit through the report, so if nothing re-prompts either, nothing
  // ends it at all.
  let reportRefusal: string | null = null;
  try {
    await handleReport(reportArgs(bench));
  } catch (err) {
    reportRefusal = err instanceof Error ? err.message : String(err);
  }

  // Fingerprinted BYTE FOR BYTE, not counted: a stop-report "proves no claim and
  // re-runs nothing" (§2.9), and comparing verify-record COUNTS across a path that
  // has none either way is 0 === 0 — vacuously true of an implementation that ran
  // a full closing verify and of one that ran nothing.
  const evidencePath = path.join(bench.runDir, "evidence.jsonl");
  const evidenceBefore = readFileSync(evidencePath, "utf8");

  const passes: WedgePass[] = [];
  const savedStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = bench.stateHome;
  try {
    for (let pass = 1; pass <= WEDGE_IDLE_PASSES; pass += 1) {
      // Each pass waits out the §3.7.4 window, which is what makes it a real pass
      // rather than a silently debounced one. The run does not move between them,
      // so every futility signature is identical by measurement.
      if (pass > 1) await sleep(CONTINUATION_DEBOUNCE_MS + 200);
      await sendIdle(bench.hooks, ORCH);
      const live = bench.store.loadRun(bench.runId);
      passes.push({
        prompts: cont.prompts.length,
        idleRePrompts: live.counters.idleRePrompts,
        futileRePrompts: live.counters.futileRePrompts,
        stopKind: live.stop === null ? null : live.stop.kind,
        stopReason: live.stop === null ? null : live.stop.reasonDisplay,
        terminal: isTerminal(live),
        rePromptRecords: rePromptRecords(bench.runDir).length,
      });
    }
  } finally {
    if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedStateHome;
  }

  const reportPath = path.join(bench.runDir, "report.md");
  return {
    bench,
    questionId,
    ledgerQuestionIds,
    itemA,
    itemB,
    bDispatched,
    reportRefusal,
    prompts: cont.prompts,
    passes,
    evidenceBefore,
    evidenceAfter: readFileSync(evidencePath, "utf8"),
    anomalies: readAnomalies(bench.runDir),
    reportMd: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null,
    staleRed: bench.store.readStaleRed(),
  };
}

test(
  "[fw-blocked-dependent-reprompts] §3.7.1's condition is ACTIONABLE WORK, not a recommended stage tool: with A1 blocked on an unanswered §2.11 question and B1 carrying dependsOn:[A1] — B1 neither PUBLISHED nor blocked nor deferred, so actionable work exists by the plan's own definition — a session.idle through the REAL plugin bus hook RE-PROMPTS the orchestrator, even though the gate offers no stage tool for this position",
  { timeout: 300_000 },
  async () => {
    const w = await wedgeWalk();

    // --- the premises, all measured off persisted state ----------------------
    assert.notEqual(w.itemA.blocked, null, "premise: A1 is BLOCKED after its test-repair budget was exhausted");
    assert.ok(w.questionId.length > 0, "premise: the block carries a §2.11 question id a human can answer");
    assert.ok(
      w.ledgerQuestionIds.includes(w.questionId),
      `premise: that question is OPEN on questions.jsonl (open ids: ${w.ledgerQuestionIds.join(", ")})`,
    );
    assert.equal(w.itemB.state, "PENDING", "premise: B1 was never started");
    assert.notEqual(w.itemB.state, "PUBLISHED", "premise: B1 is not PUBLISHED");
    assert.equal(w.itemB.blocked, null, "premise: B1 is not blocked");
    assert.equal(w.itemB.deferred, null, "premise: B1 is not deferred — it is exactly §3.7.1's actionable item");
    assert.equal(
      w.bDispatched,
      0,
      "premise: no sub-session was ever opened for B1 — the DEPENDENCY kept it out of the wave, not a wave-width cap",
    );
    assert.notEqual(
      w.reportRefusal,
      null,
      "premise: conductor_report REFUSES this run (FW-SG-4, correct and out of scope) — so the report is no exit either",
    );
    assert.match(
      String(w.reportRefusal),
      /B1/,
      "premise: and the refusal names B1 as the unsettled item, which is the same fact §3.7.1 calls actionable",
    );

    // --- the row -------------------------------------------------------------
    const first = w.passes[0];
    assert.equal(
      first.prompts,
      1,
      "the first session.idle RE-PROMPTED the orchestrator: §3.7.1 gates on actionable work, and B1 is actionable work",
    );
    assert.equal(w.prompts[0].sessionID, ORCH, "the re-prompt went to the ORCHESTRATOR's own session");
    assert.ok(w.prompts[0].text.length > 0, "and carried a message, not an empty body");
    assert.match(w.prompts[0].text, new RegExp(w.bench.runId), "the re-prompt names the run it is about");
    assert.equal(first.idleRePrompts, 1, "counters.idleRePrompts was charged exactly once for it");
    assert.equal(
      first.rePromptRecords,
      1,
      "and the plugin's own journal carries exactly one continuation/reprompt record for the pass",
    );
  },
);

test(
  "[fw-blocked-dependent-reaches-noop] the wedge now ENDS: three futile idle passes in the blocked-dependent shape drive counters.idleRePrompts and counters.futileRePrompts to 3 on an identical run-state signature, the FOURTH pass records stop {kind:'noop'} plus a §2.8 disengage anomaly and makes the run terminal to core/stops.ts isTerminal, and a FIFTH pass — waited past the real §3.7.4 debounce so its silence is a decision and not a dropped call — journals no further continuation/reprompt record",
  { timeout: 300_000 },
  async () => {
    const w = await wedgeWalk();

    for (let pass = 1; pass <= 3; pass += 1) {
      const p = w.passes[pass - 1];
      assert.equal(p.prompts, pass, `idle pass ${pass} really re-prompted the orchestrator`);
      assert.equal(p.idleRePrompts, pass, `counters.idleRePrompts reads ${pass} after pass ${pass}`);
      assert.equal(
        p.futileRePrompts,
        pass,
        `counters.futileRePrompts reads ${pass}: the run-state signature was identical, so the pass was FUTILE by measurement`,
      );
      assert.equal(p.stopKind, null, `the run is still live after ${pass} re-prompt(s): the §3.7.2 limit is 3, not ${pass}`);
      assert.equal(p.terminal, false, "and still non-terminal to the ONE §2.3 definition");
    }
    assert.equal(w.passes[2].rePromptRecords, 3, "the journal recorded all three re-prompts");

    const fourth = w.passes[3];
    assert.equal(fourth.stopKind, "noop", "the FOURTH pass stops the run: §2.9's kind for a wedged run is `noop`");
    assert.match(
      String(fourth.stopReason),
      /no observable progress/i,
      "and says WHY in words a human reads, not only in a kind",
    );
    assert.equal(fourth.terminal, true, "the run is TERMINAL to core/stops.ts isTerminal");
    assert.equal(fourth.prompts, 3, "no fourth prompt left the process");
    assert.equal(fourth.idleRePrompts, 3, "and no fourth re-prompt was charged to the orchestrator");
    assert.equal(fourth.futileRePrompts, 3, "the futile counter stopped at the limit it fired on");

    const disengage = w.anomalies.filter((a) => a.kind === "disengage");
    assert.equal(disengage.length, 1, "the wedge left exactly one §2.8 `disengage` anomaly");
    assert.match(
      String(disengage[0].detail ?? ""),
      /re-prompt/i,
      "the anomaly names what it disengaged from, not merely that it did",
    );

    const fifth = w.passes[4];
    assert.equal(fifth.prompts, 3, "a terminal run is never re-prompted again");
    assert.equal(
      fifth.rePromptRecords,
      3,
      "and no further continuation/reprompt record was journaled after the stop, on a pass waited past the debounce",
    );
    assert.equal(fifth.idleRePrompts, 3, "the counters are frozen where the stop left them");
  },
);

test(
  "[fw-wedge-stop-report-written] §2.9's normative 'every stop writes a report' holds on the blocked-dependent wedge path: report.md is written in stop-report mode with the noop kind as its headline, naming A1 with the exact question id its block carries on questions.jsonl, B1's unfinished disposition, and the abandoned red newly added to the §2.11 stale-red registry — and NO closing verify ran for it, proved by comparing evidence.jsonl BYTE FOR BYTE across the whole wedge path rather than by counting verify records",
  { timeout: 300_000 },
  async () => {
    const w = await wedgeWalk();
    assert.notEqual(
      w.reportMd,
      null,
      "§2.9: recording a stop is not a terminal action on its own — the recorder MUST leave a report.md behind",
    );
    const md = String(w.reportMd);

    assert.match(md, /^# conductor stop-report — noop — run /m, "the stop KIND is the report's headline");
    assert.match(md, /^Stop kind: noop$/m, "and is stated as a field, not only in prose");
    assert.match(md, /^Closing verify: none/m, "the report declares that it re-ran nothing (§2.9)");

    // The per-item blocks, read as BLOCKS: a bare /^Disposition: blocked$/m would
    // pass on a report that attached that disposition to the wrong item.
    const block = (id: string): string => {
      const found = md.split(/^### /m).find((part) => part.startsWith(id + " "));
      assert.ok(found !== undefined, `the stop-report has a section for ${id}; got:\n${md}`);
      return String(found);
    };
    assert.match(block("A1"), /^A1 — /, "the stop-report names the blocked item with its FSM position");
    assert.match(block("A1"), /^Disposition: blocked$/m, "with its settled disposition");
    assert.match(block("B1"), /^B1 — PENDING/, "it names the dependent at the position nobody moved it off");
    assert.match(
      block("B1"),
      /^Disposition: unfinished$/m,
      "and calls that disposition unfinished rather than settled — B1 is the reason the run could not close",
    );

    assert.match(
      md,
      new RegExp("- " + w.questionId + " — "),
      "the open-questions section names the EXACT question id A1's block carries, which is what a human must answer to unwedge it",
    );
    assert.match(
      md,
      new RegExp("- " + WEDGE_BAD_TEST.replace(/\./g, "\\.") + " \\(A1\\)"),
      "and it names the newly-registered stale-red path against the item that owns it",
    );
    assert.equal(
      md.includes(WEDGE_DEP_TEST),
      false,
      "B1's test was never written, so nothing about it was registered stale-red: the registry records files that EXIST",
    );
    assert.ok(
      JSON.stringify(w.staleRed).includes("wedge-broken"),
      "the abandoned red really is on the §2.11 registry, not merely printed in the report",
    );

    // NO CLOSING VERIFY. Not "a verify that passed" — none at all, and asserted as
    // BYTES: a count comparison over a path with zero verifies either way is
    // 0 === 0 and would hold for an implementation that ran a full verify too.
    assert.equal(
      w.evidenceAfter,
      w.evidenceBefore,
      "the stop path appended NOTHING to the §2.6 evidence ledger — a stop-report proves no claim (§2.9)",
    );
  },
);

// ===========================================================================
// fix-wedge-detector — the transport floor (plan §2.9:888-897, FW-SG-2/SG-3)
// ===========================================================================
//
// The plugin's `event` hook hands `input.client` to the §3.7 engine with NO shape
// check (plugin/index.ts: `input.client as unknown as ContinuationClient`). Give
// it the emptiest client a caller can supply — `{}` — and every re-prompt takes a
// SYNCHRONOUS throw out of `session.prompt`. handleSessionIdle then sets
// sent=false and deliberately charges nothing, which is RIGHT per pass ("an
// accusation against a session that was never asked once") and must stay. What is
// missing is a FLOOR across passes: with none, a permanently dead transport freezes
// the counters, the futile-re-prompt detector can never fire, and the run is
// un-endable — the fault creates the very wedge the engine exists to end.
//
// Both rows below observe ONE walk, for the same reason the wedge rows do. Note
// that this walk needs no sleeps: a failed send deliberately does NOT advance the
// §3.7.4 debounce clock, so consecutive failing passes are never debounced.

const TRANSPORT_MAX_IDLE_PASSES = 30;

interface TransportObservation {
  bench: Bench;
  floor: number | null;
  stopKind: string | null;
  stopReason: string | null;
  terminal: boolean;
  idleRePrompts: number;
  futileRePrompts: number;
  anomalies: Array<Record<string, unknown>>;
  reportMd: string | null;
  journal: Array<Record<string, unknown>>;
}

let transportWalkPromise: Promise<TransportObservation> | null = null;

function transportWalk(): Promise<TransportObservation> {
  if (transportWalkPromise === null) transportWalkPromise = runTransportWalk();
  return transportWalkPromise;
}

async function runTransportWalk(): Promise<TransportObservation> {
  const script: Script = (ctx) => {
    if (ctx.role === "mechanical") {
      return { body: { kind: "work", rationale: "a behavioural change", confidence: "high", trivialItem: null } };
    }
    if (ctx.role === "skeptic") return { body: { agreed: true, correctedKind: null, note: "behavioural" } };
    if (ctx.role === "planner") {
      if (ctx.nth === 0) {
        return {
          body: {
            items: [
              queueItem({
                id: "T1",
                title: "the item nobody will ever hear about",
                fileScope: ["src/transport.ts"],
                testScope: ["tests/transport.test.ts"],
              }),
            ],
          },
        };
      }
      return { body: { markdown: "# plan\n\nAn item behind an unreachable orchestrator.\n", decisions: [] } };
    }
    return { body: done("nothing to do") };
  };

  const bench = await makeBench({
    tag: "wedgetransport",
    prompt: "build the thing behind a dead transport",
    config: makeConfig(),
    script,
    // The C-081 shape: the emptiest client the plugin's unchecked cast accepts.
    // `{}.session.prompt` is not a function, so every send throws synchronously —
    // the machine is being fed a state it must REFUSE to act on indefinitely.
    client: {},
  });

  // Classify + decompose so the run carries a queue.json: the §2.9 stop-report is
  // written by the ONE report writer, which reads the queue to name dispositions.
  await handleClassify({ ...stageBase(bench) });
  await handleDecompose({ ...stageBase(bench) });

  let floor: number | null = null;
  const savedStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = bench.stateHome;
  try {
    for (let pass = 1; pass <= TRANSPORT_MAX_IDLE_PASSES && floor === null; pass += 1) {
      await sendIdle(bench.hooks, ORCH);
      if (bench.store.loadRun(bench.runId).stop !== null) floor = pass;
    }
  } finally {
    if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedStateHome;
  }

  const live = bench.store.loadRun(bench.runId);
  const reportPath = path.join(bench.runDir, "report.md");
  return {
    bench,
    floor,
    stopKind: live.stop === null ? null : live.stop.kind,
    stopReason: live.stop === null ? null : live.stop.reasonDisplay,
    terminal: isTerminal(live),
    idleRePrompts: live.counters.idleRePrompts,
    futileRePrompts: live.counters.futileRePrompts,
    anomalies: readAnomalies(bench.runDir),
    reportMd: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null,
    journal: readRunJournal(bench.runDir),
  };
}

// The words a legible transport-failure reason may reach for. Deliberately a
// UNION rather than one phrase this file invented: the assertion is that the
// reason names the failure at all, not that it matches a sentence typed here.
const TRANSPORT_WORDS = /transport|unreachable|deliver|could not (be )?(send|sent|prompt)|prompt|reach/i;

test(
  "[fw-transport-failure-has-a-floor] a client whose session.prompt throws — the `{}` the plugin's unchecked `input.client` cast happily forwards — can no longer disable the §3.7 detector forever: consecutive transport failures are COUNTED, and at the floor the run records a stop from the CLOSED §2.9 vocabulary — `env`, the kind whose definition covers tooling broken (FW-SG-2) — with the reason naming the transport failure, writes the stop-report, and becomes terminal to core/stops.ts isTerminal",
  { timeout: 300_000 },
  async () => {
    const w = await transportWalk();

    assert.notEqual(
      w.floor,
      null,
      `a permanently dead transport must not leave the run un-endable: ${TRANSPORT_MAX_IDLE_PASSES} idle passes through the plugin's own bus hook recorded no stop at all, so §3.7's ONLY wedge detector is inert on this path`,
    );
    assert.ok(
      (w.floor ?? 0) >= 2,
      `the floor is a FLOOR, not a hair trigger: stopping on pass ${String(w.floor)} would kill a run on one transient hiccup, which is worse than the defect`,
    );
    assert.equal(
      w.stopKind,
      "env",
      "§2.9 assigns `env` to tooling broken, and STOP_KINDS is closed — no kind may be invented and `noop` (no observable progress) would misreport a run whose orchestrator was never reachable",
    );
    assert.match(String(w.stopReason), TRANSPORT_WORDS, "the reason NAMES the transport failure");
    assert.equal(
      /no observable progress/i.test(String(w.stopReason)),
      false,
      "and does not reuse the wedge reason: this orchestrator made no progress because it was never asked",
    );
    assert.equal(w.terminal, true, "the run is TERMINAL to the ONE §2.3 definition, so it is genuinely over");
    assert.notEqual(
      w.reportMd,
      null,
      "§2.9: every stop writes a report — the recorder MUST invoke the report writer before the run goes quiet",
    );
    assert.match(String(w.reportMd), /^Stop kind: env$/m, "and the artifact carries the stop it was written for");

    // FW-SG-3, restated at the floor: reaching it may not retroactively charge the
    // orchestrator for messages it never received.
    assert.equal(w.idleRePrompts, 0, "not one failed send was counted as a re-prompt");
    assert.equal(w.futileRePrompts, 0, "nor charged to the futility rule, which describes the ORCHESTRATOR's silence");
  },
);

test(
  "[fw-transport-failure-is-visible] the transport stop is LEGIBLE to the human who has to act on it: a schema-valid §2.8 anomaly names the transport failure, the stop-report's headline carries the `env` kind and its reason, and the failure is journaled at error level — so a run whose orchestrator became unreachable reports that fact instead of leaving one error line per idle event as its only trace",
  { timeout: 300_000 },
  async () => {
    const w = await transportWalk();

    const named = w.anomalies.filter(
      (a) =>
        TRANSPORT_WORDS.test(String(a.detail ?? "")) &&
        // The wedge reason also contains the word "re-prompt", so it is excluded
        // explicitly: this run's orchestrator made no progress because it was
        // never asked, not because it ignored three messages it received.
        !/no observable progress/i.test(String(a.detail ?? "")),
    );
    assert.ok(
      named.length >= 1,
      `a §2.8 anomaly must name the transport failure; anomalies were: ${JSON.stringify(w.anomalies)}`,
    );
    assert.equal(
      validate("AnomalyRecord", named[0]).ok,
      true,
      `the anomaly satisfies the §2.8 schema — its kind comes from the CLOSED vocabulary, it is not invented: ${JSON.stringify(named[0])}`,
    );

    assert.notEqual(w.reportMd, null, "the stop-report exists to be read");
    const md = String(w.reportMd);
    assert.match(
      md,
      new RegExp("^# conductor stop-report — env — run " + w.bench.runId + "$", "m"),
      "the headline carries the env kind and the run it is about",
    );
    assert.match(md, /^Reason: /m, "the reason is a field of its own");
    assert.match(
      md.split("\n").filter((line) => line.startsWith("Reason: "))[0] ?? "",
      TRANSPORT_WORDS,
      "and it names the transport failure rather than restating the kind",
    );

    const errors = w.journal.filter((r) => r.level === "error");
    assert.ok(
      errors.length >= 1,
      "the send failures are journaled at error level — the per-pass trace stays, it is simply no longer the ONLY trace",
    );
    assert.ok(
      errors.some((r) => TRANSPORT_WORDS.test(JSON.stringify(r.data ?? {}))),
      `at least one error record names the failing re-prompt; got: ${JSON.stringify(errors.slice(0, 3))}`,
    );
  },
);

// ===========================================================================
// G5 / row 13.1-router-absent-fail-soft — the WITHOUT arm, in the node suite
// ===========================================================================
//
// The plan's G5 step (2884-2888) runs this same e2e twice, once with the C++
// llama-router in the loop and once without, and asserts the same terminal
// state, the same item dispositions and the same commit set. Only ONE of those
// arms can live here: spawning llama-router from a test would make the default
// suite depend on a built C++ binary a fresh worktree does not have, and
// conductor/tests/router-client.test.ts:5 promises the opposite. So the WITH arm
// lives in conductor/tools/g5-equivalence.ts, which starts a real router and
// compares the two arms' facts, and the WITHOUT arm — which needs no binary and
// no model — is this test.
//
// It is the fail-soft property stated as a measurement rather than a hope: the
// REAL fetchMetricsSummary, UNSTUBBED, is pointed at an endpoint where nothing
// can be listening, and the run must come out exactly as it does with the seam
// omitted entirely. Same scripted flow, same fixture shape, two benches, three
// compared facts.
test(
  "[13.1-router-absent-fail-soft] with NO router listening the REAL fetchMetricsSummary — unstubbed, over a real socket to a dead endpoint — returns null instead of throwing, the report renders its metrics section unavailable rather than crashing or blocking, and the run's terminal state, item dispositions and commit set are identical to the same scripted run with the metrics seam omitted entirely",
  { timeout: 300_000 },
  async () => {
    // Port 1 is the dead endpoint: an unprivileged process cannot bind it, so a
    // connection there is refused rather than answered, and it is refused fast.
    const deadCfg: RouterClientConfig = {
      listen: { host: "127.0.0.1", port: DEAD_ROUTER_PORT },
      probeTimeoutMs: 2000,
    };

    // 1. The adapter itself, called directly, on a real socket. This is the
    //    contract row 13.1 rests on: null, never a rejection.
    const direct = await fetchMetricsSummary(deadCfg);
    assert.equal(
      direct,
      null,
      "fetchMetricsSummary is fail-soft by contract: a refused connection resolves null, it does not throw",
    );

    // 2. The same scripted trivial flow, twice: once with the seam omitted (the
    //    shape conductor_report short-circuits) and once with it wired to the
    //    dead endpoint. Everything else is held fixed.
    const TEST_REL = "tests/failsoft.test.ts";
    const FILE = "src/failsoft.ts";
    const script: Script = (ctx) => {
      if (ctx.role === "mechanical") {
        return {
          body: {
            kind: "trivial",
            rationale: "a single pure helper with one acceptance line",
            confidence: "high",
            trivialItem: {
              title: "failsoft",
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
      if (ctx.role === "skeptic") {
        return { body: { agreed: true, correctedKind: null, note: "one file, one function" } };
      }
      if (ctx.role === "testWriter") {
        return {
          body: done("wrote the test"),
          write: [{ rel: TEST_REL, text: itemTestSource(FILE, '" a "', '"a"') }],
        };
      }
      if (ctx.role === "implementer") {
        return {
          body: done("wrote the module"),
          write: [{ rel: FILE, text: "export function fn(s) { return s.trim(); }\n" }],
        };
      }
      if (ctx.role === "reviewer") {
        if (ctx.itemState === "RED") return { body: testVet() };
        return { body: noFindings() };
      }
      return { body: done("nothing to do") };
    };

    let deadSeamCalls = 0;
    const arm = async (
      tag: string,
      seam: "omitted" | "dead-endpoint",
    ): Promise<{ facts: ScenarioFacts; md: string; report: Awaited<ReturnType<typeof handleReport>> }> => {
      const bench = await makeBench({ tag, prompt: "trim the label", script });
      const classified = await handleClassify({ ...stageBase(bench) });
      assert.equal(classified.kind, "trivial", `${tag}: the classifier and its skeptic agreed on \`trivial\``);
      const wave = await drainWaves(bench);
      const disposition = wave.items.find((d) => d.itemId === classified.itemId);
      assert.equal(
        disposition?.state,
        "PUBLISHED",
        `${tag}: the item must reach PUBLISHED; it stopped at ${String(disposition?.stoppedAt)} (${String(disposition?.envError)})`,
      );
      const report = await handleReport(
        reportArgs(
          bench,
          seam === "omitted"
            ? null
            : async () => {
                deadSeamCalls += 1;
                return fetchMetricsSummary(deadCfg);
              },
        ),
      );
      const md = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
      return { facts: recordFacts(bench, `router-absent-${seam}`, seam, report), md, report };
    };

    const omitted = await arm("g5-seam-omitted", "omitted");
    const dead = await arm("g5-seam-dead", "dead-endpoint");

    // The seam really was crossed in the second arm — the run went through
    // adapter/router-client.ts and came back empty-handed, which is a different
    // event from never having gone.
    assert.equal(deadSeamCalls, 1, "conductor_report called the metrics seam exactly once in the dead-endpoint arm");
    assert.equal(dead.report.metricsAvailable, false, "no summary came back from an endpoint nothing serves");
    assert.equal(omitted.report.metricsAvailable, false, "and none comes back when the field is omitted either");

    // The report renders the unavailable line rather than crashing or blocking.
    for (const [tag, md] of [["omitted", omitted.md] as const, ["dead-endpoint", dead.md] as const]) {
      assert.match(md, /^## Metrics$/m, `${tag}: the report carries its §4.4 metrics section`);
      assert.match(
        md,
        /^## Metrics\n\n\(unavailable\)$/m,
        `${tag}: with no router the metrics section says so — the report is written, not withheld`,
      );
    }

    // 3. And the three facts plan:2884-2888 names are IDENTICAL across the two,
    //    which is what "the identical process runs without the router" means at
    //    this end of the seam.
    assert.equal(
      dead.facts.terminalState,
      omitted.facts.terminalState,
      "same terminal state with the seam live against a dead endpoint as with the seam absent",
    );
    assert.deepEqual(
      dead.facts.dispositions,
      omitted.facts.dispositions,
      "same item dispositions",
    );
    assert.deepEqual(dead.facts.commitSet, omitted.facts.commitSet, "same commit set");
    assert.equal(dead.facts.commitCount, omitted.facts.commitCount, "same number of commits");
  },
);
