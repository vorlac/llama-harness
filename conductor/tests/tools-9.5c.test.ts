// Task 9.5c RED tests — FINAL LOCATION conductor/tests/tools-9.5c.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the §2.9 STOP-REPORT path plus the two
// §3.6 hatches, added to the EXISTING conductor/adapter/tools.ts (which today carries the
// §5.3 gate wiring plus the Task 9.1/9.2/9.3/9.4a/9.4b/9.4c handlers). The red is the
// missing-export shape — tools.ts resolves, but these named bindings do not yet exist:
//   handleReport          (conductor_report — 9.5b's ONE report writer; 9.5c drives its
//                          STOP-REPORT mode, selected from run.stop !== null)
//   handleInlineClaim     (conductor_inline_claim — §3.6)
//   handleOverride        (conductor_override — §3.6)
//   inlineClaimScopeFor   (the ONE derivation that turns a persisted §2.5 inlineClaim into
//                          the §3.5 gate's `inlineClaimScope` input)
// Two rows go red as ASSERTION failures rather than unresolved imports, exactly as 9.4c's
// gate row did:
//   [9.5c-override-one-shot] drives the ALREADY-EXPORTED gateBeforeToolCall and asserts
//   NEW behaviour from it (the one-shot grant consumption). The grant map rides in on an
//   OPTIONAL field of the gate input, so a HEAD gateBeforeToolCall ignores it and denies —
//   an honest behavioural red, not a type error.
//   [9.5c-override-item-budget] / [9.5c-override-run-budget] assert the gate still denies
//   after a refused override, which is the same behavioural surface.
//
// SERIAL-ORDER NOTE (load-bearing): Phase 9 runs 9.4c -> 9.5a -> 9.5b -> 9.5c. handleReport
// is 9.5b's export; 9.5c adds NO second writer of report.md (G6, and §3.2:1155 "three
// modes, one implementation"). If 9.5b's handler is not committed when 9.5c is implemented,
// the spec's ruling is STOP AND PARK — never fork a second document writer to make this
// file green.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.5c (2687-2698)  — the authoritative behaviour of this task.
//   §2.9 (888-917)            — the closed stop vocabulary AND the normative rule that
//                               EVERY stop writes a report in stop-report mode, with the
//                               stop kind as the headline and NO closing verify.
//   §3.2:1142-1156            — the report's content and its three modes, one implementation.
//   §3.6 (1428-1455)          — inline_claim (scoped edit permission + a decision entry) and
//                               override (budget -> anomaly + taint + ONE-SHOT bypass;
//                               over budget is an `env` stop, not another override).
//   §3.5:1387-1413            — the edit gate the claim widens and the override bypasses.
//   §2.8:877-883              — the AnomalyRecord kind:"override" shape (already committed).
//   docs/build/specs/task-9.5c.assertions.json — the 12 rows mapped to the 12 tests below,
//                               its five resolved specGaps and its reusesExisting list.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.5c.assertions.json; this file is the contract
// that pins them):
//  (G1) STOP-REPORT CONTENT, NOT LAYOUT. The plan does not pin the document's structure, and
//       a structural template is 9.5b's business. These tests assert CONTENT: the stop kind
//       appears in the FIRST heading, every item id appears with its disposition, every open
//       question id appears, and every newly registered stale-red path appears. Nothing here
//       constrains section order, table shape or wording.
//  (G2) ONE WRITER. The stop-report is written by the SAME handleReport 9.5b lands, which
//       selects stop-report mode from `run.stop !== null`. These tests therefore drive the
//       committed report handler through a STOPPED run and never import a 9.5c-owned writer.
//  (G3) "RUNS NO CLOSING VERIFY" IS PROVEN BY AN OBSERVABLE EFFECT. The fixture's verify
//       scope command WRITES A SENTINEL FILE when it executes; the assertion is that the
//       sentinel does NOT exist after a stop-report (and DOES exist after a `done` report).
//       Never an absent log line.
//  (G4) ONE-SHOT SCOPE. A grant is keyed to {sessionID, gate, itemId} and is consumed by the
//       FIRST gate decision that uses it; any later action in that session — the same action
//       repeated OR a different one — is denied normally. Asserted by driving
//       gateBeforeToolCall TWICE, never by inspecting handler internals.
//  (G5) BUDGETS ARE PER-ITEM **AND** PER-RUN. Exceeding EITHER maxOverridesPerItem or
//       maxOverridesPerRun records the `env` stop + stop-report and grants nothing. Two
//       separate tests, each with the OTHER budget slack, so a handler honouring only one
//       of the two fails one of them.
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) STOP MODE BYPASSES THE ALL-SETTLED PRECONDITION. §3.2:1142's "every item PUBLISHED,
//       blocked or deferred" guards the `done` close. A stopped run is by definition NOT
//       settled — a wedged, interrupted or env-broken run has items mid-flight — so stop
//       mode must not consult it. Enforcing it in stop mode would make the artifact
//       unreachable in precisely the runs §2.9 exists to serve.
//  (P2) STOP MODE NEVER REWRITES run.stop. The stop was recorded by its recorder (the
//       continuation engine, the fan-out engine, or handleOverride here) BEFORE the writer
//       ran; the writer reads it. Every stop row reads run.json back and asserts the kind is
//       still the one the recorder wrote — never silently upgraded to `done`.
//  (P3) THE STALE-RED REGISTRATION ON A STOP PATH IS 9.5b's SHARED HELPER (its row
//       9.5b-stale-red-registration-helper says so in as many words): every item below GREEN
//       whose testScope files EXIST on disk is registered through store.addStaleRed. 9.5c
//       writes no copy of that rule; these tests assert only the OBSERVABLE (registry +
//       report content), so the helper stays 9.5b's.
//  (P4) THE INLINE CLAIM'S SCOPE IS THE ITEM'S §2.4 fileScope (§3.6:1431-1432), derived
//       ONCE by `inlineClaimScopeFor` from the PERSISTED item + queue and fed to the §3.5
//       gate's existing `inlineClaimScope` input. The gate is NOT changed for the claim —
//       core/gates-edit.ts already honours inlineClaimScope for the orchestrator role (G8).
//       The claim's EXPIRY ("until the item leaves its current state", §3.6:1432) is NOT
//       asserted here: §2.5's inlineClaim is a CLOSED {reason, decisionId} object with
//       additionalProperties:false, so the claimed state cannot be recorded on the item, and
//       widening §2.5 is a STOP-AND-PARK, not a 9.5c decision.
//  (P5) THE OVERRIDE GRANT RIDES A CALLER-OWNED MAP, exactly as the §3.5 session `registry`
//       does: handleOverride WRITES the grant into it and gateBeforeToolCall CONSUMES
//       (deletes) it on the first gate decision that needs it. That map is the seam that
//       makes the one-shot observable at the gate without the gate importing a handler.
//  (P6) A REFUSED OVERRIDE IS ATOMIC. Over budget, handleOverride writes the `env` stop and
//       the stop-report and NOTHING else: no taint entry, no counter increment, no grant.
//       Half-applying it would leave a taint the human reads as an override that never
//       happened.
//  (P7) THE CLOSING VERIFY (the `done` contrast only) runs with cwd = the workspace root.
//       That is what makes the sentinel path predictable; it is 9.5b's behaviour, restated
//       here only because this file's G3 proof depends on it.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). ONE options object
// per handler, following the committed handleX convention; runDir is derived as
// <store.root>/.conductor/runs/<runId>/; the fixture repo IS <store.root>. `journal` is the
// leveled sink (the committed HandlerJournal/GateJournal shape); `now` defaults to Date.now.
//
//   // 9.5b's writer, driven here in STOP mode (see the serial-order note above).
//   handleReport(input: {
//     store: StateStore; runId: string; config: Config; journal: HandlerJournal;
//     stateHome: string; workspaceKey: string; now?: () => number;
//     metrics?: () => Promise<MetricsSummary | null>;   // Task 7.2's fail-soft fetch, stubbed
//   }): Promise<{ … }>                                  // read off DISK, never off the return
//
//   // §3.6 inline claim. Records the §2.7 decision (kind:"derived", the reason is the why)
//   // through the SAME requireTwoOptions gate conductor_decide applies, then annotates the
//   // §2.5 item. Legality BEFORE persist: a rejected claim writes nothing at all.
//   handleInlineClaim(input: {
//     store: StateStore; runId: string; journal: HandlerJournal; now?: () => number;
//     itemId: string; reason: string;
//     options: Array<{ name: string; score?: DecisionRecord["options"][number]["score"] }>;
//     choice: string;
//   }): { itemId: string; decisionId: string; … }
//
//   // The ONE derivation the §3.5 gate's inlineClaimScope input is fed from (P4).
//   inlineClaimScopeFor(store: StateStore, runId: string, itemId: string): string[] | null
//
//   // §3.6 override. Budget check FIRST; on grant: anomaly + taint + counters + a ONE-SHOT
//   // grant in `overrideGrants`. Over budget: `env` stop + stop-report, and nothing else.
//   handleOverride(input: {
//     store: StateStore; runId: string; config: Config; journal: HandlerJournal;
//     now?: () => number; sessionID: string; itemId: string; gate: string; reason: string;
//     grantedAction: string; overrideGrants: Map<string, OverrideGrant>;
//     stateHome: string; workspaceKey: string;
//     metrics?: () => Promise<MetricsSummary | null>;
//   }): Promise<{ granted: boolean; … }>
//
//   // The gate input gains ONE optional field (P5); everything else about §5.3 is unchanged.
//   gateBeforeToolCall(input: GateHookInput & { overrideGrants?: Map<string, OverrideGrant> })
//
//   interface OverrideGrant {
//     sessionID: string; gate: string; itemId: string;
//     reason: string; grantedAction: string; tsMs: number;
//   }
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id as its FIRST token):
//   9.5c-stop-report-noop       → a `noop` stop writes report.md in stop mode: headline,
//                                 dispositions, questions, stale-red.
//   9.5c-stop-report-blocked    → the same for `blocked`, naming the blocking question and
//                                 the item it blocks.
//   9.5c-stop-report-surfaced   → the same for `surfaced`, naming the human-territory question.
//   9.5c-stop-report-env        → the same for `env`, carrying the environment reason.
//   9.5c-stop-report-interrupt  → the same for `interrupt` — the artifact the wedged runs
//                                 never produced.
//   9.5c-stop-report-no-verify  → the sentinel proof, for ALL FIVE kinds, with the `done`
//                                 contrast producing it.
//   9.5c-inline-claim-scopes-edit  → DENIED before, ALLOWED after, out-of-claim still denied,
//                                 through the REAL §5.3 gate.
//   9.5c-inline-claim-decision  → the §2.7 record is minted, schema-valid, and requireTwoOptions
//                                 rejects an under-optioned derived claim with ZERO persistence.
//   9.5c-override-records       → anomaly + taint + BOTH counters, read off disk.
//   9.5c-override-one-shot      → gateBeforeToolCall twice: allowed, then denied.
//   9.5c-override-item-budget   → maxOverridesPerItem exhausted ⇒ env stop + stop-report, nothing granted.
//   9.5c-override-run-budget    → maxOverridesPerRun exhausted ⇒ the same (a SEPARATE budget).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";

// THE SUBJECTS — absent at red time (missing-export red from the existing tools.ts).
import { handleInlineClaim, handleOverride, handleReport, inlineClaimScopeFor } from "../adapter/tools.ts";

// Committed today.
import { gateBeforeToolCall } from "../adapter/tools.ts";
// C-043 ruling 2: handleReport is 9.5b's export and 9.5b owns its input surface,
// which requires a Fanout. This file was written before that surface existed and
// pinned it without one. The FIXTURE yields to the owner; no assertion changes.
// The report dispatches nothing, so the instance exists only to satisfy the shape.
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import type { GateHookInput, RegistryEntry } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { answerQuestion, appendQuestion, readQuestions } from "../adapter/questions.ts";
import type { MetricsSummary } from "../adapter/router-client.ts";
import { requireTwoOptions } from "../core/decide.ts";
import { STOP_KINDS } from "../core/stops.ts";
import { validate } from "../core/types.ts";
import { MAIN_TREE, treePath } from "../core/types.ts";
import type {
  AnomalyRecord,
  Config,
  DecisionRecord,
  EvidenceRecord,
  Item,
  ItemState,
  Queue,
  QueueItem,
  StopKind,
  TreePath,
} from "../core/types.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY so every call site below type-checks the green
// implementation against this file's contract (the 9.4a/9.4b/9.4c convention). These are
// LOCAL mirrors on purpose: nothing here imports a type that does not exist at HEAD, so the
// red stays the missing-HANDLER shape rather than a cascade of unresolved type imports.
// ---------------------------------------------------------------------------

interface JournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
}

// P5: the caller-owned one-shot grant map, the sibling of the §3.5 session registry.
interface OverrideGrant {
  sessionID: string;
  gate: string;
  itemId: string;
  reason: string;
  grantedAction: string;
  tsMs: number;
}

type OverrideGrants = Map<string, OverrideGrant>;

// The §5.3 gate input plus the ONE optional field 9.5c adds (P5). An INTERSECTION, not an
// `extends`, so the green implementation declaring its own `overrideGrants` on GateHookInput
// cannot collide with this mirror.
type GateInput = GateHookInput & { overrideGrants?: OverrideGrants };

// 9.5b's writer, as this file consumes it (stop mode only). Built as a TYPED CONST and then
// passed, so the object is not "fresh" at the call site: a green handleReport carrying extra
// optional fields still accepts it.
interface ReportInput {
  store: StateStore;
  // C-043 ruling 2: 9.5b owns handleReport and its committed input requires a
  // Fanout (taken for a uniform handler shape, never used — a report dispatches
  // nothing). This restatement was written before that surface existed.
  fanout: Fanout;
  runId: string;
  config: Config;
  journal: JournalSink;
  stateHome: string;
  workspaceKey: string;
  now?: () => number;
  metrics?: () => Promise<MetricsSummary | null>;
}

interface InlineClaimInput {
  store: StateStore;
  runId: string;
  journal: JournalSink;
  now?: () => number;
  itemId: string;
  reason: string;
  options: DecisionRecord["options"];
  choice: string;
}

interface OverrideInput {
  store: StateStore;
  runId: string;
  config: Config;
  journal: JournalSink;
  now?: () => number;
  sessionID: string;
  sessionRole: string;
  itemId: string;
  gate: string;
  reason: string;
  grantedAction: string;
  overrideGrants: OverrideGrants;
  stateHome: string;
  workspaceKey: string;
  metrics?: () => Promise<MetricsSummary | null>;
}

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a value
// DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-6640";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-3318";
const RED_MARKER = "CAPTURED-RED-MARKER-4471";
const BLOCK_MARKER = "BLOCK-REASON-MARKER-1902: the schema owner has not answered";
const DEFER_MARKER = "DEFER-REASON-MARKER-7734: out of scope for this run";
const QUESTION_MARKER = "QUESTION-MARKER-5051 which retry budget does the router owe";
const HUMAN_QUESTION_MARKER = "should we ship this to customers before the audit (HUMAN-Q-MARKER-8123)";
const CLAIM_MARKER = "INLINE-CLAIM-REASON-MARKER-2244: a one-line rename surfaced by review";
const OVERRIDE_MARKER = "OVERRIDE-REASON-MARKER-9317: the edit gate cannot see the generated header";
const GRANTED_ACTION_MARKER = "edit src/i1/generated-header.mjs (GRANTED-ACTION-MARKER-4408)";

// The verify scope name is deliberately distinctive so a hardcoded "unit" cannot satisfy it.
const SCOPE = "unit6640";

// G3's observable effect: the verify scope command WRITES this file, relative to its cwd
// (P7: the workspace root). Its existence is the proof a verify actually executed.
const SENTINEL_REL = "verify-sentinel-9-5-c.txt";

// A fixed injected clock: every stamped value the handlers mint reads it.
const START_MS = 1_755_100_000_000;

// The §4.2 shared tree under parallel.writes "off".
const TREE = MAIN_TREE;

// The §2.9 kinds this task's stop-report path must serve — the five NON-`done` kinds, drawn
// from core/stops.ts's CLOSED vocabulary rather than typed out as literals, so a widened (or
// narrowed) STOP_KINDS breaks this file instead of silently passing it.
const STOP_REPORT_KINDS: readonly StopKind[] = STOP_KINDS.filter((kind) => kind !== "done");

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom). Every fixture is a
// throwaway repo under os.tmpdir(); the out-of-repo state home is a SEPARATE throwaway dir.
// ---------------------------------------------------------------------------

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

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

// A committed fixture repo, so run creation records a REAL HEAD sha and branch "main".
function committedRepo(): TreePath {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools95c-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src", "i1"), { recursive: true });
  mkdirSync(path.join(dir, "src", "other"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools95c-state-"));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Journal sink (the tools-9.1..9.4c harness shape).
// ---------------------------------------------------------------------------

interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}

function makeJournal(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
  };
  return { sink, records };
}

// Task 7.2's fail-soft metrics fetch, STUBBED: the report is hermetic (no router, no
// socket) and a null result must render a metrics-unavailable line rather than crash.
async function noMetrics(): Promise<MetricsSummary | null> {
  return null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface ConfigOpts {
  maxOverridesPerItem?: number;
  maxOverridesPerRun?: number;
}

// The verify scope command: a REAL child process that writes the G3 sentinel into its cwd
// and exits 0. Every stop-report row asserts this file's ABSENCE.
const SENTINEL_CMD: string[] = [
  process.execPath,
  "-e",
  `require("node:fs").writeFileSync(${JSON.stringify(SENTINEL_REL)}, "the closing verify ran\\n")`,
];

function makeConfig(opts: ConfigOpts = {}): Config {
  const scopes: Config["verify"]["scopes"] = {
    [SCOPE]: { command: [...SENTINEL_CMD], timeoutMs: 120_000 },
  };
  return {
    version: 1,
    verify: {
      scopes,
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: opts.maxOverridesPerItem ?? 1,
      maxOverridesPerRun: opts.maxOverridesPerRun ?? 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// ---------------------------------------------------------------------------
// Store / run / queue fixtures
// ---------------------------------------------------------------------------

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

const USER_PROMPT = "make the beta parser keep the sign of negative offsets";

function createRunFor(store: StateStore): string {
  const run = store.createRun({
    prompt: USER_PROMPT,
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  return run.runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
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

function makeQueueItem(
  id: string,
  over: { fileScope: string[]; testScope: string[]; behavioral?: boolean; dependsOn?: string[] },
): QueueItem {
  return {
    id,
    title: `keep the sign of negative offsets (${TITLE_MARKER})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: over.behavioral ?? true,
    dependsOn: [...(over.dependsOn ?? [])],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

// The §2.4 queue every bench below uses:
//   I1 behavioral, MID-FLIGHT at RED, with its test file ON DISK (so P3's stale-red
//      registration has exactly one candidate) — and the only item with a fileScope the
//      §3.6 hatches operate on;
//   I2 non-behavioral, BLOCKED on a surfaced question;
//   I3 non-behavioral, DEFERRED.
// I2/I3 own no test files, so the stale-red assertion below is unambiguous.
const I1_FILE_SCOPE = ["src/i1/**"];
const I1_TEST_REL = "tests/i1.test.mjs";

function fixtureQueue(): Queue {
  return {
    items: [
      makeQueueItem("I1", { fileScope: [...I1_FILE_SCOPE], testScope: [I1_TEST_REL] }),
      makeQueueItem("I2", { fileScope: ["docs/i2.md"], testScope: [], behavioral: false }),
      makeQueueItem("I3", { fileScope: ["docs/i3.md"], testScope: [], behavioral: false }),
    ],
  };
}

function appendRed(runDir: string, itemId: string, seq: number, testRel: string): EvidenceRecord {
  const record: EvidenceRecord = {
    seq,
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", testRel],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER} (${itemId})\n\n7 !== -7`,
    failureClass: "assertion",
    targeted: true,
  };
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  return record;
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function readDecisions(runDir: string): DecisionRecord[] {
  const file = path.join(runDir, "decisions.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DecisionRecord);
}

function readAnomalies(runDir: string): AnomalyRecord[] {
  const file = path.join(runDir, "anomalies.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AnomalyRecord);
}

// ---------------------------------------------------------------------------
// The bench: ONE builder for every row (a stopped run, a live run, either budget shape).
// ---------------------------------------------------------------------------

const NEVER_FROZEN: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

// A Fanout that CAN answer anything, so a "dispatched nothing" assertion is about
// the handler declining to ask rather than the fixture being unable to reply.
function makeReportFanout(runId: string, config: Config, journal: JournalSink): Fanout {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  sdk.setResponder(() => ({ kind: "reply", text: "{}" }));
  return createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    NEVER_FROZEN,
    runId,
  );
}

interface Bench {
  root: TreePath;
  fanout: Fanout;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  queue: Queue;
  config: Config;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  questionId: string;
  humanQuestionId: string;
  sentinelPath: string;
  reportPath: string;
}

interface BenchOpts {
  stop?: { kind: StopKind; reasonDisplay: string };
  config?: ConfigOpts;
  itemOverridesUsed?: number;
  runOverridesUsed?: number;
}

function buildBench(opts: BenchOpts = {}): Bench {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig(opts.config ?? {});
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue = fixtureQueue();

  // The §2.4 queue + the three §2.5 items, seeded DIRECTLY on disk (the tools-9.2..9.4c
  // discipline: no other task's handler runs inside this file's fixtures).
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  store.saveItem(runId, makeRuntimeItem("I1", "RED"));
  store.saveItem(runId, makeRuntimeItem("I2", "PENDING"));
  store.saveItem(runId, makeRuntimeItem("I3", "PENDING"));

  // I1 is genuinely mid-flight: its §2.6 red is on the ledger and its test file is ON DISK,
  // which is what makes it the stale-red candidate every stop-report must name (P3).
  writeFileSync(
    path.join(root, I1_TEST_REL),
    `// ${RED_MARKER}\nimport test from "node:test";\ntest("t", () => {});\n`,
  );
  const red = appendRed(runDir, "I1", 1, I1_TEST_REL);
  const i1 = store.loadItem(runId, "I1");
  i1.evidence.red = { ledger: "evidence.jsonl", seq: red.seq };
  i1.attempts.overridesUsed = opts.itemOverridesUsed ?? 0;
  store.saveItem(runId, i1);

  // Two OPEN §2.11 questions through the committed writer: one ordinary question blocking
  // I2, one human-territory question blocking nothing.
  const question = appendQuestion(
    runDir,
    {
      runId,
      question: QUESTION_MARKER,
      askedBy: { role: "implementer", sessionID: "ses_impl" },
      humanTerritory: false,
      origin: "implementer-blocked",
      blocksItems: ["I2"],
    },
    START_MS,
  );
  const humanQuestion = appendQuestion(
    runDir,
    {
      runId,
      question: HUMAN_QUESTION_MARKER,
      askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
      humanTerritory: true,
      origin: "surface-tool",
      blocksItems: [],
    },
    START_MS,
  );

  store.setBlocked(runId, "I2", {
    reason: BLOCK_MARKER,
    stage: "GREEN",
    questionId: question.id,
  });
  store.setDeferred(runId, "I3", { reason: DEFER_MARKER, decisionId: "D-9999" });

  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  run.counters.overridesUsed = opts.runOverridesUsed ?? 0;
  if (opts.stop !== undefined) {
    run.stop = { kind: opts.stop.kind, reasonDisplay: opts.stop.reasonDisplay, tsMs: START_MS };
  }
  store.saveRun(run);

  return {
    root,
    stateHome,
    store,
    runId,
    runDir,
    queue,
    config,
    journal,
    fanout: makeReportFanout(runId, config, journal.sink),
    questionId: question.id,
    humanQuestionId: humanQuestion.id,
    sentinelPath: path.join(root, SENTINEL_REL),
    reportPath: path.join(runDir, "report.md"),
  };
}

function reportInputFor(bench: Bench): ReportInput {
  return {
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    now: () => START_MS,
    metrics: noMetrics,
  };
}

function readReport(bench: Bench): string {
  assert.equal(existsSync(bench.reportPath), true, "report.md was written at runs/<runId>/report.md");
  return readFileSync(bench.reportPath, "utf8");
}

// The document's FIRST markdown heading — G1's "headline" slot, the ONE piece of layout the
// stop-report rows pin (and only because §2.9 makes the stop kind the headline).
function firstHeading(markdown: string): string {
  const line = markdown.split("\n").find((raw) => raw.trimStart().startsWith("#"));
  assert.ok(line !== undefined, "report.md opens with a markdown heading");
  return line;
}

// G1's shared content contract, asserted for EVERY stop kind: the kind is the headline, the
// stop's own reason is carried, every item appears WITH its disposition, every OPEN question
// id appears, and the newly registered stale-red path is named.
function assertStopReportContent(bench: Bench, kind: StopKind, reasonDisplay: string): string {
  const markdown = readReport(bench);
  const heading = firstHeading(markdown);

  assert.match(
    heading,
    new RegExp(kind, "i"),
    `§2.9: the stop kind "${kind}" is the report's headline, not a detail buried in a section`,
  );
  assert.ok(
    markdown.includes(reasonDisplay),
    "the stop's own reasonDisplay is carried into the document",
  );

  // Every item, with its disposition. I1 is mid-flight (its FSM position IS its
  // disposition); I2 and I3 carry the §2.5 annotation REASONS.
  assert.ok(markdown.includes("I1"), "the mid-flight item is named");
  assert.ok(markdown.includes("RED"), "the mid-flight item's disposition (its §3.3 state) is reported");
  assert.ok(markdown.includes("I2"), "the blocked item is named");
  assert.ok(markdown.includes(BLOCK_MARKER), "the blocked item's REASON is reported");
  assert.ok(markdown.includes("I3"), "the deferred item is named");
  assert.ok(markdown.includes(DEFER_MARKER), "the deferred item's REASON is reported");

  // Every OPEN §2.11 question, by id, read back through the committed reader so the
  // expectation is the ledger's and not this file's.
  const open = readQuestions(bench.runDir).filter((q) => q.answeredIso === null);
  assert.equal(open.length, 2, "premise: the fixture leaves exactly two OPEN questions");
  for (const question of open) {
    assert.ok(
      markdown.includes(question.id),
      `the open question ${question.id} is listed in the stop-report`,
    );
  }

  // P3: the abandoned red test is newly registered in the §2.11 registry AND named in the
  // document. Asserted through the committed store reader.
  const registered = bench.store.readStaleRed().entries.filter((entry) => entry.runId === bench.runId);
  assert.deepEqual(
    registered.map((entry) => entry.path).sort(),
    [I1_TEST_REL],
    "this terminal path registered exactly the mid-flight item's abandoned red test (§2.11)",
  );
  assert.equal(registered[0].itemId, "I1", "the registry entry names the item that owns the test");
  assert.ok(markdown.includes(I1_TEST_REL), "the newly registered stale-red path is NAMED in the report");

  // P2: the writer READS the stop; it never rewrites it (least of all to `done`).
  const after = bench.store.loadRun(bench.runId);
  assert.notEqual(after.stop, null, "run.json still carries the stop the recorder wrote");
  assert.equal(after.stop?.kind, kind, "the stop kind is UNCHANGED by the writer (never upgraded to `done`)");

  return markdown;
}

// ---------------------------------------------------------------------------
// The §5.3 gate, driven for real. Every claim/override permission assertion below goes
// THROUGH this — never through decideEdit directly, and never by reading handler internals.
// ---------------------------------------------------------------------------

interface EditAttempt {
  bench: Bench;
  sessionID: string;
  role: string;
  itemId: string;
  editRel: string;
  fileScope: string[];
  testScope: string[];
  inlineClaimScope: string[] | null;
  overrideGrants?: OverrideGrants;
}

function attemptEdit(attempt: EditAttempt): { allowed: boolean; reason: string } {
  const registry = new Map<string, RegistryEntry>([
    [attempt.sessionID, { role: attempt.role, itemId: attempt.itemId, tree: attempt.bench.root }],
  ]);
  const editPath = path.join(attempt.bench.root, attempt.editRel);
  const input: GateInput = {
    sessionID: attempt.sessionID,
    toolName: "edit",
    args: { filePath: editPath },
    editPath,
    registry,
    gitMode: "commit",
    runActive: true,
    branchPolicy: "pin",
    fileScope: [...attempt.fileScope],
    testScope: [...attempt.testScope],
    verifyInFlightTree: null,
    inlineClaimScope: attempt.inlineClaimScope === null ? null : [...attempt.inlineClaimScope],
    journal: attempt.bench.journal.sink,
    corr: { runId: attempt.bench.runId, itemId: attempt.itemId, sessionID: attempt.sessionID },
    ...(attempt.overrideGrants === undefined ? {} : { overrideGrants: attempt.overrideGrants }),
  };
  try {
    // Passed as a VARIABLE, not a fresh literal, so the extra `overrideGrants` field is a
    // structural addition the committed signature tolerates rather than an excess-property
    // type error at red time.
    gateBeforeToolCall(input);
    return { allowed: true, reason: "" };
  } catch (err) {
    return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// The two §2.7 scored options every legal derived decision in this file carries.
function scoredOptions(): DecisionRecord["options"] {
  return [
    {
      name: "work it inline under a claim",
      score: { capability: 3, testability: 3, movingParts: 4, validationEarliness: 3, singleSource: 4 },
    },
    {
      name: "dispatch an implementer sub-session",
      score: { capability: 3, testability: 3, movingParts: 2, validationEarliness: 3, singleSource: 3 },
    },
  ];
}

// ---------------------------------------------------------------------------
// Fixture sanity: the fixtures are real §2.4/§2.5 records, the stop vocabulary is the
// COMMITTED one, and the under-optioned claim really is rejected by the core rule. (The
// 9.1-9.4c probe-block discipline: a red below is then about the handlers, never the fixture.)
// ---------------------------------------------------------------------------

assert.equal(validate("Queue", fixtureQueue()).ok, true, "sanity: the queue fixture satisfies SCHEMAS.Queue");
assert.equal(validate("Item", makeRuntimeItem("I1", "RED")).ok, true, "sanity: the item fixture satisfies SCHEMAS.Item");
assert.deepEqual(
  [...STOP_REPORT_KINDS].sort(),
  ["blocked", "env", "interrupt", "noop", "surfaced"],
  "sanity: the five stop-report kinds are exactly core/stops.ts STOP_KINDS minus `done` (a CLOSED vocabulary 9.5c consumes and never widens)",
);
{
  const probe: DecisionRecord = {
    id: "D-0001",
    tsIso: new Date(START_MS).toISOString(),
    question: "probe",
    options: [scoredOptions()[0]],
    choice: "work it inline under a claim",
    why: CLAIM_MARKER,
    kind: "derived",
    appliedWhere: "I1",
  };
  assert.equal(requireTwoOptions(probe).ok, false, "sanity: core requireTwoOptions rejects a one-option derived record");
  assert.equal(
    requireTwoOptions({ ...probe, options: scoredOptions() }).ok,
    true,
    "sanity: the two scored options this file uses DO satisfy the core rule",
  );
  assert.equal(validate("DecisionRecord", { ...probe, options: scoredOptions() }).ok, true, "sanity: the record shape is §2.7-valid");
}

// ===========================================================================
// [9.5c-stop-report-noop]
// ===========================================================================

test("[9.5c-stop-report-noop] a run whose recorded stop is kind `noop` gets report.md in STOP-REPORT mode from the ONE report writer: the stop kind is the headline, EVERY item appears with its disposition (mid-flight state, blocked reason, deferred reason), every open question id is listed, and the newly registered stale-red file is named — all read back off the PERSISTED report.md, with the run's unsettled items proving stop mode does not consult the §3.2 all-settled precondition (P1)", async () => {
  const reason = "three consecutive futile idle re-prompts (NOOP-REASON-MARKER-3311)";
  const bench = buildBench({ stop: { kind: "noop", reasonDisplay: reason } });

  // Premise: this run is NOT settled — I1 is mid-flight at RED. A stop-report is exactly
  // the artifact the §3.2 `done` precondition would refuse to write.
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "RED", "premise: an item is mid-flight");
  assert.equal(existsSync(bench.reportPath), false, "premise: no report.md exists before the call");

  await handleReport(reportInputFor(bench));

  assertStopReportContent(bench, "noop", reason);
});

// ===========================================================================
// [9.5c-stop-report-blocked]
// ===========================================================================

test("[9.5c-stop-report-blocked] the same for stop kind `blocked`, and additionally: the report names the BLOCKING QUESTION (its id and its text) together with the item that question blocks, so a human reading the artifact can see which answer unwedges which item", async () => {
  const reason = "every remaining item is blocked (BLOCKED-REASON-MARKER-7725)";
  const bench = buildBench({ stop: { kind: "blocked", reasonDisplay: reason } });

  const blocked = bench.store.loadItem(bench.runId, "I2");
  assert.equal(blocked.blocked?.questionId, bench.questionId, "premise: I2 is blocked on the fixture question");

  await handleReport(reportInputFor(bench));

  const markdown = assertStopReportContent(bench, "blocked", reason);
  assert.ok(markdown.includes(bench.questionId), "the blocking question is named by id");
  assert.ok(markdown.includes(QUESTION_MARKER), "the blocking question's TEXT is carried, not just its id");
  assert.ok(markdown.includes("I2"), "the item that question blocks is named");
});

// ===========================================================================
// [9.5c-stop-report-surfaced]
// ===========================================================================

test("[9.5c-stop-report-surfaced] the same for stop kind `surfaced`, and additionally: the HUMAN-TERRITORY question that caused the surface is named (id and text) — the run stopped because only a human can answer it, so the artifact must show the human what they are being asked", async () => {
  const reason = "only human-territory questions remain (SURFACED-REASON-MARKER-6612)";
  const bench = buildBench({ stop: { kind: "surfaced", reasonDisplay: reason } });

  const human = readQuestions(bench.runDir).filter((q) => q.humanTerritory && q.answeredIso === null);
  assert.deepEqual(
    human.map((q) => q.id),
    [bench.humanQuestionId],
    "premise: exactly one OPEN human-territory question exists",
  );

  await handleReport(reportInputFor(bench));

  const markdown = assertStopReportContent(bench, "surfaced", reason);
  assert.ok(markdown.includes(bench.humanQuestionId), "the human-territory question is named by id");
  assert.ok(markdown.includes(HUMAN_QUESTION_MARKER), "the human-territory question's TEXT is carried");
});

// ===========================================================================
// [9.5c-stop-report-env]
// ===========================================================================

test("[9.5c-stop-report-env] the same for stop kind `env`, and additionally: the ENVIRONMENT FAILURE REASON recorded on the stop is carried verbatim into the document — an `env` stop whose report does not say what broke is the artifact that sends the human back to the journal", async () => {
  const reason = "the verify runner could not start: ENOENT (ENV-REASON-MARKER-2048)";
  const bench = buildBench({ stop: { kind: "env", reasonDisplay: reason } });

  await handleReport(reportInputFor(bench));

  const markdown = assertStopReportContent(bench, "env", reason);
  assert.ok(markdown.includes("ENV-REASON-MARKER-2048"), "the environment failure reason is carried into the report");
});

// ===========================================================================
// [9.5c-stop-report-interrupt]
// ===========================================================================

test("[9.5c-stop-report-interrupt] the same for stop kind `interrupt` — a run halted mid-flight STILL produces the artifact (this is the case the wedged runs previously did not produce at all): report.md exists, the headline names the interrupt, and the mid-flight item's position plus the abandoned red test are both on the page", async () => {
  const reason = "halt file present; the human aborted the run (INTERRUPT-REASON-MARKER-8890)";
  const bench = buildBench({ stop: { kind: "interrupt", reasonDisplay: reason } });

  await handleReport(reportInputFor(bench));

  const markdown = assertStopReportContent(bench, "interrupt", reason);
  // The whole point of §2.9's normative rule: an interrupted run leaves a readable trace of
  // exactly where it was when it died.
  assert.ok(markdown.includes("I1"), "the item that was in flight when the run died is on the page");
  assert.ok(markdown.includes(I1_TEST_REL), "so is the red test it abandoned in the tree");
});

// ===========================================================================
// [9.5c-stop-report-no-verify]
// ===========================================================================

test("[9.5c-stop-report-no-verify] NO closing verify runs on ANY stop-report path, proven by an OBSERVABLE EFFECT rather than a missing log line: the fixture's verify command writes a sentinel file when it executes, and after a stop-report of EVERY one of the five §2.9 non-`done` kinds the sentinel does NOT exist and NO §2.6 verify record was appended — while the CONTRAST, a settled run closing with `done`, DOES produce both", async () => {
  for (const kind of STOP_REPORT_KINDS) {
    await test(`stop kind ${kind}: the sentinel is never written`, async () => {
      const bench = buildBench({ stop: { kind, reasonDisplay: `stop ${kind} (NO-VERIFY-MARKER-1177)` } });
      assert.equal(existsSync(bench.sentinelPath), false, "premise: the sentinel does not exist before the call");
      const before = readEvidence(bench.runDir).length;

      await handleReport(reportInputFor(bench));

      assert.equal(existsSync(bench.reportPath), true, `a ${kind} stop still produced the artifact`);
      assert.equal(
        existsSync(bench.sentinelPath),
        false,
        `§2.9: a ${kind} stop-report does NOT re-run the full verify (the sentinel proves nothing executed)`,
      );
      const verifyRecords = readEvidence(bench.runDir).filter((record) => record.kind === "verify");
      assert.equal(verifyRecords.length, 0, "no §2.6 verify record was appended on the stop path");
      assert.equal(readEvidence(bench.runDir).length, before, "the evidence ledger is untouched by a stop-report");
      assert.equal(
        existsSync(path.join(bench.runDir, `verify-running-${TREE}.json`)),
        false,
        "no per-tree verify marker was ever written (nothing was quarantined either)",
      );
    });
  }

  await test("the CONTRAST: a settled run closing with `done` DOES run the closing verify", async () => {
    // The same fixture shape, but every item settled and NO stop recorded — the §3.2 `done`
    // path 9.5b owns. Without this half, "the sentinel is absent" would also pass on a
    // report writer that never runs a verify at all.
    const bench = buildBench();
    for (const itemId of ["I1", "I2", "I3"]) {
      const item = bench.store.loadItem(bench.runId, itemId);
      item.state = "PUBLISHED";
      item.blocked = null;
      item.deferred = null;
      bench.store.saveItem(bench.runId, item);
    }
    // GAP-021: `done` is the narrowest verdict the closer produces — it needs every
    // disposition settled AND no human lever outstanding. This fixture's ledger
    // carries the open questions the stop-mode rows minted, and an open question is
    // a lever, so they are answered here to make the contrast a genuine `done`.
    for (const q of readQuestions(bench.runDir).filter((entry) => entry.answeredIso === null)) {
      answerQuestion(bench.runDir, q.id, "settled for this contrast", "tool", START_MS);
    }
    assert.equal(bench.store.loadRun(bench.runId).stop, null, "premise: no stop is recorded, so stop mode is not selected");
    assert.equal(existsSync(bench.sentinelPath), false, "premise: the sentinel does not exist before the call");

    await handleReport(reportInputFor(bench));

    assert.equal(
      existsSync(bench.sentinelPath),
      true,
      "the `done` path DOES re-run the full verify — the sentinel is a live proof, not a tautology",
    );
    assert.equal(bench.store.loadRun(bench.runId).stop?.kind, "done", "and the `done` stop was recorded");
  });
});

// ===========================================================================
// [9.5c-inline-claim-scopes-edit]
// ===========================================================================

test("[9.5c-inline-claim-scopes-edit] conductor_inline_claim widens the ORCHESTRATOR's edit permission to the claimed item's fileScope and records {reason, decisionId} on the §2.5 item — the widening asserted THROUGH the real §5.3 gate wiring over core/gates-edit decideEdit: the SAME edit is DENIED before the claim and ALLOWED after, while a path OUTSIDE the claim stays denied, and the gate's scope input comes from the ONE derivation over the PERSISTED item (never from the handler's return value)", async () => {
  const bench = buildBench();
  const inScope = "src/i1/parse.mjs";
  const outOfScope = "src/other/unrelated.mjs";

  // (1) BEFORE the claim: the derivation reports no claim, and the gate denies under G8.
  assert.equal(
    inlineClaimScopeFor(bench.store, bench.runId, "I1"),
    null,
    "with no claim persisted the derivation yields no scope at all",
  );
  const beforeAttempt = attemptEdit({
    bench,
    sessionID: "ses_orchestrator",
    role: "orchestrator",
    itemId: "I1",
    editRel: inScope,
    fileScope: [...I1_FILE_SCOPE],
    testScope: [I1_TEST_REL],
    inlineClaimScope: inlineClaimScopeFor(bench.store, bench.runId, "I1"),
  });
  assert.equal(beforeAttempt.allowed, false, "G8: the orchestrator may not edit source without an active claim");
  assert.match(beforeAttempt.reason, /inline claim/i, "and the denial names the missing claim");

  // (2) The claim.
  const claimInput: InlineClaimInput = {
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    itemId: "I1",
    reason: CLAIM_MARKER,
    options: scoredOptions(),
    choice: "work it inline under a claim",
  };
  const claim: { decisionId: string } = handleInlineClaim(claimInput);

  const claimed = bench.store.loadItem(bench.runId, "I1");
  assert.notEqual(claimed.inlineClaim, null, "the §2.5 item carries the claim after the call");
  assert.equal(claimed.inlineClaim?.reason, CLAIM_MARKER, "the claim records the caller's REASON verbatim");
  assert.equal(claimed.inlineClaim?.decisionId, claim.decisionId, "and the decision id the handler minted");

  // (3) AFTER the claim: the SAME edit, the SAME gate, the SAME derivation — now allowed.
  const scope = inlineClaimScopeFor(bench.store, bench.runId, "I1");
  assert.deepEqual(scope, [...I1_FILE_SCOPE], "§3.6: the claim scopes edit permission to the item's own fileScope");
  const afterAttempt = attemptEdit({
    bench,
    sessionID: "ses_orchestrator",
    role: "orchestrator",
    itemId: "I1",
    editRel: inScope,
    fileScope: [...I1_FILE_SCOPE],
    testScope: [I1_TEST_REL],
    inlineClaimScope: scope,
  });
  assert.equal(afterAttempt.allowed, true, "the identical edit is ALLOWED once the claim is active");

  // (4) The claim is a SCOPE, not an amnesty: a path it does not cover stays denied.
  const outside = attemptEdit({
    bench,
    sessionID: "ses_orchestrator",
    role: "orchestrator",
    itemId: "I1",
    editRel: outOfScope,
    fileScope: [...I1_FILE_SCOPE],
    testScope: [I1_TEST_REL],
    inlineClaimScope: scope,
  });
  assert.equal(outside.allowed, false, "a path OUTSIDE the claimed fileScope is still denied");

  // (5) The claim is per-ITEM: it says nothing about a different item.
  assert.equal(
    inlineClaimScopeFor(bench.store, bench.runId, "I2"),
    null,
    "claiming I1 grants no scope on I2",
  );
});

// ===========================================================================
// [9.5c-inline-claim-decision]
// ===========================================================================

test("[9.5c-inline-claim-decision] the claim's §2.7 decision is minted and appended to decisions.jsonl, is schema-valid, carries kind `derived` with the claim's reason as its `why`, and is gated by the SAME core requireTwoOptions rule conductor_decide applies — a derived claim carrying fewer than two SCORED options is rejected and NOTHING is persisted (no ledger line, no item annotation): legality before persist", async () => {
  await test("the accepted claim writes exactly one valid §2.7 record", () => {
    const bench = buildBench();
    assert.deepEqual(readDecisions(bench.runDir), [], "premise: the ledger starts empty");

    const claim: { decisionId: string } = handleInlineClaim({
      store: bench.store,
      runId: bench.runId,
      journal: bench.journal.sink,
      now: () => START_MS,
      itemId: "I1",
      reason: CLAIM_MARKER,
      options: scoredOptions(),
      choice: "work it inline under a claim",
    });

    const ledger = readDecisions(bench.runDir);
    assert.equal(ledger.length, 1, "exactly ONE decision line was appended");
    const record = ledger[0];
    assert.equal(record.id, claim.decisionId, "the appended record is the one the item points at");
    assert.equal(validate("DecisionRecord", record).ok, true, "the persisted record satisfies SCHEMAS.DecisionRecord");
    assert.equal(record.kind, "derived", "§3.6: a claim is a DERIVED decision");
    assert.equal(record.why, CLAIM_MARKER, "§3.6: the claim's reason IS the decision's why");
    assert.equal(record.appliedWhere.includes("I1"), true, "the record says which item it applied to");
    assert.equal(requireTwoOptions(record).ok, true, "and the persisted record passes the core gate it was judged by");
    assert.equal(
      bench.store.loadItem(bench.runId, "I1").inlineClaim?.decisionId,
      record.id,
      "the §2.5 item points at that exact ledger id",
    );
  });

  await test("an under-optioned derived claim is REJECTED and persists nothing", () => {
    const bench = buildBench();
    const oneOption: InlineClaimInput = {
      store: bench.store,
      runId: bench.runId,
      journal: bench.journal.sink,
      now: () => START_MS,
      itemId: "I1",
      reason: CLAIM_MARKER,
      options: [scoredOptions()[0]],
      choice: "work it inline under a claim",
    };
    assert.throws(
      () => handleInlineClaim(oneOption),
      /2 real options|at least 2|two/i,
      "a derived claim with one option is rejected by the SAME requireTwoOptions rule conductor_decide applies",
    );
    assert.deepEqual(readDecisions(bench.runDir), [], "NOTHING was appended to the §2.7 ledger");
    assert.equal(bench.store.loadItem(bench.runId, "I1").inlineClaim, null, "and the item carries no claim");
    assert.equal(
      inlineClaimScopeFor(bench.store, bench.runId, "I1"),
      null,
      "so the gate is offered no widened scope either",
    );
  });

  await test("an UNSCORED option is rejected the same way, and persists nothing", () => {
    const bench = buildBench();
    const unscored: InlineClaimInput = {
      store: bench.store,
      runId: bench.runId,
      journal: bench.journal.sink,
      now: () => START_MS,
      itemId: "I1",
      reason: CLAIM_MARKER,
      options: [scoredOptions()[0], { name: "dispatch an implementer sub-session" }],
      choice: "work it inline under a claim",
    };
    assert.throws(
      () => handleInlineClaim(unscored),
      /score/i,
      "§2.7: a derived decision needs a ladder-5 score on EVERY option",
    );
    assert.deepEqual(readDecisions(bench.runDir), [], "NOTHING was appended to the §2.7 ledger");
    assert.equal(bench.store.loadItem(bench.runId, "I1").inlineClaim, null, "and the item carries no claim");
  });
});

// ===========================================================================
// [9.5c-override-records]
// ===========================================================================

test("[9.5c-override-records] conductor_override records a §2.8 AnomalyRecord kind:'override' carrying {itemId, gate, reason, grantedAction}, appends the taint entry to the §2.5 item, and increments BOTH attempts.overridesUsed and run.counters.overridesUsed — every assertion read back off the PERSISTED anomaly ledger, item file and run.json, never off the handler's return", async () => {
  const bench = buildBench({ config: { maxOverridesPerItem: 2, maxOverridesPerRun: 2 } });
  const grants: OverrideGrants = new Map();

  assert.deepEqual(readAnomalies(bench.runDir), [], "premise: the §2.8 ledger starts empty");
  assert.equal(bench.store.loadItem(bench.runId, "I1").attempts.overridesUsed, 0, "premise: the item has used none");
  assert.equal(bench.store.loadRun(bench.runId).counters.overridesUsed, 0, "premise: the run has used none");

  const input: OverrideInput = {
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    now: () => START_MS,
    sessionID: "ses_impl",
    sessionRole: "implementer",
    itemId: "I1",
    gate: "edit",
    reason: OVERRIDE_MARKER,
    grantedAction: GRANTED_ACTION_MARKER,
    overrideGrants: grants,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    metrics: noMetrics,
  };
  const result: { granted: boolean } = await handleOverride(input);
  assert.equal(result.granted, true, "within budget, the override is granted");

  // (1) the §2.8 anomaly, on disk and schema-valid.
  const anomalies = readAnomalies(bench.runDir);
  assert.equal(anomalies.length, 1, "exactly ONE anomaly line was appended");
  const anomaly = anomalies[0];
  assert.equal(validate("AnomalyRecord", anomaly).ok, true, "the record satisfies the COMMITTED SCHEMAS.AnomalyRecord");
  assert.equal(anomaly.kind, "override", "§2.8: the anomaly kind is the committed `override` (never a new kind)");
  assert.equal(anomaly.kind === "override" ? anomaly.itemId : null, "I1", "it names the item");
  assert.equal(anomaly.kind === "override" ? anomaly.gate : null, "edit", "it names the gate that was overridden");
  assert.equal(anomaly.kind === "override" ? anomaly.reason : null, OVERRIDE_MARKER, "it carries the required reason verbatim");
  assert.equal(
    anomaly.kind === "override" ? anomaly.grantedAction : null,
    GRANTED_ACTION_MARKER,
    "and the ONE action it granted",
  );

  // (2) the §2.5 taint — permanent for the run and readable in the report.
  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(item.taint.length, 1, "exactly one taint entry was appended to the item");
  const taintText = JSON.stringify(item.taint[0]);
  assert.ok(taintText.includes(OVERRIDE_MARKER), "the taint carries the override's reason");
  assert.ok(taintText.includes("edit"), "and the gate it overrode");

  // (3) BOTH counters — the per-item and the per-run budget meters (§2.1).
  assert.equal(item.attempts.overridesUsed, 1, "the item's overridesUsed advanced");
  assert.equal(bench.store.loadRun(bench.runId).counters.overridesUsed, 1, "the RUN's overridesUsed advanced too");

  // (4) a granted override is not a stop: the run is still live and no report was written.
  assert.equal(bench.store.loadRun(bench.runId).stop, null, "a within-budget override records no stop");
  assert.equal(existsSync(bench.reportPath), false, "and writes no report");
  assert.equal(grants.size, 1, "the ONE-SHOT grant is live in the caller's grant map");
});

// ===========================================================================
// [9.5c-override-one-shot]
// ===========================================================================

test("[9.5c-override-one-shot] the grant is ONE-SHOT: the FIRST gate decision in that session consumes it (the otherwise-denied action is allowed) and the SECOND action in the same session is re-denied by the real gate — asserted by driving gateBeforeToolCall TWICE (never by inspecting handler internals), for BOTH the repeated action and a different one, and the grant is gone from the caller's map after the first consumption", async () => {
  const outOfScope = "src/other/generated-header.mjs";
  const alsoOutOfScope = "docs/i2.md";

  const build = async (): Promise<{ bench: Bench; grants: OverrideGrants }> => {
    const bench = buildBench({ config: { maxOverridesPerItem: 2, maxOverridesPerRun: 2 } });
    const grants: OverrideGrants = new Map();

    // Premise: WITHOUT a grant this exact edit is denied by the real gate (the implementer
    // is scoped to I1's fileScope), so the "allowed" below can only come from the grant.
    const denied = attemptEdit({
      bench,
      sessionID: "ses_impl",
      role: "implementer",
      itemId: "I1",
      editRel: outOfScope,
      fileScope: [...I1_FILE_SCOPE],
      testScope: [I1_TEST_REL],
      inlineClaimScope: null,
    });
    assert.equal(denied.allowed, false, "premise: the edit gate denies this path without any grant");

    const input: OverrideInput = {
      store: bench.store,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      now: () => START_MS,
      sessionID: "ses_impl",
      sessionRole: "implementer",
      itemId: "I1",
      gate: "edit",
      reason: OVERRIDE_MARKER,
      grantedAction: GRANTED_ACTION_MARKER,
      overrideGrants: grants,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      metrics: noMetrics,
    };
    const result: { granted: boolean } = await handleOverride(input);
    assert.equal(result.granted, true, "premise: the override was granted");
    return { bench, grants };
  };

  await test("the SAME action repeated: allowed once, then denied", async () => {
    const { bench, grants } = await build();

    const first = attemptEdit({
      bench,
      sessionID: "ses_impl",
      role: "implementer",
      itemId: "I1",
      editRel: outOfScope,
      fileScope: [...I1_FILE_SCOPE],
      testScope: [I1_TEST_REL],
      inlineClaimScope: null,
      overrideGrants: grants,
    });
    assert.equal(first.allowed, true, "the FIRST gate decision consumes the grant and allows the action");
    assert.equal(grants.size, 0, "the grant is CONSUMED — one shot, not a session-long amnesty");

    const second = attemptEdit({
      bench,
      sessionID: "ses_impl",
      role: "implementer",
      itemId: "I1",
      editRel: outOfScope,
      fileScope: [...I1_FILE_SCOPE],
      testScope: [I1_TEST_REL],
      inlineClaimScope: null,
      overrideGrants: grants,
    });
    assert.equal(second.allowed, false, "the SECOND action in the same session is re-denied by the real gate");
    assert.match(second.reason, /fileScope|scope/i, "and it is denied on the gate's own terms, not on a grant-specific excuse");
  });

  await test("a DIFFERENT action after the consumption is denied too", async () => {
    const { bench, grants } = await build();

    const first = attemptEdit({
      bench,
      sessionID: "ses_impl",
      role: "implementer",
      itemId: "I1",
      editRel: outOfScope,
      fileScope: [...I1_FILE_SCOPE],
      testScope: [I1_TEST_REL],
      inlineClaimScope: null,
      overrideGrants: grants,
    });
    assert.equal(first.allowed, true, "premise: the first action consumed the grant");

    const different = attemptEdit({
      bench,
      sessionID: "ses_impl",
      role: "implementer",
      itemId: "I1",
      editRel: alsoOutOfScope,
      fileScope: [...I1_FILE_SCOPE],
      testScope: [I1_TEST_REL],
      inlineClaimScope: null,
      overrideGrants: grants,
    });
    assert.equal(different.allowed, false, "a DIFFERENT out-of-scope action is denied normally — the grant covered exactly one");
  });

  await test("an UNRELATED session never sees the grant at all", async () => {
    const { bench, grants } = await build();

    const other = attemptEdit({
      bench,
      sessionID: "ses_other_impl",
      role: "implementer",
      itemId: "I1",
      editRel: outOfScope,
      fileScope: [...I1_FILE_SCOPE],
      testScope: [I1_TEST_REL],
      inlineClaimScope: null,
      overrideGrants: grants,
    });
    assert.equal(other.allowed, false, "the grant is keyed to the session that asked for it (§3.6: the SAME session)");
    assert.equal(grants.size, 1, "and a foreign session cannot consume it either");
  });
});

// ===========================================================================
// [9.5c-override-item-budget]
// ===========================================================================

test("[9.5c-override-item-budget] exceeding config.workflow.maxOverridesPerItem GRANTS NOTHING: it records an `env` stop PLUS a stop-report, the refused attempt leaves the item's taint and attempts.overridesUsed exactly as they were, no grant is written, and the real gate still denies the action — with the RUN budget deliberately slack, so a handler honouring only the run budget fails here", async () => {
  const bench = buildBench({
    config: { maxOverridesPerItem: 1, maxOverridesPerRun: 5 },
    itemOverridesUsed: 1,
    runOverridesUsed: 1,
  });
  const grants: OverrideGrants = new Map();
  const outOfScope = "src/other/generated-header.mjs";

  // Premise: the ITEM budget is spent; the RUN budget is not.
  assert.equal(bench.store.loadItem(bench.runId, "I1").attempts.overridesUsed, 1, "premise: the item has used its one override");
  assert.equal(bench.store.loadRun(bench.runId).counters.overridesUsed, 1, "premise: the run is well under its cap of 5");
  assert.equal(bench.store.loadRun(bench.runId).stop, null, "premise: no stop is recorded yet");
  const taintBefore = JSON.stringify(bench.store.loadItem(bench.runId, "I1").taint);

  const input: OverrideInput = {
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    now: () => START_MS,
    sessionID: "ses_impl",
    sessionRole: "implementer",
    itemId: "I1",
    gate: "edit",
    reason: OVERRIDE_MARKER,
    grantedAction: GRANTED_ACTION_MARKER,
    overrideGrants: grants,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    metrics: noMetrics,
  };
  const result: { granted: boolean } = await handleOverride(input);

  // (1) nothing was granted.
  assert.equal(result.granted, false, "§3.6: over budget is an `env` stop, not another override");
  assert.equal(grants.size, 0, "no grant was written into the caller's map");

  // (2) the §2.9 `env` stop, from the CLOSED vocabulary, is on run.json.
  const run = bench.store.loadRun(bench.runId);
  assert.notEqual(run.stop, null, "a stop was recorded");
  assert.equal(run.stop?.kind, "env", "and its kind is `env`");
  assert.ok(STOP_KINDS.includes(run.stop?.kind ?? "done"), "which is a member of the closed §2.9 vocabulary");
  assert.match(
    run.stop?.reasonDisplay ?? "",
    /override|budget/i,
    "the reason says the override budget is what stopped the run",
  );

  // (3) the stop-report was written by the SAME writer (§2.9's normative rule).
  const markdown = readReport(bench);
  assert.match(firstHeading(markdown), /env/i, "the stop-report's headline names the `env` stop");
  assert.ok(markdown.includes("I1"), "and the artifact still carries the per-item dispositions");
  assert.equal(existsSync(bench.sentinelPath), false, "the stop-report ran no closing verify here either");

  // (4) P6: the refused attempt changed NOTHING else.
  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(item.attempts.overridesUsed, 1, "the refused attempt did not consume an override");
  assert.equal(JSON.stringify(item.taint), taintBefore, "and left the item's taint untouched");
  assert.equal(run.counters.overridesUsed, 1, "the run counter is unchanged too");

  // (5) the gate still denies — the whole point of refusing the grant.
  const attempt = attemptEdit({
    bench,
    sessionID: "ses_impl",
    role: "implementer",
    itemId: "I1",
    editRel: outOfScope,
    fileScope: [...I1_FILE_SCOPE],
    testScope: [I1_TEST_REL],
    inlineClaimScope: null,
    overrideGrants: grants,
  });
  assert.equal(attempt.allowed, false, "the action the override asked for is still denied");
});

// ===========================================================================
// [9.5c-override-run-budget]
// ===========================================================================

test("[9.5c-override-run-budget] exceeding config.workflow.maxOverridesPerRun does exactly the same — a SEPARATE test from the per-item budget, with the ITEM budget deliberately slack (the item has used none), so a handler honouring only maxOverridesPerItem grants here and fails this row", async () => {
  const bench = buildBench({
    config: { maxOverridesPerItem: 5, maxOverridesPerRun: 1 },
    itemOverridesUsed: 0,
    runOverridesUsed: 1,
  });
  const grants: OverrideGrants = new Map();
  const outOfScope = "src/other/generated-header.mjs";

  // Premise: the RUN budget is spent; this ITEM has used nothing at all.
  assert.equal(bench.store.loadItem(bench.runId, "I1").attempts.overridesUsed, 0, "premise: THIS item has used no override");
  assert.equal(bench.store.loadRun(bench.runId).counters.overridesUsed, 1, "premise: the RUN has used its one override");
  assert.equal(bench.store.loadRun(bench.runId).stop, null, "premise: no stop is recorded yet");

  const input: OverrideInput = {
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    now: () => START_MS,
    sessionID: "ses_impl",
    sessionRole: "implementer",
    itemId: "I1",
    gate: "edit",
    reason: OVERRIDE_MARKER,
    grantedAction: GRANTED_ACTION_MARKER,
    overrideGrants: grants,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    metrics: noMetrics,
  };
  const result: { granted: boolean } = await handleOverride(input);

  assert.equal(result.granted, false, "the per-RUN budget refuses the grant even though this item has used none");
  assert.equal(grants.size, 0, "no grant was written into the caller's map");

  const run = bench.store.loadRun(bench.runId);
  assert.equal(run.stop?.kind, "env", "the per-run exhaustion records the same §2.9 `env` stop");
  assert.match(run.stop?.reasonDisplay ?? "", /override|budget/i, "naming the budget that stopped the run");

  const markdown = readReport(bench);
  assert.match(firstHeading(markdown), /env/i, "and the stop-report is written for this budget too");
  assert.ok(markdown.includes(BLOCK_MARKER), "carrying the per-item dispositions, as every stop-report does");
  assert.equal(existsSync(bench.sentinelPath), false, "with no closing verify");

  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(item.attempts.overridesUsed, 0, "the refused attempt consumed nothing from the item's budget");
  assert.equal(item.taint.length, 0, "and tainted nothing (P6: a refused override is not an override that happened)");
  assert.equal(run.counters.overridesUsed, 1, "the run counter is unchanged");

  const attempt = attemptEdit({
    bench,
    sessionID: "ses_impl",
    role: "implementer",
    itemId: "I1",
    editRel: outOfScope,
    fileScope: [...I1_FILE_SCOPE],
    testScope: [I1_TEST_REL],
    inlineClaimScope: null,
    overrideGrants: grants,
  });
  assert.equal(attempt.allowed, false, "and the gate still denies the action");
});
