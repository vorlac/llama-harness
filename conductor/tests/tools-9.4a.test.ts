// Task 9.4a RED tests — FINAL LOCATION conductor/tests/tools-9.4a.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the TWO Phase-9 RED-stage handlers added
// to the EXISTING conductor/adapter/tools.ts (which today carries the §5.3 gate wiring
// plus the Task-9.1/9.2/9.3 handlers). The red is the missing-export shape — tools.ts
// resolves, but the two named bindings below do not yet exist:
//   handleSubmitTest   (conductor_submit_test, PENDING→RED, behavioral items only)
//   handleVetTest      (conductor_vet_test,    RED→TEST_VETTED)
// Every OTHER import in this file resolves to a committed export today; the ONE
// intentional exception beyond the two handlers is BEHAVIOURAL, not structural:
// [9.4a-deps-ready-binding] asserts new behaviour from the already-exported
// core/gates-phase.ts legalTools (the 9.4a/5.3 deferred binding), so that row goes red
// as an ASSERTION failure, not an unresolved import.
//
// Both handlers follow the §3.4 invariant loop — legality → derive → persist → journal →
// compact return — and (with the state store they delegate to) are the only writers of
// item state (G6). Sub-session traffic goes through the injected Fanout (adapter/fanout.ts)
// over the FAKE SDK (tests/fixtures/fake-sdk.ts); the item test is run ONLY through
// adapter/evidence.ts runTest, against REAL on-disk fixture repos and REAL child
// `node --test` processes — never a stubbed classifier.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.4a (2612-2623)  — the authoritative behaviour of the two tools.
//   §3.3 (1184-1210)          — PENDING→RED: the test-writer sub-session (role
//                               `testWriter`, doctrine tdd.md) writes ONLY test files;
//                               THE HANDLER — not the model — runs the test via
//                               evidence.ts and requires exit≠0 with failureClass ∈
//                               {"assertion","missing-subject"}; class "error" is NOT
//                               red and is returned to the writer for repair, bounded at
//                               testRepairAttempts, then blocked:{stage:"RED",reason} +
//                               a question; a test that PASSES immediately is rejected
//                               (behaviour already exists → a recorded decision, ponytail
//                               rung "skip" — or the test is wrong).
//                               RED→TEST_VETTED: vetCritics parallel critics (role
//                               `reviewer`, doctrine test-vet.md), FRESH contexts, given
//                               the item spec + the test + the captured red output and
//                               NOT the implementation; mustFix → back to the writer,
//                               re-vet, bounded by vetMaxRounds.
//   §2.6/§2.6.1 (797-843)     — the evidence records and the closed failure-class split.
//   §2.10 (958-965)           — SCHEMAS.TestVet (already registered).
//   §2.11 (984-993)           — the question record; QUESTION_ORIGINS is CLOSED.
//   §2.7 (852-875)            — the decision record.
//   §2.1 (568-572)            — vetCritics / vetMaxRounds / testRepairAttempts.
//   docs/build/specs/task-9.4a.assertions.json — the 11 rows mapped to the 11 tests
//                               below, its `reusesExisting` list, and its spec-gap
//                               resolutions as APPROVED in `orchestratorReview`.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.4a.assertions.json, approved verbatim by the
// orchestrator; this file is the contract that pins them):
//  (G1) The question written when testRepairAttempts is exhausted uses the EXISTING
//       §2.11 origin "implementer-blocked" — the blocked write-capable sub-session here
//       IS the test-writer. The origin vocabulary is CLOSED; nothing here widens it.
//  (G2) The question written at the vet round cap uses the EXISTING origin
//       "review-round-cap"; at the cap the item STAYS at RED and carries
//       blocked:{stage:"TEST_VETTED", reason naming vetMaxRounds, questionId}.
//  (G3) An immediately-passing test leaves the item PENDING and UN-blocked, writes NO
//       question, and appends ONE §2.7 kind:"derived" record with the two REAL scored
//       options ("behavior-already-exists" / ponytail rung skip vs "test-is-wrong"),
//       choice "test-is-wrong" as the conservative default. ≥2 scored options keeps it
//       consistent with core/decide.ts requireTwoOptions (reused, never reimplemented).
//  (G4) Every testWriter dispatch uses the already-registered SCHEMAS.ImplementerResult.
//       9.4a authors NO schema.
//  (G5) handleSubmitTest owns the WHOLE PENDING→RED stage: the initial testWriter
//       dispatch (role "testWriter", writeCapable:true, tree "main" until 9.6), then the
//       handler-run test, then the bounded repair loop.
//  (G6) After every mustFix repair handleVetTest re-runs the item test through
//       evidence.runTest and requires a still-legal §2.6.1 red BEFORE re-vetting, so each
//       vet round's prompt carries a TRUE captured red for the test it is judging.
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) `config.workflow.testRepairAttempts` bounds REPAIRS, not total dispatches. The
//       initial write is not a repair, so one conductor_submit_test call makes at most
//       1 + testRepairAttempts testWriter dispatches. Authority: §3.3 "the handler returns
//       the failure to the writer FOR REPAIR, bounded at `testRepairAttempts`, then sets
//       `blocked`", and the §2.1 config comment at plan line 572 —
//       `"testRepairAttempts": 3,  // submit_test: illegal-red repair attempts`. Both make
//       the REPAIRS the bounded quantity. (A knob named "repair attempts" that silently
//       bounded total attempts would be exactly the conflation an earlier review caught in
//       the item-size budget, so the two loop tests below pin the boundary EXACTLY and at
//       two DIFFERENT budgets — a hardcoded repair count cannot satisfy both.)
//  (P2) `item.attempts.testRepairs` counts the REPAIRS actually spent — the initial writer
//       dispatch is not a repair — so it is (writer dispatches − 1) for one call, and it
//       equals testRepairAttempts exactly when the budget was fully spent.
//  (P3) `item.attempts.vetRounds` counts vet ROUNDS run by one conductor_vet_test call.
//  (P4) An immediately-passing test EXITS the stage at once: it is a rejection, not a
//       repairable illegal red, so it burns exactly ONE writer dispatch whatever
//       testRepairAttempts allows.
//  (P5) A legal red records the pointer to its own §2.6 ledger line on the item:
//       item.evidence.red.seq is the appended red record's seq and .ledger names
//       evidence.jsonl. (The seq pointer is pinned; the exact path spelling is not.)
//  (P6) A clean FIRST vet round re-runs NOTHING: evidence.jsonl is untouched unless a
//       mustFix repair happened (the corollary of G6).
//  (P7) Both handlers DENY by THROWING — the Task-9.1/9.2/9.3 convention in this file
//       (handleDecide/handleDefer/handleDecompose all throw on a legality refusal), and
//       a throw before any persist is what makes "nothing was written" checkable.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). ONE options
// object each; runDir is derived as <store.root>/.conductor/runs/<runId>/; the fixture
// repo IS <store.root> (the item test's cwd). `journal` is the leveled sink
// (adapter/journal.ts Journal-compatible); `now` defaults to Date.now.
//
//   // conductor_submit_test (§3.3 PENDING→RED). Legality (core/gates-phase.ts): the run
//   // must be EXECUTING, the item must exist, be PENDING, un-blocked/un-deferred,
//   // behavioral:true (a behavioral:false item is REFUSED naming conductor_mark_green),
//   // and dependency-ready (every dependsOn PUBLISHED — the 9.4a/5.3 binding). Then:
//   // dispatch the test-writer (role "testWriter", writeCapable:true, tree "main",
//   // schema "ImplementerResult"), run the item test via evidence.runTest, and admit the
//   // red through core legalItemTransition (never re-classifying, never re-implementing
//   // edge legality). exit 0 ⇒ reject + the §2.7 ponytail-skip fork; class "error" ⇒
//   // re-dispatch the writer with the captured failure, up to testRepairAttempts REPAIRS
//   // (so at most 1 + testRepairAttempts writer dispatches in all), then store.setBlocked
//   // + ONE questions.appendQuestion.
//   handleSubmitTest(input: {
//     store: StateStore; fanout: Fanout; runId: string; itemId: string; config: Config;
//     journal: JournalSink; now?: () => number;
//   }): Promise<{
//     ok: boolean;                      // true IFF the item advanced PENDING→RED
//     itemState: ItemState;             // the PERSISTED state after the call
//     exitCode: number | null;          // the last handler-run test's exit code
//     failureClass: FailureClass | null;// the last red's §2.6.1 class (null on a green)
//     excerpt: string | null;           // the appended record's bounded failureExcerpt
//     attempts: number;                 // TOTAL testWriter dispatches consumed
//                                       // (≤ 1 + testRepairAttempts; see P1)
//     questionId: string | null;        // the §2.11 question minted at repair exhaustion
//     decisionId: string | null;        // the §2.7 record minted on an immediate pass
//     fork: string | null;              // names the immediate-pass fork for the orchestrator
//   }>
//
//   // conductor_vet_test (§3.3 RED→TEST_VETTED). Legality as above with state RED. Then:
//   // readFanout("vet", config) critics as ONE parallel group via fanout.dispatchWave
//   // (role "reviewer", writeCapable:false, schema "TestVet", one fresh sub-session
//   // each), every prompt carrying the item spec + the test content + the captured red
//   // and NOT the implementation; any non-empty mustFix ⇒ ONE write-capable testWriter
//   // re-dispatch carrying the UNION, a re-run through evidence.runTest that must still
//   // be a legal §2.6.1 red, then a re-vet; bounded by vetMaxRounds, at which point the
//   // item stays RED with store.setBlocked + ONE questions.appendQuestion.
//   handleVetTest(input: {
//     store: StateStore; fanout: Fanout; runId: string; itemId: string; config: Config;
//     journal: JournalSink; now?: () => number;
//   }): Promise<{
//     ok: boolean;                      // true IFF the item advanced RED→TEST_VETTED
//     itemState: ItemState;             // the PERSISTED state after the call
//     rounds: number;                   // vet rounds run (== item.attempts.vetRounds)
//     verdicts: Array<{ criterion: string; passed: number; failed: number }>;
//                                       // the FINAL round's per-criterion tally, one row
//                                       // per §2.10 TestVet criterion, in schema order
//     mustFix: string[];                // the final round's UNION ([] on a clean exit)
//     questionId: string | null;        // the §2.11 question minted at the round cap
//   }>
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id):
//   9.4a-submit-legal-red            → writer dispatch + handler-run test; exit≠0 class
//                                      "assertion" advances PENDING→RED; §2.6 record lands.
//   9.4a-submit-missing-subject      → greenfield: a REAL missing module inside fileScope
//                                      classifies missing-subject and is a legal red.
//   9.4a-submit-error-repair-loop    → class "error" is rejected and returned to the writer
//                                      with the captured failure; the handler spends its
//                                      FULL repair budget (testRepairAttempts 2 ⇒ 3
//                                      dispatches) and the last repair reaches RED.
//   9.4a-submit-repair-exhausted-blocks → the repair budget is spent and NOT exceeded
//                                      (testRepairAttempts 1 ⇒ 2 dispatches) ⇒
//                                      blocked{stage:"RED"} + ONE question
//                                      (origin "implementer-blocked").
//   9.4a-submit-pass-rejected        → exit 0 is refused; the §2.7 ponytail-skip fork is
//                                      recorded; the item stays PENDING and un-blocked.
//   9.4a-submit-nonbehavioral-illegal→ behavioral:false is ILLEGAL before any dispatch.
//   9.4a-deps-ready-binding          → gate AND handler both refuse a dependency-unready
//                                      item, over the SAME fixture (9.4a/5.3, ENFORCE).
//   9.4a-vet-fanout-composition      → readFanout("vet") fresh reviewer critics in ONE
//                                      parallel group; spec+test+red in, implementation OUT.
//   9.4a-vet-mustfix-loop            → mustFix union → one writer re-dispatch → re-run to a
//                                      fresh legal red → re-vet → TEST_VETTED in 2 rounds.
//   9.4a-vet-pass-advances           → a clean round advances RED→TEST_VETTED through the
//                                      REAL throwing journal (no vocabulary widening).
//   9.4a-vet-cap-blocks              → vetMaxRounds reached ⇒ RED + blocked{stage:
//                                      "TEST_VETTED"} + ONE question ("review-round-cap").

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The SUBJECTS — absent at red time (missing-export red from the existing tools.ts).
import { handleSubmitTest, handleVetTest } from "../adapter/tools.ts";

// Adapters + core that DO exist (Tasks 1.2 / 1.3 / 2.1 / 3.2 / 3.3 / 4.1 / 6.1 / 7.1).
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun } from "../core/gates-phase.ts";
import { readFanout } from "../core/schedule.ts";
import { requireTwoOptions } from "../core/decide.ts";
import { validate } from "../core/types.ts";
import type {
  Config,
  DecisionRecord,
  EvidenceRecord,
  FailureClass,
  Item,
  ItemState,
  LogLevel,
  Queue,
  QueueItem,
  QuestionRecord,
  TreePath,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// The pinned compact-return shapes (the header's contract, restated structurally so the
// call sites type-check the green implementation against it).
interface SubmitTestResult {
  ok: boolean;
  itemState: ItemState;
  exitCode: number | null;
  failureClass: FailureClass | null;
  excerpt: string | null;
  attempts: number;
  questionId: string | null;
  decisionId: string | null;
  fork: string | null;
}

interface VetCriterionTally {
  criterion: string;
  passed: number;
  failed: number;
}

interface VetTestResult {
  ok: boolean;
  itemState: ItemState;
  rounds: number;
  verdicts: VetCriterionTally[];
  mustFix: string[];
  questionId: string | null;
}

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a
// prompt DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const IMPL_MARKER = "IMPLEMENTATION-MARKER-3355";
const TITLE_MARKER = "ITEM-TITLE-MARKER-7712";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-5190";
const RED_MARKER = "SEEDED-RED-MARKER-6612";
const TEST_V1_MARKER = "TESTFILE-MARKER-V1-4417";
const TEST_V2_MARKER = "TESTFILE-MARKER-V2-8823";
const BROKEN_TOKEN = "BROKEN_TEST_MARKER_9942";
const FALLBACK_TRIPWIRE = "FULL_SCOPE_FALLBACK_RAN_9001";
const MUSTFIX_A = "MUSTFIX-ALPHA-2201: assert the returned value, not the internal call count";
const MUSTFIX_B = "MUSTFIX-BRAVO-3308: pin the acceptance criterion, not an implementation detail";

// The five §2.10 TEST_VET criteria, in schema order (core/types.ts TestVet).
const VET_CRITERIA = [
  "observableBehavior",
  "wouldCatchWrongImpl",
  "rightLevel",
  "pinsAcceptance",
  "antiPatterns",
] as const;

// The fixture repo's production module. Its marker is what the vet critics must NEVER
// see: "critics can't be anchored by code that already passes".
const PROD_PARSER =
  `// ${IMPL_MARKER}\n` +
  "export function parse(text) {\n" +
  "  return Math.abs(Number(text));\n" +
  "}\n";

// A test that RUNS and fails its assertion → §2.6.1 class "assertion" (verified against
// real node --test: `AssertionError [ERR_ASSERTION]` in the captured output).
function assertionTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/parser.mjs";\n' +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7, "sign");\n' +
    "});\n"
  );
}

// A GREENFIELD test importing a module that does not exist yet. With the item's
// fileScope covering it, core.classifyFailure returns "missing-subject" (verified
// against real node --test: `ERR_MODULE_NOT_FOUND: Cannot find module 'src/…'`).
function missingSubjectTest(marker: string, moduleRel: string, symbol: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    `import { ${symbol} } from "${moduleRel}";\n` +
    'test("t", () => {\n' +
    `  ${symbol}("-9");\n` +
    "});\n"
  );
}

// A test that is itself BROKEN — a syntax error, matching no unresolved-specifier and no
// assertion pattern → §2.6.1 class "error", which is NOT a red (verified against real
// node --test: `SyntaxError: Unexpected token ';'`).
function brokenTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    `const ${BROKEN_TOKEN} = ;\n` +
    'test("t", () => {});\n'
  );
}

// A test that PASSES immediately (exit 0) — never a red.
function passingTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/parser.mjs";\n' +
    'test("t", () => {\n' +
    '  assert.equal(parse("7"), 7);\n' +
    "});\n"
  );
}

// ---------------------------------------------------------------------------
// Fixtures + helpers (the tools-9.1/9.2/9.3 harness shape).
// ---------------------------------------------------------------------------

// A fixed injected clock: every stamped value the handlers mint reads it.
const START_MS = 1_754_560_000_000;

// A leveled sink structurally compatible with adapter/journal.ts Journal — captures every
// record for the journal assertions. Deliberately loose (level:string, runId optional) so
// it assigns to both the StateJournal and the Journal parameter shapes.
interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}
interface JournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
  flushSync: () => void;
}
function makeJournal(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

// A TEE onto the REAL adapter/journal.ts journal: it captures in memory AND forwards to
// the real sink, which THROWS on any event outside the closed §7.4 vocabulary
// (core/journal-events.ts EVENTS). Used by [9.4a-vet-pass-advances] so a handler that
// invented an event name fails loudly instead of quietly widening the vocabulary.
function makeRealJournal(
  runDir: string,
  config: Config,
): { sink: JournalSink; records: CaptureRecord[]; real: Journal } {
  const real: Journal = createJournal(runDir, config, {});
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
      real.log(level as LogLevel, component, event, data, {
        runId: corr.runId ?? "",
        ...(corr.itemId !== undefined ? { itemId: corr.itemId } : {}),
        ...(corr.sessionID !== undefined ? { sessionID: corr.sessionID } : {}),
      });
    },
    flushSync(): void {
      real.flushSync();
    },
  };
  return { sink, records, real };
}

// A §3.5 tree view that RECORDS every admission check. The fan-out engine consults
// isFrozen ONLY for a write-capable job (`entry.job.writeCapable && treeState.isFrozen(…)`
// short-circuits), so this list is the observable witness of which dispatches were
// write-capable and which tree they claimed — the only way writeCapable/tree reach the
// outside world. Never frozen, so nothing is ever held.
function makeRecordingTree(): { tree: TreeState; frozenChecks: string[] } {
  const frozenChecks: string[] = [];
  const tree: TreeState = {
    isFrozen(name: string): boolean {
      frozenChecks.push(name);
      return false;
    },
    onClear(): () => void {
      return () => undefined;
    },
  };
  return { tree, frozenChecks };
}

// A complete §2.1 Config. The single verify scope "unit" is selected by ANY reasonable
// scope-selection rule (it is the only scope, and its requiredScopes pattern "**" matches
// every path), so these tests never pin an unspecified selection rule. Its itemTest
// template is the §2.1 targeted run; its full-scope `command` is a TRIPWIRE that fails
// while naming no testScope file — if a handler ever falls back to it, the red is illegal
// and the tripwire token appears in the excerpt.
function makeConfig(
  opts: {
    vetCritics?: number;
    vetMaxRounds?: number;
    testRepairAttempts?: number;
    maxReaders?: number;
    modelDefault?: string;
  } = {},
): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        unit: {
          command: [
            process.execPath,
            "-e",
            `process.stderr.write(${JSON.stringify(FALLBACK_TRIPWIRE + "\n")}); process.exit(1);`,
          ],
          timeoutMs: 120_000,
          itemTest: [process.execPath, "--test", "{files}"],
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: opts.vetCritics ?? 2,
      vetMaxRounds: opts.vetMaxRounds ?? 2,
      testRepairAttempts: opts.testRepairAttempts ?? 2,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: {
      writes: "off",
      maxImplementers: 4,
      maxReaders: opts.maxReaders ?? 2,
      subSessionTimeoutMs: 120_000,
    },
    models: { default: opts.modelDefault ?? "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// Temp-dir bookkeeping: each test creates its own workspace and removes it in its own
// finally; this after() is the backstop that guarantees nothing survives the run.
const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// The fixture repo IS the workspace root: <root>/src holds the production module,
// <root>/tests is where the (simulated) test-writer lands its file, and the store puts
// .conductor/ alongside them. Real files, real child processes — never this repo.
function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools94a-"));
  tmpDirs.push(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "parser.mjs"), PROD_PARSER);
  return dir;
}

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
    classification: { kind: "work", rationale: "the prompt asks for a behavioural change", check: { agreed: true, note: "" } },
  });
  return run.runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

// A schema-valid §2.5 runtime Item at the requested FSM position.
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

// A schema-valid §2.4 queue item. The title/acceptance carry markers so "the prompt
// carries the item spec" is checkable.
function makeQueueItem(
  id: string,
  over: {
    fileScope: string[];
    testScope: string[];
    behavioral?: boolean;
    dependsOn?: string[];
  },
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

// Drive a run to EXECUTING WITHOUT calling any other task's handler (direct on-disk
// seeding, the tools-9.2/9.3 discipline): flip run.state, write a valid queue.json, and
// seed one runtime item per queue item at the requested FSM position.
function seedExecuting(
  store: StateStore,
  runId: string,
  queue: Queue,
  states: Record<string, ItemState> = {},
): void {
  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const qi of queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, states[qi.id] ?? "PENDING"));
  }
}

// The §2.6 red record a RED-seeded item already owns — hand-written directly to the
// ledger (seeding on disk, never through another task's handler). Its excerpt carries
// RED_MARKER, so "the vet prompt carried THIS red" and "round 2 no longer carries the
// STALE red" are both one-token checks.
function seedRedEvidence(runDir: string, itemId: string): EvidenceRecord {
  const record: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", "tests/p.test.mjs"],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER}\n\n7 !== -7`,
    failureClass: "assertion",
    targeted: true,
  };
  writeFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  return record;
}

type RedRecord = Extract<EvidenceRecord, { kind: "red" }>;

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function asRed(record: EvidenceRecord, ctx: string): RedRecord {
  assert.equal(record.kind, "red", `${ctx}: the evidence record is a §2.6 red`);
  return record as RedRecord;
}

function readDecisions(runDir: string): DecisionRecord[] {
  const file = path.join(runDir, "decisions.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DecisionRecord);
}

function itemFileBytes(runDir: string, itemId: string): string {
  return readFileSync(path.join(runDir, "items", `${itemId}.json`), "utf8");
}

// The §2.10 IMPLEMENTER RESULT receipt every testWriter dispatch replies with (G4).
function implJson(status = "DONE", summary = "wrote the item test"): string {
  return JSON.stringify({ status, summary, concerns: [], neededContext: null, blockReason: null });
}

// The §2.10 TEST_VET receipt. An empty mustFix is a clean verdict (all five criteria
// pass); a non-empty one fails the criterion that motivated it.
function vetJson(mustFix: string[]): string {
  const clean = mustFix.length === 0;
  const verdict = (note: string): { pass: boolean; note: string } => ({ pass: clean, note });
  return JSON.stringify({
    verdictsByCriterion: {
      observableBehavior: verdict("asserts the returned value"),
      wouldCatchWrongImpl: verdict("a sign-dropping implementation still fails it"),
      rightLevel: verdict("unit level is right for a pure function"),
      pinsAcceptance: verdict("pins this item's acceptance criterion"),
      antiPatterns: verdict("no mock-testing, no tautology"),
    },
    mustFix: [...mustFix],
  });
}

// Build a Fanout over the fake SDK with a PER-ROLE reply script: each NEW sub-session of a
// role is assigned the next canned reply for THAT role (in first-prompt order), clamping
// to the last so a bad-forever stream drives the cap paths; retries within a session
// re-serve the same reply (all replies here are schema-valid, so the engine never retries
// — one prompt per sub-session, which is what the count pins read, AND which is itself the
// witness that the handler named the RIGHT schema: a wrong schemaName would reject these
// receipts, retry twice and env-fail). A reply may be a FUNCTION of the prompt text, which
// is how the test-writer's file edits are simulated — the responder writes the fixture
// repo exactly as a real write-capable sub-session would. An UNSCRIPTED role replies with
// unparseable text so a stray dispatch env-fails loudly instead of silently succeeding.
type CannedReply = string | ((promptText: string) => string);
interface RoleScript {
  testWriter: CannedReply[];
  reviewer: CannedReply[];
}
interface PromptedRecord {
  role: string;
  itemId: string;
  tree: string;
  text: string;
  sessionID: string;
}
interface Wiring {
  fanout: Fanout;
  sdk: ReturnType<typeof makeFakeSdk>;
  prompted: PromptedRecord[];
  frozenChecks: string[];
  byRole: (role: string) => PromptedRecord[];
}
function makeWiring(runId: string, config: Config, journal: JournalSink, script: RoleScript): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    prompted.push({
      role,
      itemId: req.entry?.itemId ?? "",
      tree: req.entry?.tree ?? "",
      text: req.text,
      sessionID: req.sessionID,
    });
    const queue = role === "testWriter" ? script.testWriter : role === "reviewer" ? script.reviewer : [];
    if (queue.length === 0) return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    let idx = sessionIdx.get(req.sessionID);
    if (idx === undefined) {
      idx = nextByRole.get(role) ?? 0;
      nextByRole.set(role, idx + 1);
      sessionIdx.set(req.sessionID, idx);
    }
    const canned = queue[Math.min(idx, queue.length - 1)];
    const text = typeof canned === "function" ? canned(req.text) : canned;
    return { kind: "reply", text };
  });
  const recording = makeRecordingTree();
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    recording.tree,
    runId,
  );
  return {
    fanout,
    sdk,
    prompted,
    frozenChecks: recording.frozenChecks,
    byRole: (role: string) => prompted.filter((p) => p.role === role),
  };
}

// A test-writer responder that WRITES `content` at `rel` inside the repo and replies with
// the §2.10 receipt — the fixture stand-in for a real write-capable sub-session's edit.
function writerWrites(repo: string, rel: string, content: string): CannedReply {
  return (): string => {
    const target = path.join(repo, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return implJson();
  };
}

function tallyFor(verdicts: VetCriterionTally[], criterion: string): VetCriterionTally {
  const rows = verdicts.filter((v) => v.criterion === criterion);
  assert.equal(rows.length, 1, `the compact return carries exactly one tally row for "${criterion}"`);
  return rows[0];
}

// The gate's view of the SAME persisted fixture — built from queue.json's structural facts
// plus the runtime item files, so [9.4a-deps-ready-binding] asks the pure gate and the
// handler about one and the same state.
function gateItemsOf(store: StateStore, runId: string, queue: Queue): GateItem[] {
  return queue.items.map((qi) => {
    const item = store.loadItem(runId, qi.id);
    return {
      id: qi.id,
      state: item.state,
      behavioral: qi.behavioral,
      dependsOn: [...qi.dependsOn],
      fileScope: [...qi.fileScope],
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
    };
  });
}

const EXECUTING_RUN: GateRun = { state: "EXECUTING", stop: null, classification: { kind: "work" }, classified: true };

// ---------------------------------------------------------------------------
// Fixture sanity: every canned payload must satisfy the schema the fan-out engine
// validates it against (or a red would be a fixture bug, not a handler bug), the seeded
// ledger line must be a real §2.6 record, and the fan-out sizing premises must hold.
// (Same discipline as 9.1/9.2/9.3's probe blocks.)
// ---------------------------------------------------------------------------
assert.equal(
  validate("ImplementerResult", JSON.parse(implJson()) as unknown).ok,
  true,
  "sanity: the test-writer receipt satisfies SCHEMAS.ImplementerResult (the pinned G4 resolution)",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson([])) as unknown).ok,
  true,
  "sanity: a clean critic receipt satisfies SCHEMAS.TestVet",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson([MUSTFIX_A])) as unknown).ok,
  true,
  "sanity: a mustFix critic receipt satisfies SCHEMAS.TestVet",
);
assert.equal(
  validate("Queue", { items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })] }).ok,
  true,
  "sanity: the queue fixture satisfies SCHEMAS.Queue",
);
assert.equal(
  validate("Item", makeRuntimeItem("I1", "PENDING")).ok,
  true,
  "sanity: the runtime item fixture satisfies SCHEMAS.Item",
);
// The vet fan-out sizing premise: vetCritics 3 clamped by parallel.maxReaders 2 => 2.
assert.equal(
  readFanout("vet", makeConfig({ vetCritics: 3, maxReaders: 2 })),
  2,
  "sanity: readFanout('vet', config) clamps vetCritics to parallel.maxReaders",
);
assert.equal(
  readFanout("vet", makeConfig({ vetCritics: 2, maxReaders: 2 })),
  2,
  "sanity: an unclamped vetCritics is the critic count",
);
// The implementation marker really IS in the production file, so its ABSENCE from the
// critics' prompts is a meaningful claim rather than a vacuous one.
assert.ok(PROD_PARSER.includes(IMPL_MARKER), "sanity: the production module carries the implementation marker");
assert.ok(!assertionTest(TEST_V1_MARKER).includes(IMPL_MARKER), "sanity: the test file does NOT carry the implementation marker");

// ===========================================================================
// [9.4a-submit-legal-red]
// ===========================================================================

test("[9.4a-submit-legal-red] handleSubmitTest dispatches the test-writer, THE HANDLER runs the item test, and an exit≠0 'assertion' failure advances PENDING→RED with the §2.6 red record on evidence.jsonl", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ testRepairAttempts: 3 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
    };
    seedExecuting(store, runId, queue);

    // The writer's ONE dispatch writes a test that RUNS and fails its assertion. The
    // reviewer script is empty, so a stray critic dispatch env-fails loudly.
    const wiring = makeWiring(runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/p.test.mjs", assertionTest(TEST_V1_MARKER))],
      reviewer: [],
    });

    const res: SubmitTestResult = await handleSubmitTest({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    // ONE test-writer sub-session, FRESH, prompted exactly once (one prompt per session
    // is also the witness that the handler named a schema these receipts satisfy — a
    // wrong schemaName would drive the engine's re-prompt retries).
    const writers = wiring.byRole("testWriter");
    assert.equal(writers.length, 1, "exactly ONE test-writer dispatch for a first-try legal red");
    assert.equal(wiring.prompted.length, 1, "no other role was dispatched");
    assert.equal(wiring.sdk.creates.length, 1, "the writer gets a FRESH sub-session");
    assert.equal(wiring.sdk.promptsFor(writers[0].sessionID).length, 1, "one prompt, no schema retry");
    assert.equal(writers[0].role, "testWriter", "the §3.3 role is testWriter");
    assert.equal(writers[0].itemId, "I1", "the dispatch is correlated to the item");
    assert.equal(
      writers[0].tree,
      root,
      "the writer works the shared tree — as the PATH the §3.5 gates normalize an edit against, which is the workspace itself when the item has no worktree",
    );
    // writeCapable:true is observable ONLY through the freeze-admission check, which the
    // engine performs for a write-capable job and skips for a reader.
    assert.deepEqual(wiring.frozenChecks, [root], "the writer dispatch is write-capable (freeze-admission consulted once, for the shared tree)");
    assert.ok(
      wiring.sdk.prompts.every((p) => p.hasFormatField === false),
      "structured output is prompt-shaped + independently validated (no native `format` field — Task 0.2 DRIFT)",
    );

    // The writer's prompt carries the item spec and the scope it may write.
    assert.ok(writers[0].text.includes(TITLE_MARKER), "the writer prompt carries the item title");
    assert.ok(writers[0].text.includes(ACCEPT_MARKER), "the writer prompt carries the item's acceptance criterion");
    assert.ok(writers[0].text.includes("tests/p.test.mjs"), "the writer prompt names the item's testScope");
    assert.ok(writers[0].text.includes("src/parser.mjs"), "the writer prompt names the item's fileScope");

    // THE HANDLER ran the test: the §2.6 record is on evidence.jsonl (written by
    // evidence.ts runTest, that file's only writer) — exactly one, a legal red.
    const evidence = readEvidence(runDir);
    assert.equal(evidence.length, 1, "exactly ONE evidence record was appended");
    const red = asRed(evidence[0], "the appended record");
    assert.equal(red.itemId, "I1", "the red record names the item");
    assert.equal(red.failureClass, "assertion", "the behaviour was evaluated and was wrong (§2.6.1 'assertion')");
    assert.notEqual(red.exitCode, 0, "a legal red is a genuinely FAILING test (exit != 0)");
    assert.equal(red.targeted, true, "the §2.1 itemTest template produced a TARGETED run");
    assert.ok(!red.failureExcerpt.includes(FALLBACK_TRIPWIRE), "the targeted run never fell back to the full scope command");

    // The new state is read from the PERSISTED item file, never from a log line.
    const item = store.loadItem(runId, "I1");
    assert.equal(validate("Item", item).ok, true, "the advanced item file still satisfies the §2.5 schema");
    assert.equal(item.state, "RED", "the item advanced PENDING→RED through core legalItemTransition");
    assert.equal(item.blocked, null, "a legal red blocks nothing");
    assert.equal(item.attempts.testRepairs, 0, "a first-try red consumed no REPAIR attempt");
    assert.ok(item.evidence.red !== undefined, "the item points at the red it advanced on");
    assert.equal(item.evidence.red?.seq, red.seq, "the item's evidence pointer names the appended record's seq");
    assert.ok((item.evidence.red?.ledger ?? "").includes("evidence.jsonl"), "the pointer names the §2.6 ledger");

    // The compact return names exit code + failureClass + excerpt.
    assert.equal(res.ok, true, "the compact return reports the advance");
    assert.equal(res.itemState, "RED", "the compact return reports the persisted state");
    assert.equal(res.exitCode, red.exitCode, "the compact return names the test's exit code");
    assert.equal(res.failureClass, "assertion", "the compact return names the §2.6.1 failure class");
    assert.equal(res.excerpt, red.failureExcerpt, "the compact return names the captured excerpt");
    assert.equal(res.attempts, 1, "the compact return reports the one writer dispatch");
    assert.equal(res.questionId, null, "a legal red mints no question");
    assert.equal(res.decisionId, null, "a legal red records no decision");
    assert.equal(readQuestions(runDir).length, 0, "questions.jsonl stays empty");

    // Journaled through the closed §7.4 vocabulary only.
    assert.ok(
      journal.records.some((r) => r.component === "evidence" && r.event === "red"),
      "the red evidence is journaled via evidence/red (written by evidence.ts)",
    );
    assert.ok(
      journal.records.some((r) => r.component === "fsm" && r.event === "transition" && JSON.stringify(r).includes("RED")),
      "the PENDING→RED transition is journaled via fsm/transition",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-submit-missing-subject]
// ===========================================================================

test("[9.4a-submit-missing-subject] a GREENFIELD test importing a module inside fileScope that does not exist yet classifies 'missing-subject' and is accepted as a legal RED — the §2.6.1 case ordinary TDD depends on", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ testRepairAttempts: 3 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    // fileScope covers src/**, so the module the test imports — src/decoder.mjs, which
    // the fixture repo deliberately does NOT contain — is THIS item's subject.
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["tests/q.test.mjs"] })],
    };
    seedExecuting(store, runId, queue);
    assert.equal(
      existsSync(path.join(root, "src", "decoder.mjs")),
      false,
      "premise: the subject this item is contracted to build does not exist yet",
    );

    const wiring = makeWiring(runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/q.test.mjs", missingSubjectTest(TEST_V1_MARKER, "../src/decoder.mjs", "decode"))],
      reviewer: [],
    });

    const res: SubmitTestResult = await handleSubmitTest({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    assert.equal(wiring.byRole("testWriter").length, 1, "one writer dispatch: the greenfield red is legal first try");

    // The class is decided by core.classifyFailure INSIDE the real evidence.runTest —
    // a real child `node --test` against a real missing module, never a stub.
    const evidence = readEvidence(runDir);
    assert.equal(evidence.length, 1, "exactly ONE evidence record was appended");
    const red = asRed(evidence[0], "the appended record");
    assert.equal(red.failureClass, "missing-subject", "an unresolved module INSIDE fileScope is 'missing-subject'");
    assert.notEqual(red.exitCode, 0, "the greenfield failure is a genuinely failing test");
    assert.ok(!red.failureExcerpt.includes(FALLBACK_TRIPWIRE), "the run was targeted, not a full-scope fallback");

    const item = store.loadItem(runId, "I1");
    assert.equal(item.state, "RED", "'missing-subject' is accepted as a legal RED exactly like 'assertion'");
    assert.equal(item.blocked, null, "the greenfield red blocks nothing");
    assert.equal(item.evidence.red?.seq, red.seq, "the item points at the missing-subject red");

    assert.equal(res.ok, true, "the compact return reports the advance");
    assert.equal(res.itemState, "RED", "the compact return reports the persisted state");
    assert.equal(res.failureClass, "missing-subject", "the compact return carries the greenfield class");
    assert.equal(res.questionId, null, "a legal greenfield red mints no question");
    assert.equal(readQuestions(runDir).length, 0, "questions.jsonl stays empty");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-submit-error-repair-loop]
// ===========================================================================

test("[9.4a-submit-error-repair-loop] failureClass 'error' is REJECTED as a red and returned to the test-writer with the captured failure; the handler spends its FULL testRepairAttempts repair budget and the LAST permitted repair reaches RED", async () => {
  const root = scratchRepo();
  try {
    // testRepairAttempts 2 REPAIRS (P1) ⇒ 1 initial write + 2 repairs = 3 dispatches at
    // most. The writer stays broken until its LAST permitted repair, so an implementation
    // that stops even one repair short blocks the item here instead of reaching RED — and
    // an implementation that read the knob as a TOTAL-dispatch budget stops after 2.
    const config = makeConfig({ testRepairAttempts: 2 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
    };
    seedExecuting(store, runId, queue);

    const wiring = makeWiring(runId, config, journal.sink, {
      testWriter: [
        writerWrites(root, "tests/p.test.mjs", brokenTest(TEST_V1_MARKER)), // initial write
        writerWrites(root, "tests/p.test.mjs", brokenTest(TEST_V1_MARKER)), // repair 1: still broken
        writerWrites(root, "tests/p.test.mjs", assertionTest(TEST_V2_MARKER)), // repair 2: legal red
      ],
      reviewer: [],
    });

    const res: SubmitTestResult = await handleSubmitTest({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    // The bounded loop's EXACT counts: the initial write plus BOTH permitted repairs, all
    // write-capable, and the REPAIR count is exactly the configured budget — not one less
    // (the loop would have blocked) and not one more (the budget would be exceeded).
    const writers = wiring.byRole("testWriter");
    assert.equal(writers.length, 3, "exactly THREE test-writer dispatches: the initial write plus its two repairs");
    assert.equal(
      writers.length - 1,
      config.workflow.testRepairAttempts,
      "the REPAIR count is exactly testRepairAttempts — the full budget was spent (the initial write is not a repair)",
    );
    assert.ok(
      writers.length <= 1 + config.workflow.testRepairAttempts,
      "the total dispatch count never exceeds 1 + testRepairAttempts",
    );
    assert.equal(wiring.prompted.length, 3, "no other role was dispatched");
    assert.equal(new Set(writers.map((w) => w.sessionID)).size, 3, "each repair is a dispatch of its own");
    assert.deepEqual(wiring.frozenChecks, [root, root, root], "every writer dispatch is write-capable on the shared tree");

    // Three evidence records: two rejected 'error' runs and the accepted 'assertion'.
    const evidence = readEvidence(runDir);
    assert.equal(evidence.length, 3, "the handler ran the test once per writer dispatch");
    const first = asRed(evidence[0], "the first run");
    const middle = asRed(evidence[1], "the first repair's run");
    const second = asRed(evidence[2], "the last repair's run");
    assert.equal(first.failureClass, "error", "a syntax error in the test is class 'error' — NOT a legal red (§2.6.1)");
    assert.equal(middle.failureClass, "error", "the first repair was still not a legal red");
    assert.equal(second.failureClass, "assertion", "the last permitted repair fails for the right reason");

    // The repair re-dispatch carried the CAPTURED FAILURE, not merely the item spec: the
    // two tokens asserted here occur only in the run's own output, never in the test file
    // the handler could have read instead.
    assert.ok(first.failureExcerpt.includes("SyntaxError"), "premise: the captured excerpt names the syntax error");
    assert.ok(first.failureExcerpt.includes("Unexpected token"), "premise: the captured excerpt names the offending token");
    assert.ok(!assertionTest(TEST_V2_MARKER).includes("SyntaxError"), "premise: 'SyntaxError' comes only from the RUN, never from a fixture file");
    for (const repair of writers.slice(1)) {
      assert.ok(repair.text.includes("SyntaxError"), "every repair prompt carries the captured failure excerpt");
      assert.ok(repair.text.includes("Unexpected token"), "every repair prompt carries the runner's own diagnosis");
      assert.ok(repair.text.includes(BROKEN_TOKEN), "every repair prompt shows the writer what its own broken test produced");
    }

    // The rejected rounds made NO transition: exactly one fsm/transition, the final one.
    const transitions = journal.records.filter((r) => r.component === "fsm" && r.event === "transition");
    assert.equal(transitions.length, 1, "the class-'error' rounds produced NO transition; only the repaired red advanced the item");
    assert.ok(JSON.stringify(transitions[0]).includes("RED"), "the one transition is the PENDING→RED advance");

    const item = store.loadItem(runId, "I1");
    assert.equal(item.state, "RED", "the repaired test reaches RED");
    assert.equal(item.blocked, null, "a loop that succeeded within budget blocks nothing");
    assert.equal(item.attempts.testRepairs, 2, "both permitted repairs were consumed (the initial write is not a repair)");
    assert.equal(
      item.attempts.testRepairs,
      config.workflow.testRepairAttempts,
      "the persisted repair counter equals the fully-spent testRepairAttempts budget",
    );
    assert.equal(item.evidence.red?.seq, second.seq, "the item points at the ACCEPTED red, not a rejected one");

    assert.equal(res.ok, true, "the compact return reports the advance");
    assert.equal(res.attempts, 3, "the compact return reports the three writer dispatches");
    assert.equal(res.failureClass, "assertion", "the compact return names the accepted red's class");
    assert.equal(res.questionId, null, "a loop that succeeded within budget mints no question");
    assert.equal(readQuestions(runDir).length, 0, "questions.jsonl stays empty");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-submit-repair-exhausted-blocks]
// ===========================================================================

test("[9.4a-submit-repair-exhausted-blocks] with testRepairAttempts exhausted and the red still illegal the handler sets blocked:{stage:'RED',reason,questionId} and writes exactly ONE §2.11 question (origin 'implementer-blocked') naming exactly this item", async () => {
  const root = scratchRepo();
  try {
    // testRepairAttempts 1 REPAIR (P1) ⇒ 1 initial write + 1 repair = 2 dispatches, and a
    // writer that produces a class-'error' test forever. The budget here is DIFFERENT from
    // the repair-loop test's, so a handler with a hardcoded repair count cannot satisfy
    // both: it must read the knob.
    const config = makeConfig({ testRepairAttempts: 1 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
    };
    seedExecuting(store, runId, queue);

    const wiring = makeWiring(runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/p.test.mjs", brokenTest(TEST_V1_MARKER))],
      reviewer: [],
    });

    const res: SubmitTestResult = await handleSubmitTest({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    // The bound is EXACT: the repair budget is spent, and not one repair more.
    const writers = wiring.byRole("testWriter");
    assert.equal(writers.length, 2, "exactly TWO writer dispatches: the initial write plus its ONE permitted repair");
    assert.equal(
      writers.length - 1,
      config.workflow.testRepairAttempts,
      "the REPAIR count is exactly testRepairAttempts — spent in full and never exceeded",
    );
    assert.equal(wiring.prompted.length, 2, "no other role was dispatched");
    const evidence = readEvidence(runDir);
    assert.equal(evidence.length, 2, "the handler ran the test once per dispatch");
    for (const record of evidence) {
      assert.equal(asRed(record, "an exhaustion-path record").failureClass, "error", "every attempt stayed an illegal red");
    }

    // Asserted by READING THE PERSISTED ITEM FILE: blocked is an ANNOTATION, so the FSM
    // state does not move.
    const item = store.loadItem(runId, "I1");
    assert.equal(validate("Item", item).ok, true, "the blocked item file still satisfies the §2.5 schema");
    assert.equal(item.state, "PENDING", "the item stays at PENDING — blocked is an annotation, not a state");
    assert.ok(item.blocked !== null, "the exhausted item carries a blocked disposition");
    assert.equal(item.blocked?.stage, "RED", "the block names the RED stage it could not complete");
    assert.ok((item.blocked?.reason ?? "").length > 0, "the block carries a non-empty reason");
    assert.equal(item.attempts.testRepairs, 1, "the ONE permitted repair was consumed before the block");
    assert.equal(
      item.attempts.testRepairs,
      config.workflow.testRepairAttempts,
      "the persisted repair counter equals the exhausted testRepairAttempts budget",
    );

    // Exactly ONE §2.11 question, with the pinned (existing, non-widening) origin.
    const questions = readQuestions(runDir);
    assert.equal(questions.length, 1, "exactly ONE question is written at exhaustion");
    const question: QuestionRecord = questions[0];
    assert.equal(validate("QuestionRecord", question).ok, true, "the question is a schema-valid §2.11 record");
    assert.equal(question.origin, "implementer-blocked", "origin is the EXISTING 'implementer-blocked' (the closed vocabulary is not widened)");
    assert.deepEqual(question.blocksItems, ["I1"], "blocksItems names exactly this item");
    assert.equal(question.runId, runId, "the question names its run");
    assert.equal(question.answeredIso, null, "the question starts open");
    assert.equal(question.answer, null, "the question starts unanswered");
    assert.ok(question.question.length > 0, "the question has non-empty text");
    assert.equal(question.tsMs, START_MS, "the question is stamped from the injected clock");
    assert.equal(item.blocked?.questionId, question.id, "the block points at THAT question");

    assert.equal(res.ok, false, "the compact return reports the failure to reach RED");
    assert.equal(res.itemState, "PENDING", "the compact return reports the unmoved state");
    assert.equal(res.attempts, 2, "the compact return reports the two writer dispatches (initial write + the one repair)");
    assert.equal(res.questionId, question.id, "the compact return names the minted question");
    assert.equal(res.failureClass, "error", "the compact return names the illegal class that ended the loop");
    assert.equal(res.decisionId, null, "the exhaustion path records no §2.7 decision");

    assert.equal(
      journal.records.filter((r) => r.component === "fsm" && r.event === "transition").length,
      0,
      "no transition was journaled — the item never advanced",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-submit-pass-rejected]
// ===========================================================================

test("[9.4a-submit-pass-rejected] an immediately-PASSING test is REJECTED (a passing test is not a red): the item stays PENDING and un-blocked and the ponytail-skip fork is recorded as a §2.7 kind:'derived' decision with two scored options", async () => {
  const root = scratchRepo();
  try {
    // Budget 3, to prove a PASS exits the stage at once rather than being "repaired".
    const config = makeConfig({ testRepairAttempts: 3 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
    };
    seedExecuting(store, runId, queue);
    const itemBefore = itemFileBytes(runDir, "I1");

    const wiring = makeWiring(runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/p.test.mjs", passingTest(TEST_V1_MARKER))],
      reviewer: [],
    });

    const res: SubmitTestResult = await handleSubmitTest({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    assert.equal(wiring.byRole("testWriter").length, 1, "a PASS is a rejection, not a repairable red: exactly ONE dispatch, budget untouched");
    const evidence = readEvidence(runDir);
    assert.equal(evidence.length, 1, "one evidence record: the green the handler ran");
    assert.equal(evidence[0].kind, "green", "an exit-0 run is a §2.6 green record, never a red");

    // The item is left exactly where it was — no transition, no block, no annotation.
    const item = store.loadItem(runId, "I1");
    assert.equal(item.state, "PENDING", "PENDING→RED is refused (fsm-item redEvidenceGate: a passing test is not a red)");
    assert.equal(item.blocked, null, "the rejected item is left UN-blocked (the orchestrator may defer or re-dispatch)");
    assert.equal(item.deferred, null, "the rejected item is not deferred by this handler either");
    assert.equal(readQuestions(runDir).length, 0, "the pass rejection writes NO question");
    assert.equal(
      journal.records.filter((r) => r.component === "fsm" && r.event === "transition").length,
      0,
      "no transition was journaled",
    );

    // The ponytail-skip fork is recorded as a §2.7 decision through the existing
    // torn-line-safe mint/append helpers.
    const decisions = readDecisions(runDir);
    assert.equal(decisions.length, 1, "exactly ONE §2.7 record is appended");
    const decision: DecisionRecord = decisions[0];
    assert.equal(validate("DecisionRecord", decision).ok, true, "the record is a schema-valid §2.7 DecisionRecord");
    assert.equal(decision.kind, "derived", "the fork is a DERIVED decision (the handler, not a human, recorded it)");
    assert.equal(decision.id, "D-0001", "the id comes from the existing torn-line-safe mint");
    assert.equal(decision.tsIso, new Date(START_MS).toISOString(), "the record is stamped from the injected clock");
    assert.ok(decision.options.length >= 2, "the fork carries at least the two real options");
    for (const option of decision.options) {
      assert.notEqual(option.score, undefined, "every option on a derived record is SCORED");
    }
    assert.equal(
      requireTwoOptions(decision).ok,
      true,
      "the record satisfies core/decide.ts requireTwoOptions (reused, never reimplemented)",
    );
    const optionText = JSON.stringify(decision.options);
    assert.ok(/behavio(u)?r-already-exists|already exists/i.test(optionText), "one arm is 'the behavior already exists' (ponytail rung skip — the item may be unnecessary)");
    assert.ok(/test-is-wrong|test is wrong/i.test(optionText), "the other arm is 'the test is wrong'");
    assert.ok(/test-is-wrong|test is wrong/i.test(decision.choice), "the conservative default choice is 'test-is-wrong' — the rejection already forces a resubmission");
    assert.ok(decision.appliedWhere.includes("I1"), "the record says where it applies");
    assert.ok(
      journal.records.some((r) => r.component === "state" && r.event === "decision.recorded"),
      "the decision is journaled through the EXISTING state/decision.recorded event (no new event name)",
    );

    // The compact return names the fork so the orchestrator can conductor_defer or re-dispatch.
    assert.equal(res.ok, false, "the compact return reports the rejection");
    assert.equal(res.itemState, "PENDING", "the compact return reports the unmoved state");
    assert.equal(res.exitCode, 0, "the compact return names the passing exit code");
    assert.equal(res.failureClass, null, "a green carries no §2.6.1 failure class");
    assert.equal(res.attempts, 1, "the compact return reports the single dispatch");
    assert.equal(res.decisionId, decision.id, "the compact return names the recorded decision");
    assert.equal(res.questionId, null, "the pass rejection mints no question");
    assert.ok(res.fork !== null, "the compact return NAMES the fork");
    assert.ok(/already exists|skip/i.test(res.fork ?? ""), "the named fork mentions the behavior-already-exists / rung-skip arm");
    assert.ok(/test/i.test(res.fork ?? ""), "the named fork mentions the test-is-wrong arm");

    // Nothing about the item file changed except what this handler is allowed to change:
    // it did not advance, and it did not acquire an annotation.
    const itemAfter = itemFileBytes(runDir, "I1");
    assert.equal(
      JSON.parse(itemAfter).state,
      JSON.parse(itemBefore).state,
      "the persisted FSM state is the one the item started in",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-submit-nonbehavioral-illegal]
// ===========================================================================

test("[9.4a-submit-nonbehavioral-illegal] conductor_submit_test for a behavioral:false item is ILLEGAL: the handler denies at the legality step naming conductor_mark_green, BEFORE any dispatch or persisted write", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ testRepairAttempts: 3 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    // §2.4: a behavioral:false item's fileScope is proven DISJOINT from
    // verify.behavioralPaths ("src/**"), and it owes no test.
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["docs/notes.md"], testScope: [], behavioral: false })],
    };
    seedExecuting(store, runId, queue);
    const itemBefore = itemFileBytes(runDir, "I1");

    // gates-phase agrees: a non-behavioral PENDING's stage tool is conductor_mark_green,
    // and conductor_submit_test is not offered for it at all.
    const verdict = legalTools(EXECUTING_RUN, gateItemsOf(store, runId, queue), [], true);
    assert.equal(verdict.legal.has("conductor_submit_test"), false, "the gate offers NO conductor_submit_test for a non-behavioral item");
    assert.deepEqual(verdict.legal.get("conductor_mark_green")?.itemIds, ["I1"], "the gate offers conductor_mark_green instead");

    const wiring = makeWiring(runId, config, journal.sink, { testWriter: [], reviewer: [] });

    await assert.rejects(
      handleSubmitTest({
        store,
        fanout: wiring.fanout,
        runId,
        itemId: "I1",
        config,
        journal: journal.sink,
        now: () => START_MS,
      }),
      (error: Error) => {
        assert.match(error.message, /conductor_mark_green/, "the deny message names conductor_mark_green as the legal path");
        assert.match(error.message, /I1/, "the deny message names the item it refused");
        return true;
      },
      "conductor_submit_test is illegal for a behavioral:false item",
    );

    // Denied BEFORE any dispatch or write.
    assert.equal(wiring.sdk.calls.length, 0, "zero fake-SDK calls: no session was created and nothing was prompted");
    assert.equal(wiring.prompted.length, 0, "no sub-session was dispatched");
    assert.equal(existsSync(path.join(runDir, "evidence.jsonl")), false, "no evidence record was appended");
    assert.equal(existsSync(path.join(runDir, "decisions.jsonl")), false, "no §2.7 record was appended");
    assert.equal(readQuestions(runDir).length, 0, "no question was written");
    assert.equal(itemFileBytes(runDir, "I1"), itemBefore, "the item file is BYTE-IDENTICAL");
    assert.equal(store.loadItem(runId, "I1").state, "PENDING", "the item did not advance");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-deps-ready-binding] — the MANDATORY 9.4a/5.3 deferred binding, ENFORCE.
// ===========================================================================

test("[9.4a-deps-ready-binding] dependency-readiness is enforced CONSISTENTLY by gate and handler over the SAME fixture: legalTools offers no stage tool for an item whose dependency is not PUBLISHED, and a direct handleSubmitTest/handleVetTest for it is DENIED naming that dependency before any dispatch or write", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);

    // I1 is nobody's dependent and is NOT yet PUBLISHED. I2 (PENDING) and I3 (RED) both
    // depend on it, so both are dependency-UNREADY — exactly schedule.nextWave's rule.
    const queue: Queue = {
      items: [
        makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"], dependsOn: ["I1"] }),
        makeQueueItem("I3", { fileScope: ["src/gamma.mjs"], testScope: ["tests/gamma.test.mjs"], dependsOn: ["I1"] }),
      ],
    };
    seedExecuting(store, runId, queue, { I3: "RED" });
    const beforeI2 = itemFileBytes(runDir, "I2");
    const beforeI3 = itemFileBytes(runDir, "I3");

    // (a) THE GATE. I1's own stage tool is still offered; neither unready dependent's is.
    const unready = legalTools(EXECUTING_RUN, gateItemsOf(store, runId, queue), [], true);
    assert.deepEqual(
      unready.legal.get("conductor_submit_test")?.itemIds,
      ["I1"],
      "conductor_submit_test targets ONLY the dependency-ready item — never the unready I2",
    );
    assert.equal(
      unready.legal.has("conductor_vet_test"),
      false,
      "conductor_vet_test is not offered at all: its only candidate (I3) is dependency-unready",
    );

    // (b) THE HANDLERS, over that same persisted fixture.
    const wiring = makeWiring(runId, config, journal.sink, { testWriter: [], reviewer: [] });
    const denies = /I1/;

    await assert.rejects(
      handleSubmitTest({ store, fanout: wiring.fanout, runId, itemId: "I2", config, journal: journal.sink, now: () => START_MS }),
      (error: Error) => {
        assert.match(error.message, denies, "the submit deny NAMES the unpublished dependency");
        assert.match(error.message, /I2/, "the submit deny names the item it refused");
        return true;
      },
      "handleSubmitTest refuses a dependency-unready item (no recovery bypass)",
    );
    await assert.rejects(
      handleVetTest({ store, fanout: wiring.fanout, runId, itemId: "I3", config, journal: journal.sink, now: () => START_MS }),
      (error: Error) => {
        assert.match(error.message, denies, "the vet deny NAMES the unpublished dependency");
        assert.match(error.message, /I3/, "the vet deny names the item it refused");
        return true;
      },
      "handleVetTest refuses a dependency-unready item (no recovery bypass)",
    );

    assert.equal(wiring.sdk.calls.length, 0, "both denials landed BEFORE any dispatch: zero fake-SDK calls");
    assert.equal(existsSync(path.join(runDir, "evidence.jsonl")), false, "no evidence record was appended");
    assert.equal(readQuestions(runDir).length, 0, "no question was written");
    assert.equal(itemFileBytes(runDir, "I2"), beforeI2, "I2's item file is BYTE-IDENTICAL");
    assert.equal(itemFileBytes(runDir, "I3"), beforeI3, "I3's item file is BYTE-IDENTICAL");

    // The CONTROL, over the same fixture: publishing the dependency is what unlocks both —
    // so the refusals above were about readiness and nothing else.
    const i1 = store.loadItem(runId, "I1");
    i1.state = "PUBLISHED";
    store.saveItem(runId, i1);
    const ready = legalTools(EXECUTING_RUN, gateItemsOf(store, runId, queue), [], true);
    assert.deepEqual(ready.legal.get("conductor_submit_test")?.itemIds, ["I2"], "with the dependency PUBLISHED, I2's stage tool is offered");
    assert.deepEqual(ready.legal.get("conductor_vet_test")?.itemIds, ["I3"], "with the dependency PUBLISHED, I3's stage tool is offered");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The vet fixtures: an item already AT RED, its test on disk, and the captured red on
// the ledger (all seeded directly, never through another task's handler).
// ---------------------------------------------------------------------------

interface VetBench {
  config: Config;
  store: StateStore;
  runId: string;
  runDir: string;
  queue: Queue;
  seededRed: EvidenceRecord;
}

function seedVetBench(root: string, config: Config, sink: JournalSink): VetBench {
  const store = openStore(root, sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  // fileScope covers src/**, so the repaired test's greenfield import is in-scope.
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "RED" });
  writeFileSync(path.join(root, "tests", "p.test.mjs"), assertionTest(TEST_V1_MARKER));
  const seededRed = seedRedEvidence(runDir, "I1");
  assert.equal(validate("EvidenceRecord", seededRed).ok, true, "sanity: the seeded red is a schema-valid §2.6 record");
  return { config, store, runId, runDir, queue, seededRed };
}

// ===========================================================================
// [9.4a-vet-fanout-composition]
// ===========================================================================

test("[9.4a-vet-fanout-composition] handleVetTest fans out exactly readFanout('vet', config) FRESH reviewer critics as ONE parallel group; every prompt carries the item spec, the test, and the captured red — and the implementation marker appears in NO prompt", async () => {
  const root = scratchRepo();
  try {
    // vetCritics 3 clamped by maxReaders 2 => exactly 2 critics (the clamp is the point).
    const config = makeConfig({ vetCritics: 3, maxReaders: 2, vetMaxRounds: 2 });
    const journal = makeJournal();
    const bench = seedVetBench(root, config, journal.sink);
    const critics = readFanout("vet", config);
    assert.equal(critics, 2, "premise: the configured vet fan-out is the clamped count");

    const wiring = makeWiring(bench.runId, config, journal.sink, {
      testWriter: [], // a writer dispatch in a clean round would env-fail loudly
      reviewer: [vetJson([])],
    });

    const res: VetTestResult = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    // Exactly readFanout('vet') critics, all role `reviewer`, each a FRESH sub-session
    // prompted once, and nothing else dispatched.
    const reviewers = wiring.byRole("reviewer");
    assert.equal(reviewers.length, critics, "exactly readFanout('vet', config) critics were dispatched");
    assert.equal(wiring.prompted.length, critics, "no other role was dispatched in a clean round");
    assert.equal(wiring.sdk.creates.length, critics, "each critic gets its OWN fresh sub-session (§3.3 fresh contexts)");
    assert.equal(new Set(reviewers.map((p) => p.sessionID)).size, critics, "the critic prompts land on distinct sessions");
    for (const critic of reviewers) {
      assert.equal(wiring.sdk.promptsFor(critic.sessionID).length, 1, "one prompt per critic, no schema retry");
      assert.equal(critic.itemId, "I1", "each critic is correlated to the item it judges");
    }
    // writeCapable:false — the engine consults freeze admission ONLY for write-capable
    // jobs, so a reader-only round never touches it.
    assert.deepEqual(wiring.frozenChecks, [], "the critics are READERS: no freeze-admission check was made for any of them");

    // ONE parallel group: dispatchWave admits both critics before either is prompted, so
    // the recorded call log is create,create,prompt,prompt — not create,prompt,create,prompt.
    assert.deepEqual(
      wiring.sdk.calls.map((c) => c.method),
      ["create", "create", "prompt", "prompt"],
      "the critics run as ONE parallel group (both sessions created before either is prompted)",
    );

    // Every prompt carries the item spec + the test + the captured red…
    for (const critic of reviewers) {
      assert.ok(critic.text.includes(TITLE_MARKER), "every critic prompt carries the item title");
      assert.ok(critic.text.includes(ACCEPT_MARKER), "every critic prompt carries the item's acceptance");
      assert.ok(critic.text.includes(TEST_V1_MARKER), "every critic prompt carries the TEST CONTENT");
      assert.ok(critic.text.includes("assert.equal(parse"), "every critic prompt carries the test's actual assertions");
      assert.ok(critic.text.includes(RED_MARKER), "every critic prompt carries the CAPTURED RED output");
    }
    // …and NOT the implementation: the fixture planted a marker in the fileScope
    // production file, and it appears in NO recorded prompt at all.
    for (const record of wiring.sdk.prompts) {
      assert.ok(
        !record.text.includes(IMPL_MARKER),
        "no prompt carries the implementation — critics must not be anchored by code that already passes",
      );
    }
    assert.ok(
      readFileSync(path.join(root, "src", "parser.mjs"), "utf8").includes(IMPL_MARKER),
      "the implementation marker really is in the fileScope production file (so its absence above means something)",
    );

    assert.equal(res.ok, true, "a clean round advances the item");
    assert.equal(res.rounds, 1, "exactly one vet round ran");
    // §3.3's captured-red rule, in the negative: with no mustFix repair, nothing re-ran.
    assert.equal(readEvidence(bench.runDir).length, 1, "a clean first round re-runs NOTHING: the ledger still holds only the seeded red");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-vet-mustfix-loop]
// ===========================================================================

test("[9.4a-vet-mustfix-loop] a round with non-empty mustFix routes the UNION back to the test-writer in ONE write-capable re-dispatch, re-runs the repaired test to a still-legal §2.6.1 red, then re-vets — TEST_VETTED in exactly 2 rounds with exactly 1 writer re-dispatch", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ vetCritics: 2, maxReaders: 2, vetMaxRounds: 2 });
    const journal = makeJournal();
    const bench = seedVetBench(root, config, journal.sink);

    // Round 1: the two critics raise DIFFERENT mustFix items (so the union is checkable).
    // Round 2 (after the repair): both clean.
    const wiring = makeWiring(bench.runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/p.test.mjs", missingSubjectTest(TEST_V2_MARKER, "../src/decoder.mjs", "decode"))],
      reviewer: [vetJson([MUSTFIX_A]), vetJson([MUSTFIX_B]), vetJson([]), vetJson([])],
    });

    const res: VetTestResult = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    // EXACT counts for the bounded loop.
    const reviewers = wiring.byRole("reviewer");
    const writers = wiring.byRole("testWriter");
    assert.equal(reviewers.length, 4, "exactly TWO vet rounds of two critics each");
    assert.equal(writers.length, 1, "exactly ONE test-writer re-dispatch carried the mustFix list");
    assert.equal(wiring.prompted.length, 5, "nothing else was dispatched");
    assert.deepEqual(wiring.frozenChecks, [root], "the ONE writer re-dispatch is write-capable; the critics are not");

    // The re-dispatch carries the UNION of both critics' mustFix items…
    assert.ok(writers[0].text.includes(MUSTFIX_A), "the writer re-dispatch carries the first critic's mustFix item");
    assert.ok(writers[0].text.includes(MUSTFIX_B), "the writer re-dispatch carries the second critic's mustFix item");
    // …and sits BETWEEN the two rounds.
    const writerAt = wiring.prompted.findIndex((p) => p.role === "testWriter");
    const reviewerIdxs = wiring.prompted.map((p, i) => (p.role === "reviewer" ? i : -1)).filter((i) => i !== -1);
    assert.equal(reviewerIdxs.filter((i) => i < writerAt).length, 2, "round 1's two critics precede the re-dispatch");
    assert.equal(reviewerIdxs.filter((i) => i > writerAt).length, 2, "round 2's two critics follow the re-dispatch");

    // The repaired test was RE-RUN through evidence.runTest and produced a STILL-LEGAL
    // §2.6.1 red before the re-vet (the pinned G6 resolution).
    const evidence = readEvidence(bench.runDir);
    assert.equal(evidence.length, 2, "exactly one NEW evidence record: the repaired test's re-run");
    const fresh = asRed(evidence[1], "the re-run");
    assert.equal(fresh.failureClass, "missing-subject", "the repaired test still fails for a §2.6.1-legal reason");
    assert.notEqual(fresh.exitCode, 0, "the repaired test still genuinely fails");
    assert.ok(!fresh.failureExcerpt.includes(FALLBACK_TRIPWIRE), "the re-run was targeted, not a full-scope fallback");

    // Round 2's critics judge the REPAIRED test against a TRUE captured red — not the
    // stale one the seeded ledger held.
    const round2 = reviewers.slice(2);
    for (const critic of round2) {
      assert.ok(critic.text.includes(TEST_V2_MARKER), "round 2's critics see the REPAIRED test");
      assert.ok(!critic.text.includes(TEST_V1_MARKER), "round 2's critics no longer see the pre-repair test");
      assert.ok(critic.text.includes("ERR_MODULE_NOT_FOUND"), "round 2's critics see the FRESH red the re-run produced");
      assert.ok(!critic.text.includes(RED_MARKER), "round 2's critics no longer see the STALE captured red");
      assert.ok(!critic.text.includes(IMPL_MARKER), "no round ever shows a critic the implementation");
    }
    for (const critic of reviewers.slice(0, 2)) {
      assert.ok(critic.text.includes(RED_MARKER), "round 1's critics saw the red the item arrived with");
      assert.ok(critic.text.includes(TEST_V1_MARKER), "round 1's critics saw the pre-repair test");
    }

    const item = bench.store.loadItem(bench.runId, "I1");
    assert.equal(item.state, "TEST_VETTED", "the clean second round advances RED→TEST_VETTED");
    assert.equal(item.blocked, null, "a loop that converged within vetMaxRounds blocks nothing");
    assert.equal(item.attempts.vetRounds, 2, "exactly two vet rounds are recorded on the item");

    assert.equal(res.ok, true, "the compact return reports the advance");
    assert.equal(res.rounds, 2, "the compact return reports exactly two rounds");
    assert.deepEqual(res.mustFix, [], "the final round carried no outstanding mustFix");
    assert.equal(res.questionId, null, "a converged loop mints no question");
    assert.equal(readQuestions(bench.runDir).length, 0, "questions.jsonl stays empty");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-vet-pass-advances]
// ===========================================================================

test("[9.4a-vet-pass-advances] a round in which EVERY critic returns empty mustFix advances RED→TEST_VETTED, persists through store.saveItem, journals through the closed vocabulary only (driven through the REAL throwing journal), and returns the per-criterion verdicts", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ vetCritics: 2, maxReaders: 2, vetMaxRounds: 2 });
    // The STORE is opened before the run dir exists, so it takes the capture sink; the
    // HANDLER and the fan-out engine are driven through the REAL adapter/journal.ts
    // journal, which THROWS on any event outside the closed §7.4 vocabulary. A handler
    // that invented an event name fails this test loudly instead of widening the vocabulary.
    const storeJournal = makeJournal();
    const bench = seedVetBench(root, config, storeJournal.sink);
    const journal = makeRealJournal(bench.runDir, config);

    const wiring = makeWiring(bench.runId, config, journal.sink, {
      testWriter: [],
      reviewer: [vetJson([])],
    });

    const res: VetTestResult = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });
    journal.sink.flushSync();

    assert.equal(wiring.byRole("reviewer").length, 2, "one clean round of two critics");
    assert.equal(wiring.byRole("testWriter").length, 0, "a clean round re-dispatches NO writer");

    // Persisted — asserted by RE-LOADING the item file.
    const item = bench.store.loadItem(bench.runId, "I1");
    assert.equal(validate("Item", item).ok, true, "the advanced item file still satisfies the §2.5 schema");
    assert.equal(item.state, "TEST_VETTED", "the item advanced RED→TEST_VETTED through core legalItemTransition");
    assert.equal(item.blocked, null, "a clean vet blocks nothing");
    assert.equal(item.attempts.vetRounds, 1, "exactly one vet round is recorded on the item");

    // Journaled through the closed vocabulary — and the REAL journal proves it, because
    // an unknown component/event would have thrown out of the handler above. The records
    // are read back off journal.jsonl, the file the real sink actually wrote.
    const lines = readFileSync(path.join(bench.runDir, "journal.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { component: string; event: string });
    assert.ok(lines.length > 0, "the real journal wrote records to journal.jsonl");
    assert.ok(
      lines.some((r) => r.component === "fsm" && r.event === "transition"),
      "the RED→TEST_VETTED transition is journaled via the existing fsm/transition event",
    );
    assert.ok(
      lines.some((r) => r.component === "state" && r.event === "item.updated"),
      "the item mutation is journaled via the existing state/item.updated event",
    );
    assert.ok(
      journal.records.some(
        (r) => r.component === "fsm" && r.event === "transition" && JSON.stringify(r).includes("TEST_VETTED"),
      ),
      "the journaled transition names the TEST_VETTED target",
    );

    // The compact return summarises the per-criterion verdicts: one row per §2.10
    // criterion, tallied across the critics of the final round.
    assert.equal(res.ok, true, "the compact return reports the advance");
    assert.equal(res.itemState, "TEST_VETTED", "the compact return reports the persisted state");
    assert.equal(res.rounds, 1, "the compact return reports the single round");
    assert.deepEqual(res.mustFix, [], "a clean round leaves no mustFix outstanding");
    assert.equal(res.questionId, null, "a clean round mints no question");
    assert.equal(res.verdicts.length, VET_CRITERIA.length, "one tally row per §2.10 TEST_VET criterion");
    assert.deepEqual(
      res.verdicts.map((v) => v.criterion),
      [...VET_CRITERIA],
      "the tally rows are the five §2.10 criteria, in schema order",
    );
    for (const criterion of VET_CRITERIA) {
      const row = tallyFor(res.verdicts, criterion);
      assert.equal(row.passed, 2, `both critics passed "${criterion}"`);
      assert.equal(row.failed, 0, `no critic failed "${criterion}"`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.4a-vet-cap-blocks]
// ===========================================================================

test("[9.4a-vet-cap-blocks] reaching vetMaxRounds with mustFix still outstanding leaves the item at RED with blocked:{stage:'TEST_VETTED', reason naming vetMaxRounds, questionId} plus exactly ONE §2.11 question (origin 'review-round-cap') — and no critic or writer is dispatched after the cap", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ vetCritics: 2, maxReaders: 2, vetMaxRounds: 2 });
    const journal = makeJournal();
    const bench = seedVetBench(root, config, journal.sink);

    // Bad-forever critics: BOTH rounds raise the SAME two mustFix items (each round's two
    // FRESH critic sub-sessions take the next two scripted replies, so the script carries
    // one pair per round), so the loop can only end at the cap. The single scripted writer
    // reply clamps, so each re-dispatch repairs to the same still-legal red.
    const wiring = makeWiring(bench.runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/p.test.mjs", missingSubjectTest(TEST_V2_MARKER, "../src/decoder.mjs", "decode"))],
      reviewer: [vetJson([MUSTFIX_A]), vetJson([MUSTFIX_B]), vetJson([MUSTFIX_A]), vetJson([MUSTFIX_B])],
    });

    const res: VetTestResult = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      now: () => START_MS,
    });

    // EXACT counts at the cap: two rounds of critics with exactly one repair between
    // them, and NOTHING after the cap round.
    const reviewers = wiring.byRole("reviewer");
    assert.equal(reviewers.length, 4, "exactly vetMaxRounds (2) rounds of two critics");
    assert.equal(wiring.byRole("testWriter").length, 1, "exactly ONE writer re-dispatch — the cap round repairs nothing");
    assert.equal(wiring.prompted.length, 5, "no dispatch beyond the two rounds and their one repair");
    assert.equal(
      wiring.prompted[wiring.prompted.length - 1].role,
      "reviewer",
      "the LAST dispatch is the cap round's critic: no critic or writer runs after the cap",
    );

    // Asserted by reading the PERSISTED item file: the item stays at RED (blocked is an
    // annotation, not an FSM position) — mirroring the submit-side exhaustion row.
    const item = bench.store.loadItem(bench.runId, "I1");
    assert.equal(validate("Item", item).ok, true, "the blocked item file still satisfies the §2.5 schema");
    assert.equal(item.state, "RED", "the capped item stays at RED — it never reached TEST_VETTED");
    assert.ok(item.blocked !== null, "the capped item carries a blocked disposition");
    assert.equal(item.blocked?.stage, "TEST_VETTED", "the block names the stage it could not complete");
    assert.ok((item.blocked?.reason ?? "").includes("vetMaxRounds"), "the reason NAMES vetMaxRounds (the knob distinct from reviewMaxRounds)");
    assert.equal(item.attempts.vetRounds, 2, "both vet rounds are recorded on the item");

    // Exactly ONE §2.11 question, with the pinned (existing, non-widening) origin.
    const questions = readQuestions(bench.runDir);
    assert.equal(questions.length, 1, "exactly ONE question is written at the cap");
    const question: QuestionRecord = questions[0];
    assert.equal(validate("QuestionRecord", question).ok, true, "the question is a schema-valid §2.11 record");
    assert.equal(question.origin, "review-round-cap", "origin is the EXISTING 'review-round-cap' (the closed vocabulary is not widened)");
    assert.deepEqual(question.blocksItems, ["I1"], "blocksItems names exactly this item");
    assert.equal(question.runId, bench.runId, "the question names its run");
    assert.equal(question.answeredIso, null, "the question starts open");
    assert.equal(question.tsMs, START_MS, "the question is stamped from the injected clock");
    assert.equal(item.blocked?.questionId, question.id, "the block points at THAT question");

    assert.equal(res.ok, false, "the compact return reports the failure to advance");
    assert.equal(res.itemState, "RED", "the compact return reports the unmoved state");
    assert.equal(res.rounds, 2, "the compact return reports the capped round count");
    assert.equal(res.questionId, question.id, "the compact return names the minted question");
    assert.deepEqual(
      [...res.mustFix].sort(),
      [MUSTFIX_A, MUSTFIX_B].sort(),
      "the compact return carries the still-outstanding mustFix union",
    );
    for (const criterion of VET_CRITERIA) {
      assert.equal(tallyFor(res.verdicts, criterion).failed, 2, `both critics failed "${criterion}" in the cap round`);
    }
    assert.equal(
      journal.records.filter((r) => r.component === "fsm" && r.event === "transition").length,
      0,
      "no transition was journaled — the capped item never advanced",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
