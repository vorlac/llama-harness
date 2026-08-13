// Task 9.4b RED tests — FINAL LOCATION conductor/tests/tools-9.4b.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the THREE Phase-9 handlers added to the
// EXISTING conductor/adapter/tools.ts (which today carries the §5.3 gate wiring plus the
// Task-9.1/9.2/9.3/9.4a handlers). The red is the missing-export shape — tools.ts
// resolves, but these three named bindings do not yet exist:
//   handleMarkGreen   (conductor_mark_green,  TEST_VETTED→GREEN, and PENDING→GREEN for a
//                      behavioral:false item)
//   handleValidate    (conductor_validate,    GREEN→VALIDATED, the full required-scope
//                      verify with the §4.2 foreign-red quarantine + the DEBUG protocol)
//   handleQueueAmend  (conductor_queue_amend, re-validate the amended queue + §2.7 record)
// EVERY other import in this file resolves to a committed export today — including
// gateBeforeToolCall from this same module, adapter/evidence.ts's runTest
// `excludeTestFiles` option (committed in the Phase-6 milestone-gate fixes), and
// adapter/inject.ts's loadPacks.
//
// Each handler follows the §3.4 invariant loop — legality → derive → persist → journal →
// compact return — and (with the state store / questions adapter it delegates to) is the
// only writer of item state (G6). Sub-session traffic goes through the injected Fanout
// (adapter/fanout.ts) over the FAKE SDK (tests/fixtures/fake-sdk.ts); the item test and
// the full verify are run ONLY through adapter/evidence.ts runTest/runVerify, against
// REAL on-disk `git init` fixture repos and REAL child `node --test` processes.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.4b (2624-2638) — the authoritative behaviour of the three tools.
//   §3.3 (1211-1219)  — TEST_VETTED→GREEN: the implementer (role `implementer`, doctrine
//                       tdd.md) may edit the item's fileScope; THE HANDLER re-runs the
//                       item test itself and requires exit 0 — "done by assertion" is
//                       refused.
//   §3.3 (1220-1231)  — GREEN→VALIDATED: evidence.ts quarantines the foreign red set,
//                       start-stamps, records HEAD, runs the required scopes (build
//                       first); the freeze denies EVERY edit in the tree while the verify
//                       is in flight; a second validate against a live marker is DENIED;
//                       failure drops to the DEBUG protocol (debug.md injected,
//                       `debugging` set, debugFixCap failed fixes ⇒ architecture question
//                       + the item blocked).
//   §4.2 (1578-1600)  — the foreign red set: the testScope files of every OTHER queue item
//                       below GREEN ∪ every path in the §2.11 stale-red registry, moved
//                       OUT of the repository and restored when the verify completes. The
//                       item's OWN tests are NEVER excluded.
//   §2.11 (1000-1010) — the workspace-level stale-red registry, which SURVIVES runs.
//   §2.1              — `debugFixCap` (failed fixes before architecture escalation).
//   docs/build/specs/task-9.4b.assertions.json — the 13 rows mapped to the 13 tests
//                       below, its `reusesExisting` list and its five `specGaps`.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.4b.assertions.json; this file is the contract
// that pins them):
//  (G1) handleMarkGreen owns the WHOLE stage exactly as 9.4a's handleSubmitTest owns
//       PENDING→RED: it dispatches the implementer (role "implementer", writeCapable,
//       tree "main", schema ImplementerResult, doctrine tdd.md), then runs the item test
//       ITSELF through evidence.runTest, and admits the result through core
//       legalItemTransition. It re-implements no edge legality.
//  (G2) The two CONSTRUCTIBLE rungs of the §3.3 BLOCKED ladder are implemented (one
//       NEEDS_CONTEXT re-dispatch; BLOCKED ⇒ ONE question on the EXISTING
//       "implementer-blocked" origin + the item blocked). "Stronger model" and
//       "re-split" are raised at the Phase-9 gate, not faked. NO row here exercises the
//       ladder, so no test below constrains it.
//  (G3) runTest's no-template fallback quarantines the SAME foreign red set the verify
//       path does, through the SAME committed `excludeTestFiles` option.
//  (G4) The FIRST DEBUG entry records a hypothesis derived from the verify's OWN captured
//       failure (the failing scope), never a model paraphrase; it is asserted on the
//       PERSISTED item, at the instant of the first implementer dispatch.
//  (G5) conductor_queue_amend records a §2.7 kind:"derived" decision gated by the SAME
//       core/decide.ts requireTwoOptions every other decision site runs.
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) `config.workflow.debugFixCap` bounds FIX ATTEMPTS, not verify runs. The initial
//       failing verify is not a fix, so one conductor_validate call makes at most
//       debugFixCap implementer dispatches and debugFixCap+1 verify runs, and blocks when
//       the LAST permitted fix still fails. `item.attempts.debugFixes` counts the fixes
//       actually spent. Pinned at TWO DIFFERENT caps below so a hardcoded count fails.
//  (P2) A DENIAL throws (the 9.1/9.2/9.3/9.4a convention in this file, and what makes
//       "nothing was written" checkable): an illegal stage tool, a live same-tree verify
//       marker, and a rejected amendment all THROW. A stage that ran but did not advance
//       (a failing item test, a failing verify) returns ok:false — it is an outcome, not
//       a refusal.
//  (P3) An implementer receipt with status DONE whose item test still fails burns exactly
//       ONE dispatch: DONE is neither NEEDS_CONTEXT nor BLOCKED, so no ladder rung
//       applies and the tool call simply fails ("the implementer never runs done by
//       assertion" — the orchestrator re-calls the tool).
//  (P4) The evidence pointers §2.6 gives the item are written on the advance:
//       item.evidence.green.seq is the accepted green record's seq and
//       item.evidence.validated.seq is the accepted verify record's seq; `.ledger` names
//       evidence.jsonl. (The seq pointer is pinned; the exact path spelling is not.)
//  (P5) Every stamped value flows through the INJECTED clock: the handlers pass `now`
//       down to evidence.ts and to the questions adapter, so the verify record's
//       startedMs and a minted question's tsMs are both the injected constant.
//  (P6) handleQueueAmend is SYNCHRONOUS (it dispatches nothing) — the handleDecide /
//       handleDefer shape.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). ONE options
// object each; runDir is derived as <store.root>/.conductor/runs/<runId>/; the fixture
// repo IS <store.root> (the cwd of both the item test and the verify). `journal` is the
// leveled sink (adapter/journal.ts Journal-compatible); `now` defaults to Date.now.
// `stateHome`/`workspaceKey` are the OUT-OF-REPO §4.2 quarantine coordinates the
// committed quarantine.ts already takes. `packs` is the doctrine map adapter/inject.ts
// loadPacks produced at init (§6.4 loads it once) — debug.md is delivered from it.
//
//   // conductor_mark_green (§3.3). Legality (core/gates-phase.ts legalTools, through the
//   // 9.4a requireStageTool): the run is EXECUTING, the item exists, is un-blocked /
//   // un-deferred and dependency-ready, and is offered conductor_mark_green — TEST_VETTED
//   // for a behavioral item, PENDING for a behavioral:false one (a behavioral:true PENDING
//   // item is REFUSED naming conductor_submit_test). Then: dispatch the implementer, and —
//   // for a BEHAVIORAL item only — run the item test through evidence.runTest under the
//   // §4.2 foreign red set, admitting exit 0 through core legalItemTransition. A
//   // behavioral:false item runs NO item test at all.
//   handleMarkGreen(input: {
//     store: StateStore; fanout: Fanout; runId: string; itemId: string; config: Config;
//     journal: JournalSink; stateHome: string; workspaceKey: string; now?: () => number;
//   }): Promise<{
//     ok: boolean;              // true IFF the item advanced to GREEN
//     itemState: ItemState;     // the PERSISTED state after the call
//     ranItemTest: boolean;     // false for a behavioral:false item
//     exitCode: number | null;  // the handler-run item test's exit code (null if none)
//     attempts: number;         // implementer dispatches consumed
//     excluded: string[];       // the §4.2 foreign red set the item test ran under
//     questionId: string | null;
//   }>
//
//   // conductor_validate (§3.3 GREEN→VALIDATED). Legality as above with state GREEN.
//   // Then: compute the §4.2 foreign red set (the testScope files of every OTHER queue
//   // item below GREEN ∪ store.readStaleRed()'s paths, minus this item's own testScope)
//   // and hand it to evidence.runVerify as excludeTestFiles. runVerify owns the
//   // quarantine, the start-stamp, HEAD/branch and the per-tree marker; this handler
//   // composes it and admits the outcome. A live same-tree marker THROWS. A red verify
//   // enters the DEBUG protocol: store.setDebugging({hypothesis}) from the verify's own
//   // failure, then up to config.workflow.debugFixCap implementer dispatches (each
//   // carrying doctrine debug.md verbatim + the captured failure) with a re-verify after
//   // each; at the cap, store.setBlocked + ONE questions.appendQuestion on the EXISTING
//   // origin "debug-architecture".
//   handleValidate(input: {
//     store: StateStore; fanout: Fanout; runId: string; itemId: string; config: Config;
//     journal: JournalSink; stateHome: string; workspaceKey: string;
//     packs: Record<string, string>; now?: () => number;
//   }): Promise<{
//     ok: boolean;              // true IFF the item advanced GREEN→VALIDATED
//     itemState: ItemState;     // the PERSISTED state after the call
//     green: boolean;           // the LAST verify's outcome
//     excluded: string[];       // the §4.2 foreign red set quarantined for the verify
//     verifySeq: number | null; // the §2.6 verify record the outcome rests on
//     debugFixes: number;       // fix attempts spent (== item.attempts.debugFixes)
//     questionId: string | null;// the "debug-architecture" question minted at the cap
//   }>
//
//   // conductor_queue_amend (§2.4 / §2.7). Re-runs core validateQueue over the AMENDED
//   // queue and THROWS on any violation (legality before persist — nothing is written).
//   // The §2.7 record is gated by core requireTwoOptions, so a <2-scored-options
//   // amendment also throws with nothing written. On accept: persist queue.json, append
//   // ONE kind:"derived" record, journal, return.
//   handleQueueAmend(input: {
//     store: StateStore; runId: string; config: Config; journal: JournalSink;
//     now?: () => number; queue: Queue; question: string;
//     options: Array<{ name: string; score?: DecisionRecord["options"][number]["score"] }>;
//     choice: string; why: string; appliedWhere: string;
//   }): { ok: boolean; decisionId: string; itemIds: string[] }
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id as its FIRST token):
//   9.4b-green-requires-passing-test  → a DONE receipt with a failing item test does NOT
//                                       advance the item (real child process, real ledger).
//   9.4b-green-advances-on-exit-0     → exit 0 advances TEST_VETTED→GREEN, writes the §2.6
//                                       green pointer, journals through the REAL journal.
//   9.4b-green-nonbehavioral-from-pending → PENDING→GREEN for behavioral:false runs NO item
//                                       test (sentinel ABSENT + no new §2.6 record); a
//                                       behavioral:true PENDING item is refused naming
//                                       conductor_submit_test.
//   9.4b-validate-composes-runverify  → the marker/start-stamp/HEAD are runVerify's, proven
//                                       by observing them, not by re-implementation.
//   9.4b-validate-refuses-live-marker → a second validate against a live marker throws,
//                                       runs no scope, leaves the marker byte-identical.
//   9.4b-validate-freeze-denies-edits → the REAL edit gate denies a production AND a test
//                                       edit while the marker is live, allows both after.
//   9.4b-foreign-red-set-three-cases  → three sub-cases (wave sibling / blocked prior-wave
//                                       item / stale-red registry from an EARLIER RUN).
//   9.4b-own-red-still-fails-validate → the same fixture with the failing file's ownership
//                                       flipped: A's own red is never quarantined.
//   9.4b-no-template-wave-no-livelock → two no-template items in one wave both reach GREEN.
//   9.4b-debug-entry-on-failure       → debugging + debug.md in the implementer's next
//                                       dispatch, asserted at the instant of the dispatch.
//   9.4b-debug-cap-escalates          → the cap blocks + ONE "debug-architecture" question,
//                                       pinned at TWO different debugFixCap values.
//   9.4b-amend-revalidates-queue      → cycle / intersecting fileScope / behavioral-testScope
//                                       all refused with NOTHING persisted.
//   9.4b-amend-records-decision       → an accepted amendment persists + records one derived
//                                       decision; a <2-scored-options one is rejected.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The SUBJECTS — absent at red time (missing-export red from the existing tools.ts).
// gateBeforeToolCall comes from the SAME module and exists today.
import {
  gateBeforeToolCall,
  handleMarkGreen,
  handleQueueAmend,
  handleValidate,
} from "../adapter/tools.ts";
import type { RegistryEntry } from "../adapter/tools.ts";

// Adapters + core that DO exist today.
import { childEnv } from "../adapter/evidence.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { loadPacks } from "../adapter/inject.ts";
import { requireTwoOptions } from "../core/decide.ts";
import { validateQueue } from "../core/planning.ts";
import { validate } from "../core/types.ts";
import type {
  Config,
  DecisionRecord,
  EvidenceRecord,
  Item,
  ItemState,
  LogLevel,
  Queue,
  QueueItem,
  QuestionRecord,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// The pinned compact-return shapes (the header's contract, restated structurally so the
// call sites type-check the green implementation against it).
interface MarkGreenResult {
  ok: boolean;
  itemState: ItemState;
  ranItemTest: boolean;
  exitCode: number | null;
  attempts: number;
  excluded: string[];
  questionId: string | null;
}

interface ValidateResult {
  ok: boolean;
  itemState: ItemState;
  green: boolean;
  excluded: string[];
  verifySeq: number | null;
  debugFixes: number;
  questionId: string | null;
}

interface QueueAmendResult {
  ok: boolean;
  decisionId: string;
  itemIds: string[];
}

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a
// value DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-4471";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-9032";
const IMPL_MARKER = "IMPLEMENTER-REPLY-MARKER-6650";
const OWN_RED_MARKER = "OWN-RED-MARKER-2214";
const SIBLING_RED_MARKER = "SIBLING-RED-MARKER-3318";
const BLOCKED_RED_MARKER = "BLOCKED-RED-MARKER-7742";
const STALE_RED_MARKER = "STALE-RED-MARKER-8865";

// The verify scope name is DELIBERATELY distinctive: the DEBUG hypothesis and the
// escalation question must NAME the failing scope they read off the §2.6 verify record,
// so a hardcoded "unit" cannot satisfy these tests.
const SCOPE = "unit7731";

// The §2.11 origin vocabulary is CLOSED (core/types.ts QUESTION_ORIGINS): the debugFixCap
// escalation uses the EXISTING "debug-architecture". Nothing here widens it.
const DEBUG_ORIGIN = "debug-architecture";

// A fixed injected clock: every stamped value the handlers mint reads it.
const START_MS = 1_754_560_000_000;

// This file's home (conductor/tests/) — the doctrine packs and the pure gate module are
// read RELATIVE to it, never to cwd.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");
const GATES_EDIT_URL = pathToFileURL(path.resolve(HERE, "..", "core", "gates-edit.ts")).href;

// The REAL doctrine packs, through the COMMITTED loader (adapter/inject.ts loadPacks) —
// never a literal typed here. debug.md's own text is what the DEBUG dispatch must carry.
const PACKS: Record<string, string> = loadPacks(DOCTRINE_DIR);
const DEBUG_PACK = PACKS["debug.md"].trim();

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom). Every fixture
// is a throwaway repo under os.tmpdir(); the out-of-repo state home is a SEPARATE
// throwaway dir. Never the llama-harness repo.
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

// A committed fixture repo, so runVerify records a REAL HEAD sha and branch "main".
function committedRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools94b-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function headOf(repo: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env: GIT_ENV, encoding: "utf8" }).trim();
}

// The OUT-OF-REPO §4.2 state home (quarantine target) — a DISTINCT temp dir, and where
// every witness file lives so no witness is ever inside the tree being verified.
function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools94b-state-"));
  tmpDirs.push(dir);
  return dir;
}

const HEX40 = /^[0-9a-f]{40}$/;

// A CONTROL run of the whole fixture suite, spawned with the COMMITTED evidence.ts
// childEnv. Stripping NODE_TEST_CONTEXT is load-bearing here: inherited, a `node --test`
// child mistakes itself for a test child of THIS run and reports exit 0 for a suite that
// actually failed — which would turn every "the un-quarantined suite is red" premise below
// into a vacuous claim. The verify/item-test runs go through evidence.ts, which strips it
// for the same reason; the controls must match.
function controlSuite(repo: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, ["--test"], {
    cwd: repo,
    env: childEnv(),
    encoding: "utf8",
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ---------------------------------------------------------------------------
// Fixture source files. Every test file WRITES ITS EXECUTION WITNESS FIRST and only then
// touches its subject: a quarantined file's witness is absent because the file was moved
// OUT of the walked tree, and a file that failed to load still proves it RAN.
// ---------------------------------------------------------------------------

// A test that passes: writes its witness, then asserts its subject module's export.
function passingTest(witnessAbs: string, moduleRel: string): string {
  return (
    'import { writeFileSync } from "node:fs";\n' +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    `writeFileSync(${JSON.stringify(witnessAbs)}, "ran");\n` +
    `const mod = await import(${JSON.stringify(moduleRel)});\n` +
    'test("t", () => {\n' +
    "  assert.equal(mod.ok, true);\n" +
    "});\n"
  );
}

// A test that RUNS and fails its assertion, carrying `marker` into the failure output.
function failingTest(witnessAbs: string, marker: string): string {
  return (
    'import { writeFileSync } from "node:fs";\n' +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    `writeFileSync(${JSON.stringify(witnessAbs)}, "ran");\n` +
    `test(${JSON.stringify(marker)}, () => {\n` +
    `  assert.equal(1, 2, ${JSON.stringify(marker)});\n` +
    "});\n"
  );
}

// A GREENFIELD test: writes its witness, then imports a module the item has not built
// yet, so the file fails to load until the implementer writes the subject.
function greenfieldTest(witnessAbs: string, moduleRel: string): string {
  return passingTest(witnessAbs, moduleRel);
}

// The subject module an implementer writes to turn a greenfield test green.
const SUBJECT_MODULE = "export const ok = true;\n";

// ---------------------------------------------------------------------------
// The verify/fallback COMMAND. A wrapper that (a) snapshots which verify markers are live
// and which repo-relative paths are PRESENT at the instant the scope runs — the §4.2
// "moved OUT of the repo during the verify" and §4.3 "the marker was live" proofs — and
// optionally (b) evaluates the REAL core/gates-edit.ts decideEdit against that live
// marker, then (c) spawns the real `node --test` child over the tree and exits with its
// status (evidence.ts's childEnv has already stripped NODE_TEST_CONTEXT for it).
// Each run APPENDS a snapshot, so a DEBUG loop's repeated verifies are all observable.
// ---------------------------------------------------------------------------

interface GateProbe {
  tree: string;
  fileScope: string[];
  testScope: string[];
  checks: Array<{ role: string; rel: string }>;
}

interface GateProbeResult {
  role: string;
  rel: string;
  decision: { action: string; reason?: string };
}

interface WitnessSnapshot {
  markers: string[];
  present: string[];
  gate: GateProbeResult[] | null;
}

function wrapperCmd(opts: {
  witness: string;
  runsDir: string;
  rels: string[];
  probe?: GateProbe;
}): string[] {
  const probeSrc =
    opts.probe === undefined
      ? "null"
      : `await (async () => {
      const m = await import(${JSON.stringify(GATES_EDIT_URL)});
      const tree = ${JSON.stringify(opts.probe.tree)};
      const live = markers.length > 0 ? tree : null;
      return ${JSON.stringify(opts.probe.checks)}.map((c) => ({
        role: c.role,
        rel: c.rel,
        decision: m.decideEdit({
          sessionRole: c.role,
          registered: true,
          fileScope: ${JSON.stringify(opts.probe.fileScope)},
          testScope: ${JSON.stringify(opts.probe.testScope)},
          path: path.join(tree, c.rel),
          verifyInFlightTree: live,
          sessionTree: tree,
          inlineClaimScope: null,
        }),
      }));
    })()`;

  const script =
    "const fs=require('fs'),path=require('path'),cp=require('child_process');\n" +
    "(async () => {\n" +
    `  const runsDir=${JSON.stringify(opts.runsDir)};\n` +
    "  const markers=[];\n" +
    "  if (fs.existsSync(runsDir)) {\n" +
    "    for (const d of fs.readdirSync(runsDir)) {\n" +
    "      const dir=path.join(runsDir,d);\n" +
    "      if (!fs.statSync(dir).isDirectory()) continue;\n" +
    "      for (const f of fs.readdirSync(dir)) {\n" +
    "        if (/^verify-running-.+\\.json$/.test(f)) markers.push(d + '/' + f);\n" +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "  markers.sort();\n" +
    `  const rels=${JSON.stringify(opts.rels)};\n` +
    "  const present=rels.filter((r) => fs.existsSync(path.join(process.cwd(), r)));\n" +
    `  const gate=${probeSrc};\n` +
    `  const witness=${JSON.stringify(opts.witness)};\n` +
    "  const prior=fs.existsSync(witness) ? JSON.parse(fs.readFileSync(witness,'utf8')) : [];\n" +
    "  prior.push({ markers: markers, present: present, gate: gate });\n" +
    "  fs.writeFileSync(witness, JSON.stringify(prior));\n" +
    "  const r=cp.spawnSync(process.execPath, ['--test'], { cwd: process.cwd(), stdio: 'inherit' });\n" +
    "  process.exit(typeof r.status === 'number' ? r.status : 1);\n" +
    `})().catch((e) => { try { fs.writeFileSync(${JSON.stringify(opts.witness)} + '.err', String((e && e.stack) || e)); } catch (_) {} process.exit(3); });\n`;

  return [process.execPath, "-e", script];
}

function readWitness(file: string): WitnessSnapshot[] {
  assert.equal(existsSync(file + ".err"), false, "the witness wrapper never crashed: " + (existsSync(file + ".err") ? readFileSync(file + ".err", "utf8") : ""));
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as WitnessSnapshot[];
}

// ---------------------------------------------------------------------------
// Journal sinks (the tools-9.1/9.2/9.3/9.4a harness shape).
// ---------------------------------------------------------------------------

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

// A TEE onto the REAL adapter/journal.ts journal, which THROWS on any event outside the
// closed §7.4 vocabulary (core/journal-events.ts EVENTS): a handler that invented an
// event name fails loudly instead of quietly widening the vocabulary.
function makeRealJournal(
  runDir: string,
  config: Config,
): { sink: JournalSink; records: CaptureRecord[] } {
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
  return { sink, records };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The scope shape evidence.ts accepts (Config's own type omits the optional buildCommand
// the §2.1 build-before-test row uses; this file needs only command/itemTest).
interface FixtureScope {
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
}

function makeConfig(opts: {
  command: string[];
  itemTest?: string[];
  debugFixCap?: number;
}): Config {
  const scope: FixtureScope = {
    command: [...opts.command],
    timeoutMs: 120_000,
    ...(opts.itemTest !== undefined ? { itemTest: [...opts.itemTest] } : {}),
  };
  const scopes: Config["verify"]["scopes"] = { [SCOPE]: scope };
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
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: opts.debugFixCap ?? 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 2, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// ---------------------------------------------------------------------------
// Store / run / queue fixtures
// ---------------------------------------------------------------------------

function runsDirOf(root: string): string {
  return path.join(root, ".conductor", "runs");
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

// Drive a run to EXECUTING WITHOUT calling any other task's handler (direct on-disk
// seeding, the tools-9.2/9.3/9.4a discipline).
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

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

type VerifyRecord = Extract<EvidenceRecord, { kind: "verify" }>;

function verifyRecords(runDir: string): VerifyRecord[] {
  return readEvidence(runDir).filter((r): r is VerifyRecord => r.kind === "verify");
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

function markerPathOf(runDir: string, tree = "main"): string {
  return path.join(runDir, `verify-running-${tree}.json`);
}

// ---------------------------------------------------------------------------
// Fan-out wiring over the FAKE SDK (the 9.4a harness shape), with a per-role reply
// script. An UNSCRIPTED role replies with unparseable text, so a stray dispatch env-fails
// loudly instead of silently succeeding.
// ---------------------------------------------------------------------------

type CannedReply = string | ((promptText: string) => string);
type RoleScript = Record<string, CannedReply[]>;

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

// A §3.5 tree view that RECORDS every admission check. The engine consults isFrozen ONLY
// for a write-capable job, so this list is the observable witness of which dispatches
// claimed write capability. Never frozen, so nothing is ever held.
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

function makeWiring(runId: string, config: Config, journal: JournalSink, script: RoleScript): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: string }>();
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
    const queue = script[role] ?? [];
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

// The §2.10 IMPLEMENTER RESULT receipt every implementer dispatch replies with.
function implJson(status = "DONE", summary = `applied the minimal change (${IMPL_MARKER})`): string {
  return JSON.stringify({ status, summary, concerns: [], neededContext: null, blockReason: null });
}

// An implementer responder that WRITES files inside the repo and replies with the §2.10
// receipt — the fixture stand-in for a real write-capable sub-session's edit.
function implementerWrites(repo: string, files: Array<{ rel: string; content: string }>): CannedReply {
  return (): string => {
    for (const file of files) {
      const target = path.join(repo, file.rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    return implJson();
  };
}

// An implementer responder that changes NOTHING and claims DONE — the "done by assertion"
// receipt §3.3 says the handler must refuse. It also SNAPSHOTS the persisted item at the
// instant of the dispatch, which is how the DEBUG entry is proven to precede the model.
function implementerClaimsDone(sink: { snapshots: Item[] }, runDir: string, itemId: string): CannedReply {
  return (): string => {
    const file = path.join(runDir, "items", `${itemId}.json`);
    if (existsSync(file)) sink.snapshots.push(JSON.parse(readFileSync(file, "utf8")) as Item);
    return implJson();
  };
}

// ---------------------------------------------------------------------------
// Fixture sanity: the canned payload must satisfy the schema the fan-out engine validates
// it against, the queue fixtures must satisfy BOTH the §2.4 schema and core validateQueue,
// and the doctrine pack must be real. (The 9.1/9.2/9.3/9.4a probe-block discipline.)
// ---------------------------------------------------------------------------

const SANITY_CONFIG = makeConfig({ command: [process.execPath, "-e", "0"] });
const SANITY_QUEUE: Queue = {
  items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
};

assert.equal(
  validate("ImplementerResult", JSON.parse(implJson()) as unknown).ok,
  true,
  "sanity: the implementer receipt satisfies SCHEMAS.ImplementerResult",
);
assert.equal(validate("Queue", SANITY_QUEUE).ok, true, "sanity: the queue fixture satisfies SCHEMAS.Queue");
assert.equal(
  validateQueue(SANITY_QUEUE, SANITY_CONFIG).ok,
  true,
  "sanity: the queue fixture also satisfies core validateQueue (so an amendment refusal below is about the amendment)",
);
assert.equal(validate("Item", makeRuntimeItem("I1", "GREEN")).ok, true, "sanity: the runtime item fixture satisfies SCHEMAS.Item");
assert.ok(DEBUG_PACK.length > 400, "sanity: the REAL debug.md pack loaded through the committed loader is substantial");
assert.ok(
  DEBUG_PACK.includes("architecture"),
  "sanity: the loaded pack really is the debugging doctrine (its 3-fix rule escalates the architecture)",
);

// ===========================================================================
// [9.4b-green-requires-passing-test]
// ===========================================================================

test("[9.4b-green-requires-passing-test] conductor_mark_green re-runs the ITEM TEST ITSELF and DENIES on a non-zero exit: the implementer's DONE receipt does not advance the item, which stays at TEST_VETTED with no GREEN transition persisted", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const ownWitness = path.join(stateHome, "ran-own.txt");
  const config = makeConfig({
    command: wrapperCmd({ witness: path.join(stateHome, "w.json"), runsDir: runsDirOf(root), rels: [] }),
    itemTest: [process.execPath, "--test", "{files}"],
  });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "TEST_VETTED" });

  // The item's test is a REAL failing test; the implementer claims DONE and writes NOTHING.
  writeFileSync(path.join(root, "tests", "a.test.mjs"), failingTest(ownWitness, OWN_RED_MARKER));
  const snapshots: Item[] = [];
  const wiring = makeWiring(runId, config, journal.sink, {
    implementer: [implementerClaimsDone({ snapshots }, runDir, "I1")],
  });

  const res: MarkGreenResult = await handleMarkGreen({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    now: () => START_MS,
  });

  // The implementer WAS dispatched (write-capable, on the main tree) exactly once: a DONE
  // receipt is neither NEEDS_CONTEXT nor BLOCKED, so no ladder rung applies (P3).
  const implementers = wiring.byRole("implementer");
  assert.equal(implementers.length, 1, "exactly ONE implementer dispatch for a DONE receipt whose test still fails");
  assert.equal(wiring.prompted.length, 1, "no other role was dispatched");
  assert.equal(implementers[0].itemId, "I1", "the dispatch is correlated to the item");
  assert.equal(implementers[0].tree, "main", "the implementer works the main tree (worktrees land in 9.6)");
  assert.deepEqual(wiring.frozenChecks, ["main"], "the implementer dispatch is write-capable (freeze admission consulted once)");
  assert.ok(implementers[0].text.includes(TITLE_MARKER), "the implementer prompt carries the item spec");
  assert.ok(implementers[0].text.includes("src/a.mjs"), "the implementer prompt names the fileScope it may edit");

  // THE HANDLER ran the test — a real child process against a real failing file.
  assert.ok(existsSync(ownWitness), "the item's own test really was EXECUTED by the handler");
  const evidence = readEvidence(runDir);
  assert.equal(evidence.length, 1, "exactly ONE §2.6 record was appended: the handler's own run");
  assert.equal(evidence[0].kind, "red", "a failing item test is a §2.6 red, never a green");
  const red = evidence[0] as Extract<EvidenceRecord, { kind: "red" }>;
  assert.notEqual(red.exitCode, 0, "the run genuinely failed");
  assert.equal(red.targeted, true, "the §2.1 itemTest template produced a TARGETED run");
  assert.ok(red.failureExcerpt.includes(OWN_RED_MARKER), "the captured excerpt is this item's own failure");

  // Read from the PERSISTED item file, never from a log line: nothing advanced.
  const item = store.loadItem(runId, "I1");
  assert.equal(validate("Item", item).ok, true, "the unmoved item file still satisfies the §2.5 schema");
  assert.equal(item.state, "TEST_VETTED", "the item stays at TEST_VETTED — impl is not done by assertion (§3.3)");
  assert.equal(item.evidence.green, undefined, "no §2.6 green pointer was written");
  assert.equal(
    journal.records.filter((r) => r.component === "fsm" && r.event === "transition").length,
    0,
    "NO transition was journaled — the item never advanced",
  );

  assert.equal(res.ok, false, "the compact return reports the refusal to advance");
  assert.equal(res.itemState, "TEST_VETTED", "the compact return reports the persisted state");
  assert.equal(res.ranItemTest, true, "the handler ran the item test itself");
  assert.equal(res.exitCode, red.exitCode, "the compact return names the failing exit code");
  assert.notEqual(res.exitCode, 0, "the compact return's exit code is non-zero");
  assert.equal(res.attempts, 1, "the compact return reports the single implementer dispatch");
  assert.equal(snapshots.length, 1, "the dispatch-time snapshot was taken");
  assert.equal(snapshots[0].state, "TEST_VETTED", "the item was still at TEST_VETTED when the implementer was dispatched");
});

// ===========================================================================
// [9.4b-green-advances-on-exit-0]
// ===========================================================================

test("[9.4b-green-advances-on-exit-0] a passing item test advances TEST_VETTED→GREEN through core legalItemTransition, persists the §2.6 green pointer on the item, and journals the transition through the closed §7.4 vocabulary (driven through the REAL throwing journal)", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const ownWitness = path.join(stateHome, "ran-own.txt");
  const config = makeConfig({
    command: wrapperCmd({ witness: path.join(stateHome, "w.json"), runsDir: runsDirOf(root), rels: [] }),
    itemTest: [process.execPath, "--test", "{files}"],
  });
  // The STORE takes the capture sink; the HANDLER and the fan-out engine are driven
  // through the REAL journal, which THROWS on any off-vocabulary event.
  const storeJournal = makeJournal();
  const store = openStore(root, storeJournal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const journal = makeRealJournal(runDir, config);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "TEST_VETTED" });

  // A GREENFIELD test whose subject the implementer writes: red before the dispatch,
  // green after — so exit 0 is EARNED by a real edit, not by a pre-passing fixture.
  writeFileSync(path.join(root, "tests", "a.test.mjs"), greenfieldTest(ownWitness, "../src/a.mjs"));
  assert.equal(existsSync(path.join(root, "src", "a.mjs")), false, "premise: the subject does not exist before the implementer runs");

  const wiring = makeWiring(runId, config, journal.sink, {
    implementer: [implementerWrites(root, [{ rel: "src/a.mjs", content: SUBJECT_MODULE }])],
  });

  const res: MarkGreenResult = await handleMarkGreen({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    now: () => START_MS,
  });
  journal.sink.flushSync();

  assert.equal(wiring.byRole("implementer").length, 1, "one implementer dispatch produced the passing test");
  assert.ok(existsSync(ownWitness), "the item's own test really was EXECUTED");

  const evidence = readEvidence(runDir);
  assert.equal(evidence.length, 1, "exactly ONE §2.6 record was appended");
  assert.equal(evidence[0].kind, "green", "an exit-0 item test is a §2.6 green record");
  const green = evidence[0] as Extract<EvidenceRecord, { kind: "green" }>;
  assert.equal(green.exitCode, 0, "the green record carries the passing exit code");
  assert.equal(green.itemId, "I1", "the green record names the item");

  const item = store.loadItem(runId, "I1");
  assert.equal(validate("Item", item).ok, true, "the advanced item file still satisfies the §2.5 schema");
  assert.equal(item.state, "GREEN", "the item advanced TEST_VETTED→GREEN through core legalItemTransition");
  assert.equal(item.blocked, null, "a clean green blocks nothing");
  assert.ok(item.evidence.green !== undefined, "the item points at the green it advanced on");
  assert.equal(item.evidence.green?.seq, green.seq, "the §2.6 green pointer names the appended record's seq");
  assert.ok((item.evidence.green?.ledger ?? "").includes("evidence.jsonl"), "the pointer names the §2.6 ledger");

  // The REAL journal wrote the records: an unknown component/event would have thrown out
  // of the handler above, so this is the closed-vocabulary proof.
  const lines = readFileSync(path.join(runDir, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { component: string; event: string });
  assert.ok(lines.some((r) => r.component === "fsm" && r.event === "transition"), "the transition is journaled via fsm/transition");
  assert.ok(lines.some((r) => r.component === "evidence" && r.event === "green"), "the green evidence is journaled via evidence/green");
  assert.ok(
    journal.records.some((r) => r.component === "fsm" && r.event === "transition" && JSON.stringify(r).includes("GREEN")),
    "the journaled transition names the GREEN target",
  );

  assert.equal(res.ok, true, "the compact return reports the advance");
  assert.equal(res.itemState, "GREEN", "the compact return reports the persisted state");
  assert.equal(res.ranItemTest, true, "the handler ran the item test itself");
  assert.equal(res.exitCode, 0, "the compact return names the passing exit code");
  assert.equal(res.attempts, 1, "the compact return reports the single implementer dispatch");
  assert.equal(res.questionId, null, "a clean green mints no question");
  assert.equal(readQuestions(runDir).length, 0, "questions.jsonl stays empty");
});

// ===========================================================================
// [9.4b-green-nonbehavioral-from-pending]
// ===========================================================================

test("[9.4b-green-nonbehavioral-from-pending] conductor_mark_green from PENDING is LEGAL for a behavioral:false item and runs NO item test at all — the unexecuted-command sentinel is ABSENT and no §2.6 record exists — while a behavioral:true PENDING item is refused naming conductor_submit_test", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  // BOTH the targeted itemTest template AND the full scope command write this sentinel.
  // Its ABSENCE is the proof that neither ran (never a missing log line).
  const sentinel = path.join(stateHome, "item-test-ran.txt");
  const sentinelCmd = [
    process.execPath,
    "-e",
    `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran'); process.exit(0);`,
  ];
  const config = makeConfig({ command: sentinelCmd, itemTest: sentinelCmd });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  // N1 is behavioral:false with a fileScope PROVEN disjoint from verify.behavioralPaths
  // ("src/**") and no testScope; B1 is an ordinary behavioral item still at PENDING.
  const queue: Queue = {
    items: [
      makeQueueItem("N1", { fileScope: ["docs/notes.md"], testScope: [], behavioral: false }),
      makeQueueItem("B1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
    ],
  };
  seedExecuting(store, runId, queue);
  assert.equal(validateQueue(queue, config).ok, true, "premise: the non-behavioral item is a legal §2.4 item");
  const beforeB1 = itemFileBytes(runDir, "B1");

  const wiring = makeWiring(runId, config, journal.sink, {
    implementer: [implementerWrites(root, [{ rel: "docs/notes.md", content: "# notes\n" }])],
  });

  const res: MarkGreenResult = await handleMarkGreen({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "N1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    now: () => START_MS,
  });

  // The stage ran (the implementer did the work) …
  assert.equal(wiring.byRole("implementer").length, 1, "the non-behavioral item still gets its implementer dispatch");
  assert.ok(existsSync(path.join(root, "docs", "notes.md")), "the implementer's edit really landed");

  // … but NO item test was run: the sentinel is absent and the ledger holds nothing.
  assert.equal(existsSync(sentinel), false, "the unexecuted-command SENTINEL is absent: no item test command ever ran");
  assert.equal(readEvidence(runDir).length, 0, "no §2.6 record exists for the run at all");
  assert.equal(existsSync(path.join(runDir, "evidence.jsonl")), false, "evidence.jsonl was never even created");

  const item = store.loadItem(runId, "N1");
  assert.equal(validate("Item", item).ok, true, "the advanced item file still satisfies the §2.5 schema");
  assert.equal(item.state, "GREEN", "PENDING→GREEN is legal for a behavioral:false item (§2.4/§3.3)");
  assert.equal(item.evidence.green, undefined, "a non-behavioral advance points at no green record (none exists)");
  assert.equal(res.ok, true, "the compact return reports the advance");
  assert.equal(res.itemState, "GREEN", "the compact return reports the persisted state");
  assert.equal(res.ranItemTest, false, "the compact return says no item test was run");
  assert.equal(res.exitCode, null, "no exit code is reported for a test that never ran");

  // The mirror case: a BEHAVIORAL item at PENDING is refused, naming the legal path.
  await assert.rejects(
    handleMarkGreen({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "B1",
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      now: () => START_MS,
    }),
    (error: Error) => {
      assert.match(error.message, /conductor_submit_test/, "the deny names conductor_submit_test as the legal path");
      assert.match(error.message, /B1/, "the deny names the item it refused");
      return true;
    },
    "conductor_mark_green is illegal for a behavioral:true item at PENDING",
  );
  assert.equal(wiring.byRole("implementer").length, 1, "the refusal landed BEFORE any dispatch");
  assert.equal(existsSync(sentinel), false, "the refusal ran no command either");
  assert.equal(itemFileBytes(runDir, "B1"), beforeB1, "B1's item file is BYTE-IDENTICAL");
});

// ---------------------------------------------------------------------------
// The validate bench: item A at GREEN with its own (passing) test on disk, plus whatever
// foreign red files the case needs. Seeded directly on disk, never through a handler.
// ---------------------------------------------------------------------------

interface ValidateBench {
  root: string;
  stateHome: string;
  witness: string;
  ownWitness: string;
  config: Config;
  store: StateStore;
  runId: string;
  runDir: string;
  journal: { sink: JournalSink; records: CaptureRecord[] };
}

function seedValidateBench(opts: {
  queue: Queue;
  states: Record<string, ItemState>;
  watchRels: string[];
  ownTestPasses: boolean;
  probe?: (tree: string) => GateProbe;
  debugFixCap?: number;
}): ValidateBench {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const witness = path.join(stateHome, "witness.json");
  const ownWitness = path.join(stateHome, "ran-own.txt");
  const config = makeConfig({
    command: wrapperCmd({
      witness,
      runsDir: runsDirOf(root),
      rels: opts.watchRels,
      ...(opts.probe !== undefined ? { probe: opts.probe(root) } : {}),
    }),
    itemTest: [process.execPath, "--test", "{files}"],
    ...(opts.debugFixCap !== undefined ? { debugFixCap: opts.debugFixCap } : {}),
  });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  seedExecuting(store, runId, opts.queue, opts.states);

  // Item A's subject + its own test.
  writeFileSync(path.join(root, "src", "a.mjs"), SUBJECT_MODULE);
  writeFileSync(
    path.join(root, "tests", "a.test.mjs"),
    opts.ownTestPasses ? passingTest(ownWitness, "../src/a.mjs") : failingTest(ownWitness, OWN_RED_MARKER),
  );
  return { root, stateHome, witness, ownWitness, config, store, runId, runDir, journal };
}

// ===========================================================================
// [9.4b-validate-composes-runverify]
// ===========================================================================

test("[9.4b-validate-composes-runverify] conductor_validate reaches GREEN→VALIDATED through adapter/evidence.ts runVerify — the start-stamp, the recorded HEAD and the per-tree marker are all runVerify's, asserted by OBSERVING them (the marker was live during the run and is gone after), not by 9.4b re-implementing any of them", async () => {
  const bench = seedValidateBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
    states: { I1: "GREEN" },
    watchRels: ["tests/a.test.mjs"],
    ownTestPasses: true,
  });
  const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, { implementer: [] });
  const headBefore = headOf(bench.root);

  const res: ValidateResult = await handleValidate({
    store: bench.store,
    fanout: wiring.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
  });

  assert.equal(wiring.prompted.length, 0, "a green verify dispatches nobody");

  // The §2.6 verify record — appended by evidence.ts, that ledger's only writer.
  const verifies = verifyRecords(bench.runDir);
  assert.equal(verifies.length, 1, "exactly ONE §2.6 verify record was appended");
  const record = verifies[0];
  assert.equal(record.itemId, "I1", "the verify record names the item");
  assert.equal(record.green, true, "the required scope ran green");
  assert.equal(record.tree, "main", "the verify claimed the main tree");
  assert.equal(record.startedMs, START_MS, "the record carries runVerify's START-STAMP, taken from the injected clock");
  assert.match(record.head, HEX40, "the record carries a real recorded HEAD sha");
  assert.equal(record.head, headBefore, "the recorded HEAD is the tree's actual HEAD");
  assert.equal(record.branch, "main", "the record carries the real branch");
  assert.ok(Object.hasOwn(record.scopes, SCOPE), "the required scope was run and reported by name");
  assert.equal(record.scopes[SCOPE].green, true, "the scope's own outcome is green");

  // The MARKER: live while the scope ran (observed from inside the child), gone after.
  const snaps = readWitness(bench.witness);
  assert.equal(snaps.length, 1, "the scope ran exactly once");
  assert.deepEqual(
    snaps[0].markers,
    [`${bench.runId}/verify-running-main.json`],
    "the per-tree verify marker was LIVE, in this run's dir, while the scope ran",
  );
  assert.equal(existsSync(markerPathOf(bench.runDir)), false, "the marker is REMOVED when the verify completes");
  assert.deepEqual(snaps[0].present, ["tests/a.test.mjs"], "the item's OWN test was present in the tree throughout");

  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(validate("Item", item).ok, true, "the advanced item file still satisfies the §2.5 schema");
  assert.equal(item.state, "VALIDATED", "the item advanced GREEN→VALIDATED");
  assert.equal(item.debugging, null, "a green verify enters no DEBUG protocol");
  assert.equal(item.evidence.validated?.seq, record.seq, "the item points at the verify record it advanced on");
  assert.ok((item.evidence.validated?.ledger ?? "").includes("evidence.jsonl"), "the pointer names the §2.6 ledger");

  assert.equal(res.ok, true, "the compact return reports the advance");
  assert.equal(res.itemState, "VALIDATED", "the compact return reports the persisted state");
  assert.equal(res.green, true, "the compact return reports the green verify");
  assert.equal(res.verifySeq, record.seq, "the compact return names the verify record it rests on");
  assert.equal(res.debugFixes, 0, "a green verify spends no debug fix");
  assert.equal(res.questionId, null, "a green verify mints no question");
  assert.ok(
    bench.journal.records.some((r) => r.component === "evidence" && r.event === "verify"),
    "the verify evidence is journaled via evidence/verify (written by evidence.ts)",
  );
  assert.ok(
    bench.journal.records.some((r) => r.component === "fsm" && r.event === "transition" && JSON.stringify(r).includes("VALIDATED")),
    "the GREEN→VALIDATED transition is journaled via fsm/transition",
  );
});

// ===========================================================================
// [9.4b-validate-refuses-live-marker]
// ===========================================================================

test("[9.4b-validate-refuses-live-marker] a second conductor_validate against a tree holding a LIVE verify marker is DENIED naming the running verify: no scope runs, no §2.6 record is appended, the item does not move, and the HOLDER's marker is left byte-identical", async () => {
  const bench = seedValidateBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
    states: { I1: "GREEN" },
    watchRels: ["tests/a.test.mjs"],
    ownTestPasses: true,
  });
  const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, { implementer: [] });

  // A LIVE holder: this very process's pid (provably alive) and a start stamp that is not
  // over-age against the injected clock.
  const markerPath = markerPathOf(bench.runDir);
  const markerBytes = JSON.stringify({ pid: process.pid, startMs: START_MS });
  writeFileSync(markerPath, markerBytes);
  const itemBefore = itemFileBytes(bench.runDir, "I1");

  await assert.rejects(
    handleValidate({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
    }),
    (error: Error) => {
      assert.match(error.message, /verify/i, "the deny NAMES the running verify");
      assert.match(error.message, new RegExp(String(process.pid)), "the deny names the pid holding the tree");
      assert.match(error.message, /main/, "the deny names the tree that is held");
      return true;
    },
    "two verifies in one tree would each describe a tree the other was mutating (§3.3/§4.3)",
  );

  // Nothing ran and nothing was written.
  assert.equal(readWitness(bench.witness).length, 0, "NO scope ran: the witness wrapper was never invoked");
  assert.equal(readEvidence(bench.runDir).length, 0, "no §2.6 record was appended");
  assert.equal(existsSync(bench.ownWitness), false, "the item's own test never executed");
  assert.equal(readFileSync(markerPath, "utf8"), markerBytes, "the HOLDER's marker is byte-identical — never stolen or rewritten");
  assert.equal(itemFileBytes(bench.runDir, "I1"), itemBefore, "the item file is BYTE-IDENTICAL");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "GREEN", "the item did not advance");
  assert.equal(wiring.prompted.length, 0, "no sub-session was dispatched");
});

// ===========================================================================
// [9.4b-validate-freeze-denies-edits]
// ===========================================================================

test("[9.4b-validate-freeze-denies-edits] while the verify is in flight the freeze denies EVERY edit in that tree — an in-fileScope production edit AND an in-testScope test edit alike — asserted through the REAL edit gate against the LIVE marker, and the same two edits are allowed through the §5.3 wiring once the marker is gone", async () => {
  const bench = seedValidateBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
    states: { I1: "GREEN" },
    watchRels: ["tests/a.test.mjs"],
    ownTestPasses: true,
    // The probe runs INSIDE the verify (the marker is live) and asks the REAL pure gate.
    probe: (tree: string): GateProbe => ({
      tree,
      fileScope: ["src/**"],
      testScope: ["tests/**"],
      checks: [
        { role: "implementer", rel: "src/a.mjs" },
        { role: "test-writer", rel: "tests/a.test.mjs" },
      ],
    }),
  });
  const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, { implementer: [] });

  const res: ValidateResult = await handleValidate({
    store: bench.store,
    fanout: wiring.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
  });
  assert.equal(res.ok, true, "premise: the verify itself was green (the freeze is what is under test)");

  // (a) DURING the verify — the marker was live, and the REAL core gate denied BOTH edits.
  const snaps = readWitness(bench.witness);
  assert.equal(snaps.length, 1, "the scope ran once");
  assert.deepEqual(snaps[0].markers, [`${bench.runId}/verify-running-main.json`], "the marker was LIVE while the probe ran");
  const gate = snaps[0].gate;
  assert.ok(gate !== null, "the in-flight gate probe produced decisions");
  assert.equal(gate.length, 2, "both edits were adjudicated");
  for (const probe of gate) {
    assert.equal(probe.decision.action, "deny", `the freeze denies the ${probe.role}'s edit of ${probe.rel} while the verify is in flight`);
    assert.match(probe.decision.reason ?? "", /freeze|verify marker/i, "the denial is the FREEZE denial, not a scope denial");
  }
  assert.ok(
    gate.some((g) => g.rel === "src/a.mjs"),
    "a production file inside the item's fileScope is denied",
  );
  assert.ok(
    gate.some((g) => g.rel === "tests/a.test.mjs"),
    "a TEST file inside the item's testScope is denied too (the strict reading §4.2's quarantine safety argument requires)",
  );

  // (b) AFTER the verify — the marker is gone, so the SAME two edits pass the REAL §5.3
  // gate wiring (gateBeforeToolCall returns to allow, throws to deny).
  assert.equal(existsSync(markerPathOf(bench.runDir)), false, "the marker is gone once the verify completes");
  const registry = new Map<string, RegistryEntry>([
    ["ses_impl", { role: "implementer", itemId: "I1", tree: bench.root }],
    ["ses_writer", { role: "test-writer", itemId: "I1", tree: bench.root }],
  ]);
  const gateJournal = makeJournal();
  const callGate = (sessionID: string, rel: string, verifyInFlightTree: string | null): void => {
    gateBeforeToolCall({
      sessionID,
      toolName: "edit",
      args: { filePath: path.join(bench.root, rel) },
      editPath: path.join(bench.root, rel),
      registry,
      gitMode: "commit",
      runActive: true,
      branchPolicy: "pin",
      fileScope: ["src/**"],
      testScope: ["tests/**"],
      verifyInFlightTree,
      inlineClaimScope: null,
      journal: gateJournal.sink,
      corr: { runId: bench.runId, itemId: "I1" },
    });
  };
  callGate("ses_impl", "src/a.mjs", null);
  callGate("ses_writer", "tests/a.test.mjs", null);

  // …and the SAME wiring denies both while a marker for that tree is live, so the allow
  // above is about the freeze and nothing else.
  assert.throws(
    () => callGate("ses_impl", "src/a.mjs", bench.root),
    /freeze|verify marker/i,
    "the §5.3 wiring denies the production edit against a live marker",
  );
  assert.throws(
    () => callGate("ses_writer", "tests/a.test.mjs", bench.root),
    /freeze|verify marker/i,
    "the §5.3 wiring denies the test edit against a live marker",
  );
});

// ===========================================================================
// [9.4b-foreign-red-set-three-cases]
// ===========================================================================

test("[9.4b-foreign-red-set-three-cases] item A's validate goes green despite a foreign red, in three independent cases — (a) a wave sibling at RED, (b) a BLOCKED prior-wave item at RED, (c) a §2.11 stale-red registry entry left by an EARLIER RUN — with each foreign file proven MOVED OUT of the repo during the verify and RESTORED afterwards", async (t) => {
  // One sub-case per foreign source, so a handler that unions only some of them fails.
  interface ForeignCase {
    label: string;
    rel: string;
    marker: string;
    build: (bench: ValidateBench) => void;
    queue: Queue;
    states: Record<string, ItemState>;
  }

  const itemA = makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] });

  const cases: ForeignCase[] = [
    {
      label: "(a) a wave sibling at RED",
      rel: "tests/b.test.mjs",
      marker: SIBLING_RED_MARKER,
      build: (): void => undefined,
      queue: {
        items: [itemA, makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] })],
      },
      states: { I1: "GREEN", I2: "RED" },
    },
    {
      label: "(b) a BLOCKED prior-wave item at RED",
      rel: "tests/c.test.mjs",
      marker: BLOCKED_RED_MARKER,
      build: (bench: ValidateBench): void => {
        bench.store.setBlocked(bench.runId, "I3", {
          reason: "blocked on an unanswered question from the prior wave",
          stage: "TEST_VETTED",
        });
      },
      queue: {
        items: [itemA, makeQueueItem("I3", { fileScope: ["src/c.mjs"], testScope: ["tests/c.test.mjs"] })],
      },
      states: { I1: "GREEN", I3: "RED" },
    },
    {
      label: "(c) a §2.11 stale-red registry entry from an EARLIER RUN",
      rel: "tests/legacy.test.mjs",
      marker: STALE_RED_MARKER,
      build: (bench: ValidateBench): void => {
        // The registry is workspace-level and SURVIVES runs: no item in THIS run's queue
        // names this path, so the registry is the only witness that it is deliberately red.
        bench.store.addStaleRed({
          path: "tests/legacy.test.mjs",
          itemId: "I-OLD",
          runId: "r-20260101-old1",
          sinceMs: START_MS - 86_400_000,
          reason: "left red when an earlier run terminated below GREEN",
        });
      },
      queue: { items: [itemA] },
      states: { I1: "GREEN" },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.label, async () => {
      const bench = seedValidateBench({
        queue: testCase.queue,
        states: testCase.states,
        watchRels: ["tests/a.test.mjs", testCase.rel],
        ownTestPasses: true,
      });
      const foreignWitness = path.join(bench.stateHome, "ran-foreign.txt");
      const foreignAbs = path.join(bench.root, testCase.rel);
      const foreignContent = failingTest(foreignWitness, testCase.marker);
      writeFileSync(foreignAbs, foreignContent);
      testCase.build(bench);

      // CONTROL: the un-quarantined suite really IS red, so the green below means something.
      const control = controlSuite(bench.root);
      assert.notEqual(control.status, 0, "control: with the foreign red in the tree the whole-suite run FAILS");
      assert.ok(control.output.includes(testCase.marker), "control: it fails on the FOREIGN red specifically");
      rmSync(foreignWitness, { force: true });

      const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, { implementer: [] });
      const res: ValidateResult = await handleValidate({
        store: bench.store,
        fanout: wiring.fanout,
        runId: bench.runId,
        itemId: "I1",
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: "wkey",
        packs: PACKS,
        now: () => START_MS,
      });

      // The foreign red did not poison item A's verify.
      assert.equal(res.ok, true, "item A reaches VALIDATED despite the foreign red");
      assert.equal(res.green, true, "the verify itself is green");
      assert.equal(bench.store.loadItem(bench.runId, "I1").state, "VALIDATED", "the persisted item advanced");
      assert.ok(res.excluded.includes(testCase.rel), "the compact return reports the foreign path as quarantined");

      // Proven MOVED OUT of the repo during the verify — observed from inside the child,
      // never inferred from a manifest.
      const snaps = readWitness(bench.witness);
      assert.equal(snaps.length, 1, "the scope ran once");
      assert.deepEqual(
        snaps[0].present,
        ["tests/a.test.mjs"],
        "during the verify the foreign file was GONE from the repo and the item's OWN test was still there",
      );
      assert.equal(existsSync(foreignWitness), false, "the quarantined foreign red never EXECUTED");
      assert.ok(existsSync(bench.ownWitness), "the item's own test DID execute");

      // …and RESTORED afterwards, byte-for-byte.
      assert.ok(existsSync(foreignAbs), "the quarantined file is RESTORED to the repo when the verify completes");
      assert.equal(readFileSync(foreignAbs, "utf8"), foreignContent, "the restored file is byte-identical");

      const record = verifyRecords(bench.runDir)[0];
      assert.ok(record.excluded.includes(testCase.rel), "the §2.6 verify record lists the exclusion in force");
      assert.equal(
        record.excluded.includes("tests/a.test.mjs"),
        false,
        "the item's OWN test is NEVER in the exclusion set (§4.2)",
      );
    });
  }
});

// ===========================================================================
// [9.4b-own-red-still-fails-validate]
// ===========================================================================

test("[9.4b-own-red-still-fails-validate] the quarantine NEVER excludes the item's own tests: the SAME fixture with only the failing file's ownership flipped — item A's own test red, the sibling's green — fails A's validate, so a handler that quarantined everything red would pass one row and fail this one", async () => {
  const bench = seedValidateBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
      ],
    },
    states: { I1: "GREEN", I2: "RED" },
    watchRels: ["tests/a.test.mjs", "tests/b.test.mjs"],
    // The ONLY change from the row above: the failing file is item A's OWN test.
    ownTestPasses: false,
    debugFixCap: 1,
  });
  const siblingWitness = path.join(bench.stateHome, "ran-foreign.txt");
  writeFileSync(path.join(bench.root, "src", "b.mjs"), SUBJECT_MODULE);
  writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), passingTest(siblingWitness, "../src/b.mjs"));

  const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, {
    implementer: [implJson("DONE", `no change made (${IMPL_MARKER})`)],
  });

  const res: ValidateResult = await handleValidate({
    store: bench.store,
    fanout: wiring.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
  });

  assert.equal(res.ok, false, "item A's OWN red fails its validate");
  assert.equal(res.green, false, "the verify is red");
  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(item.state, "GREEN", "the item does NOT advance to VALIDATED");
  assert.equal(item.evidence.validated, undefined, "no §2.6 validated pointer was written");

  // The exclusion set covered the sibling and NEVER the item's own test…
  assert.ok(res.excluded.includes("tests/b.test.mjs"), "the sibling below GREEN was still quarantined");
  assert.equal(res.excluded.includes("tests/a.test.mjs"), false, "the item's OWN test was NOT quarantined");

  // …and the tree during the verify proves it: A's test was present and it RAN.
  const snaps = readWitness(bench.witness);
  assert.ok(snaps.length >= 1, "the scope ran at least once");
  assert.ok(
    snaps.every((s) => s.present.includes("tests/a.test.mjs")),
    "item A's own test was present in the repo for every verify run",
  );
  assert.ok(
    snaps.every((s) => !s.present.includes("tests/b.test.mjs")),
    "the sibling's red was moved OUT for every verify run",
  );
  assert.ok(existsSync(bench.ownWitness), "item A's own test EXECUTED");
  assert.equal(existsSync(siblingWitness), false, "the sibling's test never executed");

  for (const record of verifyRecords(bench.runDir)) {
    assert.equal(record.green, false, "every verify run failed on item A's own red");
    assert.equal(record.excluded.includes("tests/a.test.mjs"), false, "no verify run ever excluded the item's own test");
  }
});

// ===========================================================================
// [9.4b-no-template-wave-no-livelock]
// ===========================================================================

test("[9.4b-no-template-wave-no-livelock] TWO items in one wave whose verify scope has NO §2.1 itemTest template both reach GREEN: each one's no-template FALLBACK run quarantines the OTHER's red test, so neither is blocked by its sibling and the wave does not livelock", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const witness = path.join(stateHome, "witness.json");
  const ran1 = path.join(stateHome, "ran-1.txt");
  const ran2 = path.join(stateHome, "ran-2.txt");
  // NO itemTest template: every item test falls back to the full scope command (§2.1).
  const config = makeConfig({
    command: wrapperCmd({
      witness,
      runsDir: runsDirOf(root),
      rels: ["tests/one.test.mjs", "tests/two.test.mjs"],
    }),
  });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/one.mjs"], testScope: ["tests/one.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/two.mjs"], testScope: ["tests/two.test.mjs"] }),
    ],
  };
  seedExecuting(store, runId, queue, { I1: "TEST_VETTED", I2: "TEST_VETTED" });

  // Both items' tests are greenfield reds until their own subject is written.
  writeFileSync(path.join(root, "tests", "one.test.mjs"), greenfieldTest(ran1, "../src/one.mjs"));
  writeFileSync(path.join(root, "tests", "two.test.mjs"), greenfieldTest(ran2, "../src/two.mjs"));

  // CONTROL: the un-quarantined whole-suite run — which is exactly what a no-template
  // fallback runs — fails on BOTH tests. Without the quarantine neither item could ever
  // pass its own fallback, and the wave would livelock.
  const control = controlSuite(root);
  assert.notEqual(control.status, 0, "control: the whole-suite fallback is red while either sibling is red");
  rmSync(ran1, { force: true });
  rmSync(ran2, { force: true });

  const wiring1 = makeWiring(runId, config, journal.sink, {
    implementer: [implementerWrites(root, [{ rel: "src/one.mjs", content: SUBJECT_MODULE }])],
  });
  const first: MarkGreenResult = await handleMarkGreen({
    store,
    fanout: wiring1.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    now: () => START_MS,
  });

  assert.equal(first.ok, true, "item I1 reaches GREEN even though its sibling's test is still red");
  assert.equal(store.loadItem(runId, "I1").state, "GREEN", "I1's persisted state is GREEN");
  assert.ok(first.excluded.includes("tests/two.test.mjs"), "I1's fallback run quarantined the sibling's red test");
  assert.equal(first.excluded.includes("tests/one.test.mjs"), false, "I1's own test was never quarantined");
  const afterFirst = readWitness(witness);
  assert.equal(afterFirst.length, 1, "the fallback ran the full scope command exactly once");
  assert.deepEqual(afterFirst[0].present, ["tests/one.test.mjs"], "the sibling's test was GONE from the tree during I1's run");
  assert.ok(existsSync(ran1), "I1's own test executed");
  assert.equal(existsSync(ran2), false, "the quarantined sibling test never executed");
  assert.ok(existsSync(path.join(root, "tests", "two.test.mjs")), "the sibling's test is RESTORED afterwards");
  const firstRecord = readEvidence(runDir).at(-1);
  assert.equal(firstRecord?.kind, "green", "the fallback run produced a §2.6 green");
  assert.equal((firstRecord as Extract<EvidenceRecord, { kind: "green" }>).exitCode, 0, "the fallback run exited 0");

  // The SECOND item now runs with nothing excluded (its sibling is GREEN) and still passes.
  rmSync(ran1, { force: true });
  const wiring2 = makeWiring(runId, config, journal.sink, {
    implementer: [implementerWrites(root, [{ rel: "src/two.mjs", content: SUBJECT_MODULE }])],
  });
  const second: MarkGreenResult = await handleMarkGreen({
    store,
    fanout: wiring2.fanout,
    runId,
    itemId: "I2",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    now: () => START_MS,
  });

  assert.equal(second.ok, true, "item I2 reaches GREEN in the same wave — no livelock");
  assert.equal(store.loadItem(runId, "I2").state, "GREEN", "I2's persisted state is GREEN");
  assert.equal(
    second.excluded.includes("tests/one.test.mjs"),
    false,
    "I1 is GREEN now, so its test is no longer in the foreign red set",
  );
  const afterSecond = readWitness(witness);
  assert.equal(afterSecond.length, 2, "I2's fallback ran the full scope command once more");
  assert.deepEqual(
    [...afterSecond[1].present].sort(),
    ["tests/one.test.mjs", "tests/two.test.mjs"],
    "both tests were present for I2's run",
  );
  assert.ok(existsSync(ran1) && existsSync(ran2), "both tests executed and both passed");
  assert.equal(readEvidence(runDir).at(-1)?.kind, "green", "I2's fallback run produced a §2.6 green");
});

// ===========================================================================
// [9.4b-debug-entry-on-failure]
// ===========================================================================

test("[9.4b-debug-entry-on-failure] a failing validate enters the DEBUG protocol: item.debugging is persisted BEFORE the implementer speaks, with a hypothesis derived from the verify's OWN captured failure, the item does not advance, and doctrine debug.md is injected VERBATIM into the implementer's next dispatch", async () => {
  const bench = seedValidateBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
    states: { I1: "GREEN" },
    watchRels: ["tests/a.test.mjs"],
    ownTestPasses: false,
    debugFixCap: 1,
  });
  const snapshots: Item[] = [];
  const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, {
    implementer: [implementerClaimsDone({ snapshots }, bench.runDir, "I1")],
  });

  const res: ValidateResult = await handleValidate({
    store: bench.store,
    fanout: wiring.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
  });

  // The DEBUG entry precedes the model: the snapshot was taken by the responder AT the
  // dispatch, so a hypothesis found there cannot be a paraphrase of anything it said.
  const implementers = wiring.byRole("implementer");
  assert.equal(implementers.length, 1, "the failing verify dispatched the implementer for its ONE permitted fix");
  assert.equal(snapshots.length, 1, "the persisted item was snapshotted at the instant of the dispatch");
  const atDispatch = snapshots[0];
  assert.ok(atDispatch.debugging !== null, "item.debugging was ALREADY persisted when the implementer was dispatched");
  assert.ok((atDispatch.debugging?.hypothesis ?? "").length > 0, "the DEBUG entry carries a non-empty hypothesis");
  assert.ok(
    (atDispatch.debugging?.hypothesis ?? "").includes(SCOPE),
    "the hypothesis NAMES the failing scope read off the verify record — the verify's own captured failure, not a guess",
  );
  assert.equal(
    (atDispatch.debugging?.hypothesis ?? "").includes(IMPL_MARKER),
    false,
    "the first hypothesis carries nothing the model said (it had not spoken yet)",
  );
  assert.equal(atDispatch.state, "GREEN", "the item was still GREEN at the dispatch");

  // doctrine debug.md — the REAL pack content, loaded through the committed loader.
  assert.ok(
    implementers[0].text.includes(DEBUG_PACK),
    "the implementer's next dispatch carries doctrine debug.md VERBATIM (§4.1 delivers packs verbatim)",
  );
  assert.ok(implementers[0].text.includes(SCOPE), "the dispatch also carries the failing scope from the captured verify");
  assert.deepEqual(wiring.frozenChecks, ["main"], "the debug dispatch is WRITE-capable on the main tree");
  assert.equal(implementers[0].itemId, "I1", "the debug dispatch is correlated to the item");

  // The item did NOT advance, and the DEBUG annotation survives on disk.
  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(validate("Item", item).ok, true, "the debugging item file still satisfies the §2.5 schema");
  assert.equal(item.state, "GREEN", "a failed verify never advances the item");
  assert.ok(item.debugging !== null, "the persisted item still carries its DEBUG annotation");
  assert.equal(item.debugging?.sinceMs, START_MS, "the DEBUG entry is stamped from the injected clock");
  assert.equal(item.evidence.validated, undefined, "no §2.6 validated pointer was written");
  assert.equal(res.ok, false, "the compact return reports the failure to advance");
  assert.equal(res.green, false, "the compact return reports the red verify");
  assert.ok(verifyRecords(bench.runDir).length >= 1, "the failing verify is on the §2.6 ledger");
  assert.equal(verifyRecords(bench.runDir)[0].green, false, "the first verify record records the failure");
});

// ===========================================================================
// [9.4b-debug-cap-escalates]
// ===========================================================================

test("[9.4b-debug-cap-escalates] at config.workflow.debugFixCap failed fixes the item is BLOCKED and exactly ONE §2.11 question is written on the EXISTING origin 'debug-architecture' naming the failure that motivated it — pinned at TWO different caps so a hardcoded count fails", async (t) => {
  for (const cap of [2, 3]) {
    await t.test(`debugFixCap ${String(cap)}`, async () => {
      const bench = seedValidateBench({
        queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
        states: { I1: "GREEN" },
        watchRels: ["tests/a.test.mjs"],
        ownTestPasses: false,
        debugFixCap: cap,
      });
      assert.equal(bench.config.workflow.debugFixCap, cap, "premise: the knob is the configured cap");
      // A never-fixing implementer, so the loop can only end at the cap.
      const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, {
        implementer: [implJson("DONE", `tried a fix that did not work (${IMPL_MARKER})`)],
      });

      const res: ValidateResult = await handleValidate({
        store: bench.store,
        fanout: wiring.fanout,
        runId: bench.runId,
        itemId: "I1",
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: "wkey",
        packs: PACKS,
        now: () => START_MS,
      });

      // The bound is EXACT: the fix budget is spent, and not one fix more (P1).
      const implementers = wiring.byRole("implementer");
      assert.equal(implementers.length, cap, "exactly debugFixCap implementer dispatches — the full budget, never exceeded");
      assert.equal(wiring.prompted.length, cap, "no other role was dispatched");
      assert.equal(new Set(implementers.map((i) => i.sessionID)).size, cap, "each fix round is a dispatch of its own");
      assert.equal(
        verifyRecords(bench.runDir).length,
        cap + 1,
        "one initial verify plus one re-verify per fix (the initial failure is not a fix)",
      );
      for (const record of verifyRecords(bench.runDir)) {
        assert.equal(record.green, false, "every verify run stayed red");
      }
      for (const dispatch of implementers) {
        assert.ok(dispatch.text.includes(DEBUG_PACK), "every debug dispatch carries doctrine debug.md verbatim");
      }

      // The item is BLOCKED (an annotation — the FSM position does not move).
      const item = bench.store.loadItem(bench.runId, "I1");
      assert.equal(validate("Item", item).ok, true, "the blocked item file still satisfies the §2.5 schema");
      assert.equal(item.state, "GREEN", "the capped item stays at GREEN — it never reached VALIDATED");
      assert.ok(item.blocked !== null, "the capped item carries a blocked disposition");
      assert.equal(item.blocked?.stage, "VALIDATED", "the block names the stage it could not complete");
      assert.ok((item.blocked?.reason ?? "").includes("debugFixCap"), "the reason NAMES the knob that bounded the loop");
      assert.equal(item.attempts.debugFixes, cap, "the persisted counter equals the fully-spent debugFixCap budget");
      assert.equal(res.debugFixes, cap, "the compact return reports the spent fixes");

      // Exactly ONE §2.11 question, on the EXISTING origin (the vocabulary is CLOSED).
      const questions = readQuestions(bench.runDir);
      assert.equal(questions.length, 1, "exactly ONE question is written at the cap");
      const question: QuestionRecord = questions[0];
      assert.equal(validate("QuestionRecord", question).ok, true, "the question is a schema-valid §2.11 record");
      assert.equal(question.origin, DEBUG_ORIGIN, "origin is the EXISTING 'debug-architecture' (nothing is widened)");
      assert.deepEqual(question.blocksItems, ["I1"], "blocksItems names exactly this item");
      assert.equal(question.runId, bench.runId, "the question names its run");
      assert.equal(question.answeredIso, null, "the question starts open");
      assert.equal(question.answer, null, "the question starts unanswered");
      assert.equal(question.tsMs, START_MS, "the question is stamped from the injected clock");
      assert.ok(
        question.question.includes(SCOPE),
        "the question NAMES the failing scope that motivated the escalation (read off the verify records)",
      );
      assert.ok(
        question.question.includes(String(cap)),
        "the question names how many failed fixes motivated the escalation",
      );
      assert.equal(item.blocked?.questionId, question.id, "the block points at THAT question");
      assert.equal(res.questionId, question.id, "the compact return names the minted question");
      assert.equal(res.ok, false, "the compact return reports the failure to advance");
      assert.equal(
        bench.journal.records.filter((r) => r.component === "fsm" && r.event === "transition").length,
        0,
        "no transition was journaled — the capped item never advanced",
      );
    });
  }
});

// ---------------------------------------------------------------------------
// The queue-amend bench: an EXECUTING run whose queue.json holds one valid item.
// ---------------------------------------------------------------------------

interface AmendBench {
  root: string;
  config: Config;
  store: StateStore;
  runId: string;
  runDir: string;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  queue: Queue;
}

function seedAmendBench(): AmendBench {
  const root = committedRepo();
  const config = makeConfig({
    command: [process.execPath, "-e", "process.exit(0);"],
    itemTest: [process.execPath, "--test", "{files}"],
  });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "PENDING" });
  return { root, config, store, runId, runDir, journal, queue };
}

const SCORE = { capability: 4, testability: 4, movingParts: 3, validationEarliness: 4, singleSource: 4 };

// ===========================================================================
// [9.4b-amend-revalidates-queue]
// ===========================================================================

test("[9.4b-amend-revalidates-queue] conductor_queue_amend re-runs core validateQueue over the AMENDED queue and REFUSES a dependsOn cycle, an intersecting fileScope, and a behavioral/testScope violation — legality precedes persist, so on every refusal queue.json is byte-identical and NOTHING is written", async (t) => {
  const bad: Array<{ label: string; queue: Queue; expect: RegExp }> = [
    {
      label: "a dependsOn cycle",
      queue: {
        items: [
          makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"], dependsOn: ["I2"] }),
          makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"], dependsOn: ["I1"] }),
        ],
      },
      expect: /cycle/i,
    },
    {
      label: "a behavioral:false fileScope intersecting verify.behavioralPaths",
      queue: {
        items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: [], behavioral: false })],
      },
      expect: /behavioralPaths|intersect/i,
    },
    {
      label: "a behavioral:true item with an empty testScope",
      queue: {
        items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: [] })],
      },
      expect: /testScope/i,
    },
  ];

  for (const amendment of bad) {
    await t.test(amendment.label, () => {
      const bench = seedAmendBench();
      const before = readFileSync(path.join(bench.runDir, "queue.json"), "utf8");
      const beforeItem = itemFileBytes(bench.runDir, "I1");
      // The premise: core validateQueue — the SAME pure function 9.2 uses — rejects it.
      const verdict = validateQueue(amendment.queue, bench.config);
      assert.equal(verdict.ok, false, "premise: core validateQueue rejects this amendment");
      assert.match(verdict.violations.join(" | "), amendment.expect, "premise: it rejects it for the expected reason");

      assert.throws(
        () =>
          handleQueueAmend({
            store: bench.store,
            runId: bench.runId,
            config: bench.config,
            journal: bench.journal.sink,
            now: () => START_MS,
            queue: amendment.queue,
            question: "Amend the queue?",
            options: [
              { name: "amend", score: SCORE },
              { name: "leave-as-is", score: SCORE },
            ],
            choice: "amend",
            why: "the item turned out to be two items",
            appliedWhere: "queue.json",
          }),
        amendment.expect,
        "the refusal names the violation core validateQueue found",
      );

      assert.equal(readFileSync(path.join(bench.runDir, "queue.json"), "utf8"), before, "queue.json is BYTE-IDENTICAL");
      assert.equal(itemFileBytes(bench.runDir, "I1"), beforeItem, "the existing item file is BYTE-IDENTICAL");
      assert.equal(readDecisions(bench.runDir).length, 0, "no §2.7 record was appended on a refusal");
      assert.equal(existsSync(path.join(bench.runDir, "decisions.jsonl")), false, "decisions.jsonl was never created");
      assert.equal(readQuestions(bench.runDir).length, 0, "no question was written");
    });
  }
});

// ===========================================================================
// [9.4b-amend-records-decision]
// ===========================================================================

test("[9.4b-amend-records-decision] an accepted amendment persists the new queue AND appends ONE §2.7 kind:'derived' decision naming what changed, gated by the SAME core requireTwoOptions every other decision site runs — and an amendment carrying fewer than two scored options is rejected with NOTHING persisted", () => {
  const bench = seedAmendBench();

  // The re-split the §3.3 BLOCKED ladder asks for: one item becomes two.
  const amended: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
      makeQueueItem("I1b", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"], dependsOn: ["I1"] }),
    ],
  };
  assert.equal(validateQueue(amended, bench.config).ok, true, "premise: the amendment is a legal §2.4 queue");

  // (a) The <2-scored-options amendment is rejected FIRST, over the same valid queue, so
  //     the rejection is about the decision gate and nothing else.
  const beforeQueue = readFileSync(path.join(bench.runDir, "queue.json"), "utf8");
  assert.throws(
    () =>
      handleQueueAmend({
        store: bench.store,
        runId: bench.runId,
        config: bench.config,
        journal: bench.journal.sink,
        now: () => START_MS,
        queue: amended,
        question: "Split I1 into two items?",
        options: [{ name: "amend", score: SCORE }],
        choice: "amend",
        why: "the item turned out to be two items",
        appliedWhere: "queue.json",
      }),
    /option/i,
    "a kind:'derived' record with fewer than two scored options is refused by core requireTwoOptions",
  );
  assert.equal(readFileSync(path.join(bench.runDir, "queue.json"), "utf8"), beforeQueue, "queue.json is BYTE-IDENTICAL after the rejection");
  assert.equal(readDecisions(bench.runDir).length, 0, "NOTHING was persisted on the rejection");

  // (b) The accepted amendment.
  const res: QueueAmendResult = handleQueueAmend({
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    now: () => START_MS,
    queue: amended,
    question: "Split I1 into two items?",
    options: [
      { name: "split-I1-into-I1-and-I1b", score: SCORE },
      { name: "leave-as-is", score: SCORE },
    ],
    choice: "split-I1-into-I1-and-I1b",
    why: "I1 spans two acceptance clusters, so it is two items",
    appliedWhere: "queue.json",
  });

  assert.equal(res.ok, true, "the amendment is accepted");
  assert.deepEqual(res.itemIds, ["I1", "I1b"], "the compact return NAMES the amended queue's items");

  const persisted = JSON.parse(readFileSync(path.join(bench.runDir, "queue.json"), "utf8")) as Queue;
  assert.equal(validate("Queue", persisted).ok, true, "the persisted queue satisfies SCHEMAS.Queue");
  assert.deepEqual(persisted.items.map((i) => i.id), ["I1", "I1b"], "the AMENDED queue is what is on disk now");
  assert.deepEqual(persisted, amended, "the persisted queue is the amendment verbatim");

  const decisions = readDecisions(bench.runDir);
  assert.equal(decisions.length, 1, "exactly ONE §2.7 record is appended");
  const decision: DecisionRecord = decisions[0];
  assert.equal(validate("DecisionRecord", decision).ok, true, "the record is a schema-valid §2.7 DecisionRecord");
  assert.equal(decision.kind, "derived", "the amendment is a DERIVED decision");
  assert.equal(decision.id, res.decisionId, "the compact return names the appended record");
  assert.equal(decision.id, "D-0001", "the id comes from the existing torn-line-safe mint");
  assert.equal(decision.tsIso, new Date(START_MS).toISOString(), "the record is stamped from the injected clock");
  assert.equal(
    requireTwoOptions(decision).ok,
    true,
    "the record satisfies core/decide.ts requireTwoOptions (reused, never reimplemented)",
  );
  assert.ok(decision.options.length >= 2, "the record carries at least the two real arms");
  for (const option of decision.options) {
    assert.notEqual(option.score, undefined, "every option on a derived record is SCORED");
  }
  assert.ok(/leave-as-is/i.test(JSON.stringify(decision.options)), "the leave-as-is arm is recorded alongside the amendment");
  assert.ok(decision.choice.includes("I1b"), "the choice names what changed");
  assert.ok(
    bench.journal.records.some((r) => r.component === "state" && r.event === "decision.recorded"),
    "the decision is journaled through the EXISTING state/decision.recorded event (no new event name)",
  );
});

// ===========================================================================
// [9.4b-fix-stale-red-never-quarantines-own-test] — the mutation-testing fix.
//
// The row above proves the item's own test survives the QUEUE half of the §4.2
// union, but that half already skips the subject item, so removing the
// "never exclude the item's own tests" guard entirely left every row green. The
// guard is load-bearing only for the REGISTRY half — and that is the dangerous
// half: the stale-red registry SURVIVES RUNS, so an entry an earlier run wrote
// can name a path that is now THIS item's testScope. Quarantining it would take
// the item's own red out of its own verify and hand back a false green, which is
// exactly the cross-run poisoning §2.11 exists to stop.
// ===========================================================================

test("[9.4b-fix-stale-red-never-quarantines-own-test] a stale-red entry naming THIS item's own test is not quarantined: the item's own red still fails its verify, so a run cannot inherit a false green from an earlier run's registry", async () => {
  const bench = seedValidateBench({
    queue: {
      items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
    },
    states: { I1: "GREEN" },
    watchRels: ["tests/a.test.mjs"],
    ownTestPasses: false,
    debugFixCap: 0,
  });

  // An EARLIER run abandoned this very path — the registry is workspace-level and
  // outlives that run, so it is still here naming what is now I1's own test.
  bench.store.addStaleRed({
    path: "tests/a.test.mjs",
    itemId: "I9",
    runId: "r-earlier-run",
    sinceMs: START_MS - 86_400_000,
    reason: "item blocked at RED in an earlier run (test-repair exhausted)",
  });
  assert.ok(
    bench.store.readStaleRed().entries.some((e) => e.path === "tests/a.test.mjs"),
    "premise: the registry names the path that is now this item's own test",
  );

  const wiring = makeWiring(bench.runId, bench.config, bench.journal.sink, {
    implementer: [implJson("DONE", `no change made (${IMPL_MARKER})`)],
  });

  const res: ValidateResult = await handleValidate({
    store: bench.store,
    fanout: wiring.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
  });

  assert.equal(
    res.excluded.includes("tests/a.test.mjs"),
    false,
    "the registry entry is IGNORED for this item: §4.2's 'the item's OWN tests are never excluded' " +
      "outranks the registry union, whatever an earlier run recorded",
  );
  assert.equal(res.ok, false, "so the item's own red still fails its verify");
  assert.equal(res.green, false, "the verify is red");
  assert.equal(
    bench.store.loadItem(bench.runId, "I1").state,
    "GREEN",
    "and the item does NOT advance to VALIDATED on an inherited exclusion",
  );

  // The tree during the run is the proof, not the returned list.
  const snaps = readWitness(bench.witness);
  assert.ok(snaps.length >= 1, "the scope ran");
  assert.ok(
    snaps.every((s) => s.present.includes("tests/a.test.mjs")),
    "the item's own test was PRESENT in the repo for every verify run",
  );
  assert.ok(existsSync(bench.ownWitness), "and it EXECUTED");
});
