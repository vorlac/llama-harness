// conductor/tests/tool-legality.test.ts — GAP-006 (ISSUE-005 / ISSUE-006 /
// ISSUE-007): ONE legality choke point, threaded caller identity, and a run-FSM
// API that derives its from-state from persisted state instead of trusting the
// caller's claim.
//
// WHAT WAS OPEN AT HEAD, and what each row here performs:
//
//   E20 / ISSUE-005 — the meta tools and conductor_classify passed through
//     NEITHER the phase gate nor anything else. legalTools had exactly two
//     production call sites (requireStageTool, waveVerdict), covering the six
//     per-item stage tools and conductor_dispatch_wave; every meta name reached
//     its handler unguarded. Two full-run escapes followed and are performed
//     below: (a) classify -> defer every item -> report closes a run `done` from
//     DECOMPOSED, skipping PLANNED/PLAN_REVIEWED/EXECUTING entirely, because
//     handleReport fed legalRunTransition the LITERAL from-state "EXECUTING";
//     (b) conductor_classify could be re-entered on an already-classified or
//     already-advanced run — classification shopping, plus a queue.json clobber.
//
//   E21 / ISSUE-006 — every REGISTERED session could call every conductor_*
//     tool. decideSession allows a registered session any non-spawn call, and
//     the handlers checked phase legality but never caller ROLE, so a dispatched
//     implementer could answer its own blocking question, defer its own item, or
//     close the run it was working inside.
//
//   ISSUE-007 — the §3.6 override `gate` argument was a free string. Only
//     "session", "git" and "edit" are ever spendable, but an unknown name was
//     granted anyway: it tainted the item, appended the anomaly, incremented
//     BOTH budget meters and returned granted:true. Two honest misspellings
//     exhausted the default budget and the third stopped the run `env`.
//
// The growth property is the last row's subject: a tool that reaches the choke
// point with no declared legality row is REFUSED by construction, and the table
// is pinned to the §3.4 inventory, so a new tool cannot be born unguarded.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---- the subjects ---------------------------------------------------------
import { ConductorPlugin } from "../plugin/index.ts";
import {
  CONDUCTOR_TOOL_NAMES,
  handleOverride,
  requireToolLegal,
} from "../adapter/tools.ts";
import type { OverrideInput } from "../adapter/tools.ts";
import {
  OVERRIDE_GATES,
  PHASE_RULES,
  TOOL_LEGALITY,
  callerKindOf,
} from "../core/tool-legality.ts";
import { advanceRun } from "../core/fsm-run.ts";
import { READER_ROLES } from "../core/gates-edit.ts";

// ---- committed machinery these rows compose over --------------------------
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import type { Config, Item, ItemState, Queue, QueueItem, RunState } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Harness (the conductor/tests/composition-root.test.ts idiom, kept local)
// ---------------------------------------------------------------------------

interface RegisteredTool {
  execute: (args: unknown, context: unknown) => Promise<unknown>;
}

interface PluginHooks {
  tool?: Record<string, RegisteredTool>;
}

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");
const toolsPath = path.join(conductorDir, "adapter", "tools.ts");
const pluginPath = path.join(conductorDir, "plugin", "index.ts");

const SESSION = "ses_orchestrator_gap006";

const tmpDirs: string[] = [];

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  tmpDirs.push(dir);
  return dir;
}

const priorXdgStateHome = process.env.XDG_STATE_HOME;
process.env.XDG_STATE_HOME = realpathSync(scratchDir("conductor-gap006-xdg-"));

after(() => {
  if (priorXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = priorXdgStateHome;
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
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

function gitRoot(tag: string): string {
  const dir = realpathSync(scratchDir(tag));
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "beta.ts"), "export const parse = (s: string): number => 7;\n");
  writeFileSync(path.join(dir, "tests", "beta.test.ts"), "export const covered = true;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function makeConfig(): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        unit: {
          command: [process.execPath, "-e", "process.exit(0)"],
          timeoutMs: 60_000,
          itemTest: [process.execPath, "-e", "process.exit(0)"],
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 2,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 0,
      debugFixCap: 1,
      maxOverridesPerItem: 2,
      maxOverridesPerRun: 2,
    },
    parallel: { writes: "off", maxImplementers: 1, maxReaders: 2, subSessionTimeoutMs: 8_000 },
    models: { default: "gap006-test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function writeRepoConfig(root: string, config: Config): void {
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  git(root, ["add", "-f", ".conductor/config.json"]);
  git(root, ["commit", "-m", "conductor config"]);
}

function pluginInput(directory: string, client: unknown): unknown {
  return {
    client: client ?? {},
    project: { id: "prj_gap006", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

async function startPlugin(directory: string, client?: unknown): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(pluginInput(directory, client));
}

function toolCtx(sessionID: string, directory: string): unknown {
  return {
    sessionID,
    messageID: "msg_gap006",
    agent: "conductor",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

function callTool(
  hooks: PluginHooks,
  name: string,
  args: Record<string, unknown>,
  root: string,
  sessionID: string = SESSION,
): Promise<unknown> {
  const definition = (hooks.tool ?? {})[name];
  assert.ok(definition !== undefined, `premise: ${name} is registered in the plugin's tool map`);
  return definition.execute(args, toolCtx(sessionID, root));
}

interface Attempt {
  threw: boolean;
  error: unknown;
  value: unknown;
}

async function attempt(fn: () => Promise<unknown>): Promise<Attempt> {
  try {
    return { threw: false, error: undefined, value: await fn() };
  } catch (err) {
    return { threw: true, error: err, value: undefined };
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : `<a non-Error refusal: ${JSON.stringify(err)}>`;
}

function openTestStore(root: string, config: Config): StateStore {
  return openWorkspace({
    root,
    config,
    journal: { log: () => undefined },
    version: "0.0.0-test-gap006",
    sessionID: "ses_fixture_gap006",
  });
}

function runDirOf(root: string, runId: string): string {
  return path.join(root, ".conductor", "runs", runId);
}

function createRunFor(store: StateStore, sessionID: string): string {
  return store.createRun({
    prompt: "keep the sign of negative offsets",
    sessionID,
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  }).runId;
}

function makeRuntimeItem(id: string, state: ItemState): Item {
  return {
    id,
    state,
    assignee: null,
    worktree: null,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: {},
    taint: [],
    inlineClaim: null,
  };
}

function makeQueueItem(id: string): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

function seedQueue(
  store: StateStore,
  runId: string,
  runState: RunState,
  states: Record<string, ItemState>,
): void {
  const run = store.loadRun(runId);
  run.state = runState;
  store.saveRun(run);
  const queue: Queue = { items: Object.keys(states).map((id) => makeQueueItem(id)) };
  writeFileSync(path.join(runDirOf(store.root, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const [id, state] of Object.entries(states)) store.saveItem(runId, makeRuntimeItem(id, state));
}

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await tick();
  }
  return condition();
}

interface JournalRecord {
  event?: unknown;
  data?: Record<string, unknown>;
}

// The run's own §7.1 journal. It is the plugin registry's only observable
// surface from out here: the fan-out engine writes its entry into the registry
// the PLUGIN holds (never a test-local copy), and journals the role it wrote.
function readRunJournal(runDir: string): JournalRecord[] {
  const file = path.join(runDir, "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as JournalRecord;
      } catch {
        return {};
      }
    });
}

function dropWholeLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

// ===========================================================================
// [gap-006-table-covers-the-inventory] — the growth property
// ===========================================================================

test("[gap-006-table-covers-the-inventory] EVERY §3.4 tool declares a legality row: TOOL_LEGALITY's keys are exactly CONDUCTOR_TOOL_NAMES, each row names a phase rule from the closed vocabulary and at least one caller kind, and a `stage` row names the committed legality path that already guards it — so a NEW tool cannot be born guarded by nothing", () => {
  assert.deepEqual(
    Object.keys(TOOL_LEGALITY).sort(),
    [...CONDUCTOR_TOOL_NAMES].sort(),
    "the legality table and the §3.4 inventory are the same set — a tool added to one without the other is exactly the class MACRO-025 names",
  );

  for (const [tool, row] of Object.entries(TOOL_LEGALITY)) {
    assert.ok(
      PHASE_RULES.includes(row.phase),
      `${tool}: its phase rule "${row.phase}" is not in the closed vocabulary ${PHASE_RULES.join(", ")}`,
    );
    assert.ok(row.callers.length > 0, `${tool}: a row with no caller kind legalizes nothing`);
    for (const caller of row.callers) {
      assert.ok(
        caller === "orchestrator" || caller === "sub-session",
        `${tool}: "${caller}" is not a caller kind`,
      );
    }
    assert.ok(row.why.length > 0, `${tool}: a row must say WHY its rule is the right one`);
    if (row.phase === "stage") {
      assert.ok(
        typeof row.guardedBy === "string" && row.guardedBy.length > 0,
        `${tool}: a "stage" row DELEGATES its phase check, so it must name the committed path that performs it — an unnamed delegation is indistinguishable from no guard at all`,
      );
    }
  }

  // Only the six per-item stage tools plus the four run-pipeline tools may
  // delegate; every meta name is adjudicated at the choke point itself.
  const delegated = Object.entries(TOOL_LEGALITY)
    .filter(([, row]) => row.phase === "stage")
    .map(([tool]) => tool)
    .sort();
  assert.deepEqual(
    delegated,
    [
      "conductor_decompose",
      "conductor_dispatch_wave",
      "conductor_item_review",
      "conductor_mark_green",
      "conductor_plan",
      "conductor_plan_review",
      "conductor_publish",
      "conductor_submit_test",
      "conductor_validate",
      "conductor_vet_test",
    ],
    "exactly the ten pipeline tools delegate to a committed legality path (requireStageTool / the run-FSM edge); every META name is adjudicated at the choke point, which is the half ISSUE-005 found missing",
  );
});

// ===========================================================================
// [gap-006-undeclared-tool-refused]
// ===========================================================================

test("[gap-006-undeclared-tool-refused] a conductor_* name that reaches the choke point with NO declared legality row is REFUSED by construction, naming the table it must be declared in — the growth mechanism, not a comment asking the next author to remember", () => {
  const root = realpathSync(scratchDir("conductor-gap006-undeclared-"));
  const config = makeConfig();
  const store = openTestStore(root, config);

  assert.throws(
    () =>
      requireToolLegal({
        tool: "conductor_clarify",
        store,
        runId: "",
        caller: { role: "orchestrator" },
      }),
    (err: unknown) => {
      const message = messageOf(err);
      assert.match(message, /conductor_clarify/, "the refusal names the undeclared tool");
      assert.match(message, /TOOL_LEGALITY|legality row/i, "and the table it owes a row to");
      return true;
    },
    "an undeclared tool must fail CLOSED at the choke point — the addendum's conductor_clarify is the next tool to be added, and it must be born under the guard",
  );
});

// ===========================================================================
// [gap-006-defer-all-then-report-from-decomposed] — E20, escape (b)
// ===========================================================================

test("[gap-006-defer-all-then-report-from-decomposed] PERFORMING the cheapest full-run escape: from DECOMPOSED, defer every item and call conductor_report. The report is REFUSED at the choke point, run.json is still DECOMPOSED with no stop, and no report.md exists — where at HEAD handleReport fed the run FSM the literal from-state \"EXECUTING\" and closed the run `done`", async () => {
  const root = gitRoot("conductor-gap006-deferall-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "DECOMPOSED", { I1: "PENDING", I2: "PENDING" });

  const hooks = await startPlugin(root);

  // The escape's first half really works — deferral is a legal judgment at any
  // non-terminal position, and the run must not be rescued by refusing it.
  for (const itemId of ["I1", "I2"]) {
    const deferred = await attempt(() =>
      callTool(hooks, "conductor_defer", { itemId, reason: "not worth doing in this run" }, root),
    );
    assert.equal(
      deferred.threw,
      false,
      `premise: deferring ${itemId} is legal here — the escape's setup must succeed or the row proves nothing: ${messageOf(deferred.error)}`,
    );
  }
  assert.equal(store.loadItem(runId, "I1").deferred !== null, true, "premise: I1 really is deferred");
  assert.equal(store.loadItem(runId, "I2").deferred !== null, true, "premise: I2 really is deferred");

  // The second half — the close — is where the escape dies.
  const closed = await attempt(() => callTool(hooks, "conductor_report", {}, root));
  assert.equal(
    closed.threw,
    true,
    `conductor_report must be REFUSED from DECOMPOSED: every item being settled is not a licence to skip PLANNED, PLAN_REVIEWED and EXECUTING. It returned: ${JSON.stringify(closed.value)}`,
  );
  const message = messageOf(closed.error);
  assert.match(
    message,
    /conductor_report/,
    `the refusal names the tool it refused: ${message}`,
  );
  assert.match(
    message,
    /DECOMPOSED|phase|position|order/i,
    `and names the position it was refused at, so the caller learns the rule rather than guessing: ${message}`,
  );

  const run = store.loadRun(runId);
  assert.equal(run.state, "DECOMPOSED", "the run FSM did not move");
  assert.equal(run.stop, null, "no stop was recorded — a refused close is not a close that happened");
  assert.equal(
    existsSync(path.join(runDir, "report.md")),
    false,
    "and no report artifact was written: legality precedes every write",
  );
});

// ===========================================================================
// [gap-006-classify-cannot-be-re-entered] — E20, escape (a)
// ===========================================================================

test("[gap-006-classify-cannot-be-re-entered] conductor_classify runs EXACTLY ONCE: the second call on the same INTAKE run is refused (classification shopping closed) and a call on an ADVANCED run is refused before any sub-session is created (the queue.json clobber closed) — proven by the fake SDK seeing no further session.create", async () => {
  const root = gitRoot("conductor-gap006-classify-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_cls_" });
  sdk.setResponder((req) => {
    if (req.text.includes("You are a skeptic")) {
      return { kind: "reply", text: JSON.stringify({ agreed: true, correctedKind: null, note: "" }) };
    }
    return {
      kind: "reply",
      text: JSON.stringify({
        kind: "work",
        rationale: "the prompt asks for a behavioural change",
        confidence: "high",
        trivialItem: null,
      }),
    };
  });
  const hooks = await startPlugin(root, sdk.client);

  const first = await attempt(() => callTool(hooks, "conductor_classify", {}, root));
  assert.equal(
    first.threw,
    false,
    `premise: the FIRST classify on an unclassified INTAKE run must succeed: ${messageOf(first.error)}`,
  );
  const createsAfterFirst = sdk.creates.length;
  assert.ok(createsAfterFirst > 0, "premise: the first classify really dispatched its classifier");

  const second = await attempt(() => callTool(hooks, "conductor_classify", {}, root));
  assert.equal(
    second.threw,
    true,
    `a SECOND conductor_classify must be refused — re-entry is the classification-shopping escape: re-roll until the classifier says "question" (terminal ANSWERED) or "trivial" (a one-item EXECUTING run that skips decomposition and planning). It returned: ${JSON.stringify(second.value)}`,
  );
  assert.match(
    messageOf(second.error),
    /classif/i,
    `the refusal explains that classification is already recorded: ${messageOf(second.error)}`,
  );
  assert.equal(
    sdk.creates.length,
    createsAfterFirst,
    "and it was refused BEFORE the fan-out: a refused classify must not spend a sub-session re-rolling the answer",
  );

  // The same rule from the other side: a run that has advanced past INTAKE.
  seedQueue(store, runId, "EXECUTING", { I1: "GREEN" });
  const onAdvanced = await attempt(() => callTool(hooks, "conductor_classify", {}, root));
  assert.equal(
    onAdvanced.threw,
    true,
    `conductor_classify on an EXECUTING run must be refused: at HEAD it clobbered queue.json, reset a GREEN item to PENDING and moved the run along an edge §3.1 does not have. It returned: ${JSON.stringify(onAdvanced.value)}`,
  );
  assert.equal(
    sdk.creates.length,
    createsAfterFirst,
    "again refused before any dispatch",
  );
  const item = store.loadItem(runId, "I1");
  assert.equal(item.state, "GREEN", "the GREEN item was NOT reset to PENDING");
  assert.equal(store.loadRun(runId).state, "EXECUTING", "and the run FSM did not move");
});

// ===========================================================================
// [gap-006-sub-session-may-not-self-serve] — E21 / ISSUE-006
// ===========================================================================

test("[gap-006-sub-session-may-not-self-serve] a REGISTERED sub-session — the plugin's own registry entry, written by the real fan-out engine mid-dispatch — is refused conductor_answer, conductor_defer, conductor_report and conductor_queue_amend, and the refusal NAMES the caller (the caller question is answered BEFORE the argument question, so an incomplete call gets the rule and not a retry invitation); conductor_status stays legal for it, so the rule is an allowlist rather than a blanket ban", async () => {
  const root = gitRoot("conductor-gap006-subsession-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "PLAN_REVIEWED", { I1: "PENDING" });

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_sub_" });
  sdk.setResponder(() => ({ kind: "pending" }));
  const hooks = await startPlugin(root, sdk.client);

  let waveSettled = false;
  let waveError: unknown = null;
  const wave = callTool(hooks, "conductor_dispatch_wave", {}, root).then(
    () => {
      waveSettled = true;
    },
    (err: unknown) => {
      waveSettled = true;
      waveError = err;
    },
  );

  try {
    await waitFor(() => sdk.creates.length > 0 || waveSettled, 8_000);
    assert.ok(
      sdk.creates.length > 0,
      `premise: the wave must really dispatch a sub-session through the plugin's own fan-out (wave error: ${messageOf(waveError)})`,
    );
    const subSession = sdk.creates[0];
    // The registration is observed through the PLUGIN's own journal, because the
    // registry it writes is the plugin's and this test holds no copy of it.
    await waitFor(
      () => readRunJournal(runDir).some((r) => r.event === "subsession.dispatched"),
      4_000,
    );
    const dispatched = readRunJournal(runDir).find((r) => r.event === "subsession.dispatched");
    const role = (dispatched?.data ?? {})["role"];
    assert.ok(
      typeof role === "string" && role.length > 0 && role !== "orchestrator",
      `premise: the plugin's ONE registry holds ${subSession} under a NON-orchestrator role (journal said ${JSON.stringify(role)}) — that entry is the caller identity the choke point must read`,
    );
    const entry = { role: String(role) };

    const selfService: Array<{ tool: string; args: Record<string, unknown> }> = [
      { tool: "conductor_answer", args: { questionId: "Q1", answer: "yes, go ahead" } },
      { tool: "conductor_defer", args: { itemId: "I1", reason: "too hard" } },
      { tool: "conductor_report", args: {} },
      {
        tool: "conductor_queue_amend",
        args: {
          ops: [{ op: "remove", id: "I1" }],
          question: "should the queue lose I1?",
          options: [{ name: "remove" }, { name: "keep" }],
          choice: "remove",
          why: "it is inconvenient",
          appliedWhere: "queue.json",
        },
      },
    ];

    for (const call of selfService) {
      const refused = await attempt(() => callTool(hooks, call.tool, call.args, root, subSession));
      assert.equal(
        refused.threw,
        true,
        `${call.tool} must be refused from a dispatched sub-session: an implementer that can answer its own blocking question, defer its own item, close its own run or amend its own scope is marking its own homework (§3.5). It returned: ${JSON.stringify(refused.value)}`,
      );
      const message = messageOf(refused.error);
      assert.match(message, new RegExp(call.tool), `the refusal names the tool: ${message}`);
      assert.match(
        message,
        new RegExp(String(entry?.role)),
        `and NAMES THE CALLER's role, so the reader learns it was refused for WHO it is rather than for where the run stands: ${message}`,
      );
      assert.doesNotMatch(
        message,
        /no registry entry|not registered/i,
        `and it is the ROLE rule speaking, not the registration rule — this session IS registered: ${message}`,
      );
    }

    // The ORDER of the two questions the composition root asks. Argument legality
    // ran FIRST, so a sub-session that reached for an orchestrator-only tool with
    // an argument missing was told to re-issue the call with that argument — an
    // answer that invites the retry the caller rule exists to refuse, and one that
    // never mentions the rule it actually broke.
    const incomplete = await attempt(() => callTool(hooks, "conductor_defer", {}, root, subSession));
    assert.equal(
      incomplete.threw,
      true,
      "a sub-session calling an orchestrator-only tool is refused however its arguments are shaped",
    );
    const incompleteWhy = messageOf(incomplete.error);
    assert.match(
      incompleteWhy,
      new RegExp(String(entry.role)),
      `and the refusal is the CALLER rule — who you are is answered before what you sent: ${incompleteWhy}`,
    );
    assert.doesNotMatch(
      incompleteWhy,
      /required argument/i,
      `not the argument refusal, which tells a session that may not call this tool at all how to call it correctly: ${incompleteWhy}`,
    );

    // The allowlist half: the same session may still read.
    const status = await attempt(() => callTool(hooks, "conductor_status", {}, root, subSession));
    assert.equal(
      status.threw,
      false,
      `conductor_status must stay legal for a sub-session — a read-only surface is how a dispatched session orients itself, and banning it would make the rule a blanket ban rather than an allowlist: ${messageOf(status.error)}`,
    );
  } finally {
    // Release every parked prompt until the driver settles, so no watchdog timer
    // and no journal append outlives the test.
    const deadline = Date.now() + 20_000;
    while (!waveSettled && Date.now() < deadline) {
      if (sdk.pending.length > 0) {
        sdk.resolveAllPending({ kind: "error", error: { message: "fixture: ending the sub-session" } });
      }
      await tick();
    }
    await wave;
    await tick(50);
  }
});

// ===========================================================================
// [gap-006-unknown-override-gate-refused-with-budget-intact] — ISSUE-007
// ===========================================================================

test("[gap-006-unknown-override-gate-refused-with-budget-intact] the §3.6 override `gate` is a CLOSED vocabulary: an unknown name — §2.8's own worked example \"phase-order\" included — is refused NAMING the legal gates, and NOTHING is spent: both budget meters, the item's taint, the anomaly ledger and run.stop are all untouched, so an honest misspelling can no longer walk the run into an `env` stop", async () => {
  const root = gitRoot("conductor-gap006-override-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING" });

  const base: Omit<OverrideInput, "gate"> = {
    store,
    runId,
    config,
    journal: { log: () => undefined },
    now: () => 1_800_000_000_000,
    sessionID: "ses_impl_gap006",
    sessionRole: "implementer",
    itemId: "I1",
    reason: "the gate is wrong about this one",
    grantedAction: "write src/beta.ts once",
    overrideGrants: new Map(),
    stateHome: realpathSync(scratchDir("conductor-gap006-statehome-")),
    workspaceKey: "wkey-gap006",
    metrics: async () => null,
  };

  assert.deepEqual(
    [...OVERRIDE_GATES].sort(),
    ["edit", "git", "session"],
    "premise: exactly three gates are ever spendable — the three consumeOverrideGrant call sites",
  );

  for (const bogus of ["phase-order", "Edit", "tdd", ""]) {
    const refused = await attempt(async () => handleOverride({ ...base, gate: bogus }));
    assert.equal(
      refused.threw,
      true,
      `an override for gate "${bogus}" must be REFUSED: no consumption point exists for it, so granting one taints the item and burns the budget for a bypass that can never happen. It returned: ${JSON.stringify(refused.value)}`,
    );
    const message = messageOf(refused.error);
    assert.match(message, /conductor_override/, `the refusal names the tool: ${message}`);
    for (const legal of OVERRIDE_GATES) {
      assert.match(
        message,
        new RegExp(legal),
        `and names every gate that IS spendable, so the caller can correct itself instead of guessing: ${message}`,
      );
    }

    assert.equal(store.loadItem(runId, "I1").attempts.overridesUsed, 0, `item meter untouched after "${bogus}"`);
    assert.equal(store.loadRun(runId).counters.overridesUsed, 0, `run meter untouched after "${bogus}"`);
    assert.deepEqual(store.loadItem(runId, "I1").taint, [], `no taint entry after "${bogus}"`);
    assert.equal(store.loadRun(runId).stop, null, `no stop recorded after "${bogus}"`);
    assert.equal(
      existsSync(path.join(runDir, "anomalies.jsonl")),
      false,
      `and no §2.8 anomaly was appended after "${bogus}" — a refused override is not an override that happened`,
    );
  }

  // The other direction: a LEGAL gate is still spendable, so the vocabulary is a
  // filter rather than a wall.
  const granted = await attempt(async () => handleOverride({ ...base, gate: "edit" }));
  assert.equal(
    granted.threw,
    false,
    `a legal gate must still mint its one-shot grant: ${messageOf(granted.error)}`,
  );
  assert.equal(store.loadItem(runId, "I1").attempts.overridesUsed, 1, "and THAT one spends the item meter");

  // Single source: the vocabulary is the set the gate hook actually consumes.
  const consumed = new Set(
    [...dropWholeLineComments(readFileSync(toolsPath, "utf8")).matchAll(/consumeOverrideGrant\(input,\s*"([a-z-]+)"\)/g)].map(
      (m) => m[1],
    ),
  );
  assert.ok(consumed.size > 0, "premise: the gate hook's consumption points are readable in the source");
  assert.deepEqual(
    [...consumed].sort(),
    [...OVERRIDE_GATES].sort(),
    "OVERRIDE_GATES is exactly the set gateBeforeToolCall can spend — a vocabulary that names a gate with no consumption point re-opens ISSUE-007 in the other direction",
  );
});

// ===========================================================================
// [gap-006-advance-run-derives-its-from-state]
// ===========================================================================

test("[gap-006-advance-run-derives-its-from-state] advanceRun reads the run's position OFF THE PERSISTED RUN and refuses a terminal one, so no caller can hand the FSM a from-state it wishes were true — and adapter/tools.ts handleReport no longer names a from-state at all", () => {
  const decomposed = advanceRun({ state: "DECOMPOSED", stop: null }, "REPORTED", { classification: "work" });
  assert.equal(
    decomposed.ok,
    false,
    "DECOMPOSED->REPORTED is off the §3.1 diagram; at HEAD handleReport reached it by CLAIMING to be at EXECUTING",
  );
  assert.equal(decomposed.from, "DECOMPOSED", "and the verdict reports the position it actually read");
  assert.match(decomposed.why, /DECOMPOSED/, `the rationale names the real from-state: ${decomposed.why}`);

  const executing = advanceRun({ state: "EXECUTING", stop: null }, "REPORTED", { classification: "work" });
  assert.equal(executing.ok, true, "and the legal edge still passes, from the SAME persisted read");
  assert.equal(executing.from, "EXECUTING", "reporting the position it read");

  const stopped = advanceRun(
    { state: "EXECUTING", stop: { kind: "noop" } },
    "REPORTED",
    { classification: "work" },
  );
  assert.equal(
    stopped.ok,
    false,
    "a run carrying a §2.9 stop is TERMINAL for every subsystem at once (§2.3) — advancing it would upgrade a recorded stop to `done`",
  );
  assert.match(stopped.why, /stop|terminal/i, `and says so: ${stopped.why}`);

  const unknown = advanceRun({ state: "MID_FLIGHT", stop: null }, "REPORTED", {});
  assert.equal(unknown.ok, false, "a position outside RUN_STATES advances nowhere");

  // The half no probe can see: the report writer must not carry a literal.
  const toolsSource = dropWholeLineComments(readFileSync(toolsPath, "utf8"));
  assert.ok(toolsSource.length > 10_000, "premise: the adapter source really was read");
  assert.doesNotMatch(
    toolsSource,
    /legalRunTransition\(\s*"EXECUTING"/,
    "handleReport must not feed the run FSM a HARDCODED from-state — that literal is MACRO-004, and the journal then repeats the lie",
  );
});

// ===========================================================================
// [gap-006-choke-point-is-wired]
// ===========================================================================

test("[gap-006-choke-point-is-wired] the composition root routes EVERY conductor_* call through the one legality choke point: runTool consults requireToolLegal, and it does so with the caller identity the §3.5 registry holds rather than a model-supplied argument", () => {
  const pluginSource = readFileSync(pluginPath, "utf8");
  const start = pluginSource.indexOf("async function runTool(");
  assert.notEqual(start, -1, `premise: ${pluginPath} still funnels every tool through runTool`);
  const end = pluginSource.indexOf("\n  }", start);
  assert.notEqual(end, -1, "premise: runTool's body terminates readably at one indent level");
  const body = dropWholeLineComments(pluginSource.slice(start, end + 4));
  assert.ok(
    body.length > 200,
    `premise: the extracted runTool body is the real construction site (got ${body.length} chars) — a broken extraction must be red, never a vacuous green`,
  );
  assert.match(
    body,
    /requireToolLegal\(/,
    "runTool must consult the ONE choke point; a per-handler check is what let every meta tool through",
  );
  assert.match(
    body,
    /registry\.get\(/,
    "and it must read the caller's identity from the §3.5 registry — an identity the model supplies is an identity the model can forge",
  );

  assert.equal(callerKindOf("orchestrator"), "orchestrator", "the orchestrator entry is the orchestrator");
  assert.equal(callerKindOf("implementer"), "sub-session", "every dispatched role is a sub-session");
  assert.equal(callerKindOf(undefined), "orchestrator", "an absent entry is the orchestrator's own call (the registry gate already refuses an unregistered conductor call)");
});

// ===========================================================================
// Task 21.6 — closing the override chain.
//
// I1 says reviewers and planners write nothing. That is not absolute at HEAD:
// conductor_override carries `callers: EITHER`, handleOverride checks gate-name
// validity, item existence and budget with NO role predicate, and
// consumeOverrideGrant keys on {sessionID, gate, itemId} with no role predicate
// either. So a reviewer could mint an edit grant and spend it.
//
// After Task 21.1 a dispatched reviewer names conductor-reviewer on its prompt,
// and that agent's ruleset carries `edit * -> deny` at the opencode layer. The
// grant therefore cannot convert into anything: opencode refuses the edit before
// conductor's gate is consulted. Spending budget and recording a permanent taint
// for a bypass that provably cannot happen is exactly ISSUE-007's shape, and the
// answer is the same one — refuse for free.
// ===========================================================================

test("[21.6-reader-edit-override-refused-free] a READER role's edit override is refused with NOTHING spent", async () => {
  const root = gitRoot("conductor-216-override-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING" });

  const base: Omit<OverrideInput, "sessionRole"> = {
    store,
    runId,
    config,
    journal: { log: () => undefined },
    now: () => 1_800_000_000_000,
    sessionID: "ses_reviewer_216",
    itemId: "I1",
    gate: "edit",
    reason: "the scope is wrong about this one",
    grantedAction: "write src/beta.ts once",
    overrideGrants: new Map(),
    stateHome: realpathSync(scratchDir("conductor-216-statehome-")),
    workspaceKey: "wkey-216",
    metrics: async () => null,
  };

  for (const role of READER_ROLES) {
    const refused = await attempt(async () => handleOverride({ ...base, sessionRole: role }));
    assert.equal(
      refused.threw,
      true,
      `a ${role} must not mint an edit grant: the opencode layer denies that edit regardless, so ` +
        `the grant can never convert. It returned: ${JSON.stringify(refused.value)}`,
    );
    const message = messageOf(refused.error);
    assert.match(message, /conductor_override/, `the refusal names the tool: ${message}`);
    assert.match(message, new RegExp(role), `and the role it applies to: ${message}`);

    assert.equal(store.loadItem(runId, "I1").attempts.overridesUsed, 0, `item meter untouched for ${role}`);
    assert.equal(store.loadRun(runId).counters.overridesUsed, 0, `run meter untouched for ${role}`);
    assert.deepEqual(store.loadItem(runId, "I1").taint, [], `no taint entry for ${role}`);
    assert.equal(store.loadRun(runId).stop, null, `no stop recorded for ${role}`);
    assert.equal(
      existsSync(path.join(runDir, "anomalies.jsonl")),
      false,
      `and no §2.8 anomaly for ${role} — a refused override is not an override that happened`,
    );
  }
});

test("[21.6-reader-other-gates-unaffected] a READER role may still override the gates its edit-deny does not cover", async () => {
  const root = gitRoot("conductor-216-other-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING" });

  // The rule is narrow on purpose: it closes the one chain whose end is provably
  // blocked. A `session` or `git` override is not blocked at the opencode layer,
  // so refusing it here would be inventing a policy rather than declining a
  // pointless spend.
  const granted = await attempt(async () =>
    handleOverride({
      store,
      runId,
      config,
      journal: { log: () => undefined },
      now: () => 1_800_000_000_000,
      sessionID: "ses_reviewer_216b",
      sessionRole: "reviewer",
      itemId: "I1",
      gate: "git",
      reason: "the git gate is wrong about this one",
      grantedAction: "run git status once",
      overrideGrants: new Map(),
      stateHome: realpathSync(scratchDir("conductor-216b-statehome-")),
      workspaceKey: "wkey-216b",
      metrics: async () => null,
    }),
  );
  assert.equal(granted.threw, false, `a reviewer's git override must still work: ${messageOf(granted.error)}`);
  assert.equal(store.loadItem(runId, "I1").attempts.overridesUsed, 1, "and it spends the meter");
});

test("[21.6-writer-roles-unaffected] an implementer's edit override is untouched by the rule", async () => {
  const root = gitRoot("conductor-216-writer-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING" });

  const granted = await attempt(async () =>
    handleOverride({
      store,
      runId,
      config,
      journal: { log: () => undefined },
      now: () => 1_800_000_000_000,
      sessionID: "ses_impl_216",
      sessionRole: "implementer",
      itemId: "I1",
      gate: "edit",
      reason: "the scope is wrong about this one",
      grantedAction: "write src/beta.ts once",
      overrideGrants: new Map(),
      stateHome: realpathSync(scratchDir("conductor-216c-statehome-")),
      workspaceKey: "wkey-216c",
      metrics: async () => null,
    }),
  );
  assert.equal(granted.threw, false, `the hatch still works for a writing role: ${messageOf(granted.error)}`);
});
