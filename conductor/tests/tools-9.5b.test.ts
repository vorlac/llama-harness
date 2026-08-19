// Task 9.5b RED tests — FINAL LOCATION conductor/tests/tools-9.5b.test.ts.
//
// SUBJECT (must NOT exist when this goes red):
//   (a) TWO handlers added to the EXISTING conductor/adapter/tools.ts (which today carries
//       the §5.3 gate wiring plus the Task 9.1/9.2/9.3/9.4a/9.4b handlers):
//         handlePublish  (conductor_publish, REVIEWED->PUBLISHED, the §3.3 five-step order)
//         handleReport   (conductor_report,  EXECUTING->REPORTED | EXECUTING->TRIVIAL_DONE)
//   (b) THREE new named exports from that same module:
//         demoteReviewedToGreen  (C-037 ruling 7 — the ONE administrative REVIEWED->GREEN
//                                 drop, shared with Task 9.6)
//         registerStaleRed       (C-037 ruling 4 — the ONE §2.11 stale-red registration
//                                 helper, shared with Task 9.5c's stop-report)
//         foreignRedSet          (already implemented and module-PRIVATE at tools.ts:3591;
//                                 this task EXPORTS it and widens its subject parameter to
//                                 `itemId: string | null`, so publish (subject = the item)
//                                 and report (subject = null) share ONE derivation)
//   (c) ONE new export from the committed pure core gate conductor/core/gates-phase.ts:
//         settledForReport       (C-037 ruling 1 — isSettled ∪ cannotEverPublish, exported
//                                 once and called by BOTH legalTools and handleReport)
//   (d) ONE new PURE core module conductor/core/commit-message.ts exporting
//         buildCommitMessage, hasDenylistedTrailer, TRAILER_DENYLIST
//       (the §3.3 step-5 template; covered by the Task 1.4 purity guard by construction,
//        since that guard globs conductor/core/).
//
// The RED is therefore TWO structural shapes plus ONE behavioural shape:
//   * missing-EXPORT reds from adapter/tools.ts and core/gates-phase.ts (both modules
//     resolve today; these bindings do not exist);
//   * a missing-MODULE red for core/commit-message.ts, which task-9.5b.assertions.json's
//     specGap ("commit-message template location") mandates as a NEW pure core module —
//     it cannot be faked from an existing module without putting an impure handler in the
//     import path of a pure template;
//   * ONE behavioural red: [9.5b-publish-nogit-refused] and [9.5b-report-nogit-reviewed-terminal]
//     assert NEW behaviour from the ALREADY-EXPORTED legalTools (the publishEnabled flag,
//     P2 below), so those rows fail as ASSERTION failures rather than unresolved imports —
//     exactly as 9.4a's deps-ready row and 9.4c's gate row did.
//
// Both handlers follow the §3.4 invariant loop — legality -> derive -> persist -> journal ->
// compact return — and (with the state store, the questions adapter and gitio they delegate
// to) are the only writers of run/item state (G6). BOTH dispatch ZERO model sub-sessions:
// they are mechanical handlers, and the fake SDK's ordered call log proves it. Git reads AND
// the new git writes go through adapter/gitio.ts's execFileSync-argv + scrubbed-GIT_ENV
// discipline (G14 — never a shell string); every fixture is a REAL on-disk `git init` repo
// and every verify is a REAL child process through adapter/evidence.ts.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.5b (2667-2686) — the authoritative behaviour of the two tools.
//   §3.3 (1288-1298)  — publish's five steps: branch check, stage fileScope ∪ testScope MINUS
//                       run.startDirty, §2.1 format rules, freshness re-check + auto
//                       re-verify, template commit; push only under commit-and-push; under
//                       read-only the prepared batch goes into the report instead.
//   §3.2 (1142-1155)  — report's precondition (every item PUBLISHED/blocked/deferred), its
//                       content, and "three modes, one implementation".
//   §3.9 (1502-1504)  — no-git mode: publish is DISABLED and items terminate at REVIEWED.
//   §4.2 (1572)/§4.3 (1627) — publish is serial in item order; the git index is a singleton.
//   §2.11 (1000-1010) — the workspace-level stale-red registry, which SURVIVES runs.
//   docs/build/specs/task-9.5b.assertions.json — the 30 rows mapped to the 30 tests below,
//                       its verifiedAgainstHead facts, its correctionsToDraft rulings, its
//                       reusesExisting list and its eleven specGaps.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.5b.assertions.json; this file is the contract
// that pins them):
//  (G1) THE SETTLED PREDICATE IS SHARED. core/gates-phase.ts exports
//         settledForReport(items: GateItem[], opts?: { publishEnabled?: boolean })
//           -> { allSettled: boolean; unsettled: string[] }   // unsettled ids, SORTED
//       whose rule is the committed one, verbatim: an item is settled iff
//       isSettled(item) (PUBLISHED | blocked | deferred) OR cannotEverPublish(items) holds
//       it — plus, when publishEnabled === false ONLY, an item at REVIEWED (§3.9's terminal
//       disposition). `allSettled` is `items.length > 0 && every settled`, byte-identical to
//       the expression at gates-phase.ts:356. legalTools calls it; handleReport calls it.
//  (G2) READ-ONLY AND NO-GIT ARE DIFFERENT MODES (C-037 ruling 2). read-only: publish RUNS
//       (steps 1-4 in full), mutates NOTHING in git, writes the prepared batch, and the item
//       still reaches PUBLISHED. no-git (gitio.isRepo(root) === false): publish is DISABLED —
//       the gate does not offer it and the handler refuses it — and REVIEWED is terminal.
//  (G3) THE PREPARED BATCH IS A runDir ARTIFACT, NEVER A JOURNAL PAYLOAD (C-037 ruling 3):
//       runs/<runId>/publish-batch.jsonl, ONE JSON line per PUBLISHED item, appended by
//       handlePublish in every git mode (none at all in no-git, where publish is refused)
//       and read by handleReport. Line shape (a recorded §1.2:426-437 layout deviation; NOT
//       registered in SCHEMAS — that would be a closed-vocabulary widening):
//         { itemId, tsMs, mode, files: string[], skipped: string[], diff: string,
//           suggestedMessage: string, verify: { seq: number; green: boolean; head: string } }
//  (G4) THE DEMOTION IS ADMINISTRATIVE, NOT AN FSM EDGE (C-037 ruling 7):
//         demoteReviewedToGreen({ store, runId, itemId, journal, reason, hypothesis, now? })
//           -> Item   // the PERSISTED item
//       writes through the store (saveItem + setDebugging) and journals `state: item.updated`.
//       It NEVER journals `fsm: transition`, never consults legalItemTransition, and
//       ITEM_STATES / core/fsm-item.ts are NOT widened. Task 9.6's merge-conflict demotion
//       calls this same helper; the module defines it exactly once.
//  (G5) THE STALE-RED REGISTRATION IS ONE HELPER (C-037 ruling 4):
//         registerStaleRed({ store, runId, queue, reason, now? }) -> string[]  // NEW paths, sorted
//       registers, through store.addStaleRed, every testScope path of every item strictly
//       below GREEN whose file EXISTS on disk and which the registry does not already carry,
//       and returns exactly the NEW additions. handleReport calls it; 9.5c's stop-report
//       calls the same one.
//  (G6) THE COMMIT-MESSAGE TEMPLATE IS PURE AND LIVES IN core/commit-message.ts:
//         buildCommitMessage(item: { id; title; rationale }, redProof: RedProof | null) -> string
//         TRAILER_DENYLIST: readonly string[]
//         hasDenylistedTrailer(message: string) -> boolean
//       hasDenylistedTrailer is true iff some line, after optional leading whitespace, starts
//       (case-insensitively) with a TRAILER_DENYLIST token, or the message contains U+1F916
//       anywhere. The four tokens are "Co-Authored-By", "Signed-off-by", "Generated with"
//       and U+1F916.
//  (G7) THE CLOSING VERIFY HAS NO SUBJECT ITEM. It runs through evidence.runVerify with the
//       RUN id as the record's itemId (core/types.ts:945 makes itemId REQUIRED on every
//       evidence record), tree "main", scopePattern "**", and `excluded` computed by
//       foreignRedSet(store, runId, queue, null) — the SAME derivation publish uses with the
//       subject item, never a re-implementation.
//  (G8) REPORT'S STEP ORDER is: (1) the NON-VERIFY all-settled presence check over the
//       PERSISTED items; (2) the fresh closing verify, whose exclusions are computed from the
//       registry AS IT IS BEFORE this report registers anything; (3) registerStaleRed;
//       (4) report.md; (5) the run-FSM close + stop record.
//  (G9) FORMAT-RULE INVOCATION (§2.1): first matching rule per file wins. `stdin` mode feeds
//       the file's bytes to the child's stdin and replaces the file with its stdout (no path
//       argument — a pure filter); `check` mode APPENDS the file path to the command's argv
//       and treats a non-zero exit as "unformatted", with no auto-fix attempted.
//  (G10) REPORT-LITE is a CONTENT mode of the SAME writer, never a relaxation: it drops the
//        sections a trivial run never created (no plan-review summary; an EMPTY decision
//        ledger is omitted rather than rendered "(none)"). 9.5c adds only the stop mode.
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) DENIAL CONVENTION, extending 9.4b's P2. A LEGALITY refusal THROWS — the illegal
//       stage tool (wrong run state, blocked/deferred/deps-unready item, an item the gate
//       does not offer conductor_publish), the no-git publish refusal, and handleReport's
//       all-settled precondition failure. A STEP denial — the call ran and the item did not
//       publish — RETURNS { ok: false, denial: <non-null message> }: the HEAD mismatch, the
//       preexistingDirty "refuse" conflict, a format check/crash failure, a failing auto
//       re-verify, and a denylisted commit message. Nothing is half-written on either path.
//  (P2) publishEnabled IS DERIVED, NOT CONFIGURED. Config has no `noGit` field (core/types.ts
//       143-147) and git.mode "read-only" cannot distinguish the two modes, so both handlers
//       compute `publishEnabled = gitio.isRepo(store.root)` and thread it into legalTools as
//       an OPTIONAL FIFTH parameter (default true, so no committed call site changes and the
//       committed gates-phase tests still pass). nextStageTool returns null for REVIEWED when
//       publish is disabled, so the gate can never offer a tool the handler would refuse.
//  (P3) REPORT.MD SKELETON (pinned so the content rows are checkable). Section headings, in
//       this order, each `## ` at column 0:
//         Items / Open questions / Decisions / Stale-red additions / Exclusions / Metrics /
//         Prepared batches
//       An empty section renders the single line "(none)" (except: an empty Decisions section
//       is OMITTED ENTIRELY in lite mode, G10; the Metrics section renders "(unavailable)"
//       when the §7.2 fetch returns null). Each item is a `### <itemId> — <state>` subsection
//       carrying the lines "Disposition:", "Red proof: seq <n> — <command>", "Review rounds:
//       <n>", "Taints:" and, for a blocked/deferred item, "Reason: <reason>". "Prepared
//       batches" carries each publish-batch line's suggested message, file list and its diff
//       VERBATIM. report.md is written to runs/<runId>/report.md through state.ts's exported
//       writeFileAtomicSync (so no half-written report survives a crash and no .tmp is left).
//  (P4) SEAMS. Both handlers take the injected Fanout (and never use it), an injected clock
//       `now`, and handleReport takes `metrics?: () => Promise<MetricsSummary | null>` —
//       Task 7.2's fetchMetricsSummary is STUBBED in tests, never reimplemented and never
//       reached over a socket. handlePublish takes `messageBuilder?` defaulting to core
//       buildCommitMessage, which is the seam the handler-side denylist row injects through.
//  (P5) A commit message is compared to the template THROUGH GIT'S OWN CLEANUP
//       (--cleanup=default: per-line trailing whitespace stripped, runs of blank lines
//       collapsed, leading/trailing blank lines dropped). That normalization is git's, not
//       the template's; any CONTENT difference still fails. The template must not emit a
//       "#"-leading line, which git would delete outright.
//  (P6) The auto re-verify and the closing verify are the ONLY verifies these handlers run.
//       "Exactly one" is asserted by COUNTING the §2.6 verify records the call appended.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). ONE options object
// each; runDir is derived as <store.root>/.conductor/runs/<runId>/; the fixture repo IS
// <store.root>. `journal` is the leveled sink (adapter/journal.ts Journal-compatible);
// `now` defaults to Date.now. `stateHome`/`workspaceKey` are the OUT-OF-REPO §4.2 quarantine
// coordinates the committed quarantine.ts already takes.
//
//   handlePublish(input: {
//     store: StateStore; fanout: Fanout; runId: string; itemId: string; config: Config;
//     journal: JournalSink; stateHome: string; workspaceKey: string; now?: () => number;
//     messageBuilder?: (item: QueueItem, redProof: RedProof | null) => string;
//   }): Promise<PublishResult>
//
//   handleReport(input: {
//     store: StateStore; fanout: Fanout; runId: string; config: Config;
//     journal: JournalSink; stateHome: string; workspaceKey: string; now?: () => number;
//     metrics?: () => Promise<MetricsSummary | null>;
//   }): Promise<ReportResult>
//
// (the two result shapes are restated structurally below, the 9.4a/9.4b/9.4c convention, so
//  every call site type-checks the green implementation against this file's contract.)
//
// Assertion id -> test (each test name carries its id as its FIRST token):
//   9.5b-publish-head-mismatch-denies          9.5b-report-settled-predicate-shared
//   9.5b-publish-serial-index-singleton        9.5b-report-allsettled-nonverify
//   9.5b-publish-stage-refuse                  9.5b-report-precondition-lite
//   9.5b-publish-stage-exclude                 9.5b-report-nogit-reviewed-terminal
//   9.5b-publish-format-stdin                  9.5b-report-fresh-closing-verify
//   9.5b-publish-format-crash-denies           9.5b-report-md-per-item
//   9.5b-publish-freshness-fresh-skips-reverify 9.5b-report-md-decision-ledger
//   9.5b-publish-stale-triggers-one-reverify   9.5b-report-md-stale-red-listed
//   9.5b-publish-reverify-exclusion-identity   9.5b-stale-red-registration-helper
//   9.5b-publish-reverify-fail-demotes         9.5b-report-md-questions-exclusions-metrics
//   9.5b-demotion-helper-item-updated          9.5b-report-stop-done
//   9.5b-publish-message-template-pure         9.5b-report-trivial-lite
//   9.5b-publish-denylist-generator-side
//   9.5b-publish-denylist-handler-rejects
//   9.5b-publish-push-leg
//   9.5b-publish-readonly-runs
//   9.5b-publish-nogit-refused
//   9.5b-batch-artifact-not-journal

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";

// THE SUBJECTS — absent at red time.
import {
  demoteReviewedToGreen,
  foreignRedSet,
  handlePublish,
  handleReport,
  registerStaleRed,
} from "../adapter/tools.ts";
import { settledForReport } from "../core/gates-phase.ts";
import { buildCommitMessage, hasDenylistedTrailer, TRAILER_DENYLIST } from "../core/commit-message.ts";

// Adapters + core that DO exist today.
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { appendQuestion, readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { quarantineDirFor } from "../adapter/quarantine.ts";
import { currentBranch, headSha, isRepo, stagedFiles } from "../adapter/gitio.ts";
import type { MetricsSummary } from "../adapter/router-client.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateQuestion, GateRun, LegalToolsResult } from "../core/gates-phase.ts";
import { legalItemTransition } from "../core/fsm-item.ts";
import { legalRunTransition } from "../core/fsm-run.ts";
import { verifyFreshFor } from "../core/freshness.ts";
import { validate } from "../core/types.ts";
import { MAIN_TREE, treePath } from "../core/types.ts";
import type {
  ClassificationKind,
  Config,
  DecisionRecord,
  EvidenceRecord,
  Item,
  ItemState,
  Queue,
  QueueItem,
  RunState,
  TreePath,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY (the 9.4a/9.4b/9.4c convention).
// ---------------------------------------------------------------------------

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

// The §2.6 red evidence the §3.3 step-5 template cites. A real red EvidenceRecord assigns
// to it structurally, so the template can never be handed a paraphrase.
interface RedProof {
  seq: number;
  command: string[];
  failureExcerpt: string;
}

interface PublishResult {
  ok: boolean; // true IFF the item advanced REVIEWED->PUBLISHED
  itemState: ItemState; // the PERSISTED state after the call
  denial: string | null; // non-null IFF ok === false (P1)
  commit: string | null; // the created commit sha; null under read-only and on every denial
  pushed: boolean; // true IFF the commit-and-push push leg ran
  message: string | null; // the template-built message (null when denied before step 5)
  staged: string[]; // the prepared/staged path set, sorted
  skipped: string[]; // preexistingDirty "exclude" paths publish skipped
  reverified: boolean; // true IFF a STALE freshness verdict triggered the auto re-verify
  verifySeq: number | null; // the §2.6 verify record the publish rests on
  excluded: string[]; // the §4.2 exclusions the auto re-verify applied ([] when none ran)
  questionId: string | null; // the "scope-conflict" question minted by refuse mode
}

interface ReportResult {
  runState: RunState; // the PERSISTED run state after the call
  mode: "full" | "lite"; // §3.2:1155's content mode — one writer, one parameter
  reportPath: string; // runs/<runId>/report.md
  verifySeq: number | null; // the closing verify's §2.6 record
  green: boolean; // the closing verify's verdict
  excluded: string[]; // the closing verify's exclusion list
  staleRedAdded: string[]; // the NEW §2.11 registrations this terminal path made, sorted
  metricsAvailable: boolean; // false when the §7.2 fetch returned null (fail-soft)
  stop: { kind: string; reasonDisplay: string; tsMs: number } | null;
}

interface SettledForReportResult {
  allSettled: boolean;
  unsettled: string[];
}

// P2: legalTools gains an OPTIONAL fifth parameter. A 4-parameter function is assignable to
// this 5-parameter type today, so this alias compiles against HEAD *and* against the green
// implementation — which is exactly what makes the two no-git rows fail as ASSERTION
// failures at red time rather than as unresolved imports.
type LegalToolsFn = (
  run: GateRun,
  items: GateItem[],
  questions: GateQuestion[],
  repoConfigured: boolean,
  publishEnabled?: boolean,
) => LegalToolsResult;

const gate: LegalToolsFn = legalTools;

// G3: the publish-batch artifact line.
interface PublishBatchLine {
  itemId: string;
  tsMs: number;
  mode: string;
  files: string[];
  skipped: string[];
  diff: string;
  suggestedMessage: string;
  verify: { seq: number; green: boolean; head: string };
}

type RedEvidence = Extract<EvidenceRecord, { kind: "red" }>;
type VerifyEvidence = Extract<EvidenceRecord, { kind: "verify" }>;

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a value
// DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-9512";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-9512";
const RED_MARKER = "CAPTURED-RED-MARKER-9512";
const WIP_MARKER = "USER-WIP-MARKER-9512";
const TAINT_MARKER = "TAINT-MARKER-9512";
const BLOCK_MARKER = "BLOCKED-REASON-MARKER-9512";
const DEFER_MARKER = "DEFERRED-REASON-MARKER-9512";
const QUESTION_MARKER = "OPEN-QUESTION-MARKER-9512";
const DECISION_MARKER = "DECISION-WHY-MARKER-9512";
const STALE_RED_MARKER = "STALE-RED-MARKER-9512";
const BIG_MARKER = "BIG-DIFF-MARKER-9512";
const FOREIGN_RED_MARKER = "FOREIGN-RED-MARKER-9512";

// The verify scope names are deliberately distinctive so a hardcoded "unit" cannot satisfy
// them. BROKEN_SCOPE is the "the TREE is red, not the item" scope.
const SCOPE = "unit9512";
const BROKEN_SCOPE = "tree9512";

// A fixed injected clock for the state store (run ids, lock stamps, annotation timestamps).
const START_MS = 1_754_990_000_000;

// The §4.2 shared tree under parallel.writes "off".
const TREE = MAIN_TREE;

const WORKSPACE_KEY = "wkey9512";

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom).
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

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tmpDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-tools95b-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

// A committed fixture repo, so a verify records a REAL HEAD sha and branch "main".
// The author identity is written into the repo's OWN config, not just into this file's
// GIT_ENV: the handler's commit runs under adapter/gitio.ts's environment (which inherits
// process.env and strips only the repo-location overrides), so a machine with no global
// identity would otherwise fail the commit for a reason that has nothing to do with 9.5b.
function committedRepo(): TreePath {
  const dir = tmpDir("repo");
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

// A workspace that is NOT a git repository (§3.9 no-git mode).
function plainDir(): TreePath {
  const dir = tmpDir("nogit");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  return treePath(dir);
}

function commitCount(dir: string): number {
  return Number.parseInt(git(dir, ["rev-list", "--count", "HEAD"]).trim(), 10);
}

function headBody(dir: string): string {
  return git(dir, ["log", "-1", "--format=%B"]);
}

// P5: `git commit` stores the message through its own cleanup (--cleanup=default):
// trailing whitespace goes from every line, runs of blank lines collapse to one, and
// leading/trailing blank lines are dropped. That normalization belongs to git, not to the
// §3.3 template, so BOTH sides of the message comparison are read through it — any
// CONTENT difference still fails. (A template that emitted a "#"-leading line would still
// fail, because git deletes those outright: the template must not emit one.)
function gitCleanup(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  while (out.length > 0 && out[0] === "") out.shift();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// The name-status of ONE commit: what actually shipped in it.
function commitNameStatus(dir: string, ref = "HEAD"): string[] {
  return git(dir, ["diff-tree", "--no-commit-id", "--name-status", "-r", ref])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t")[1]);
}

function blobAt(dir: string, ref: string, rel: string): string {
  return git(dir, ["show", `${ref}:${rel}`]);
}

// A child `node --test` run with the test-runner context STRIPPED, so a control run inside
// this suite is a fresh top-level invocation (the evidence.ts discipline).
function runNodeTest(cwd: string, rel: string): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, ["--test", rel], { cwd, env, encoding: "utf8" });
  return { status: res.status, output: `${res.stdout ?? ""}\n${res.stderr ?? ""}` };
}

// ---------------------------------------------------------------------------
// Journal sinks (the tools-9.1/9.2/9.3/9.4a/9.4b/9.4c harness shape).
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
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

// A TEE onto the REAL adapter/journal.ts journal, which THROWS on any event outside the
// closed §7.4 vocabulary (core/journal-events.ts EVENTS) and writes journal.jsonl to disk —
// the ledger the batch-artifact row greps for the diff it must NOT contain.
function makeRealJournal(runDir: string, config: Config): { sink: JournalSink; records: CaptureRecord[] } {
  const real: Journal = createJournal(runDir, config, {});
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
      real.log(level as "error" | "warn" | "info" | "debug" | "trace", component, event, data, {
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

function recordsFor(records: CaptureRecord[], component: string, event?: string): CaptureRecord[] {
  return records.filter((r) => r.component === component && (event === undefined || r.event === event));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The trivially-green verify scope command: real spawn, no work.
const GREEN_CMD = [process.execPath, "-e", "0"];
// The "the tree is broken" scope command.
const RED_CMD = [process.execPath, "-e", "process.exit(1)"];

interface ConfigOpts {
  gitMode?: Config["git"]["mode"];
  branchPolicy?: Config["git"]["branchPolicy"];
  preexistingDirty?: Config["git"]["preexistingDirty"];
  formatRules?: Config["format"]["rules"];
  scopeCommand?: string[];
  brokenScope?: boolean;
}

function makeConfig(opts: ConfigOpts = {}): Config {
  const scopes: Config["verify"]["scopes"] = {
    [SCOPE]: { command: [...(opts.scopeCommand ?? GREEN_CMD)], timeoutMs: 120_000 },
  };
  const scopeNames = [SCOPE];
  if (opts.brokenScope === true) {
    scopes[BROKEN_SCOPE] = { command: [...RED_CMD], timeoutMs: 120_000 };
    scopeNames.push(BROKEN_SCOPE);
  }
  return {
    version: 1,
    verify: {
      scopes,
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: scopeNames }],
    },
    format: { rules: opts.formatRules ?? [] },
    git: {
      mode: opts.gitMode ?? "commit",
      branchPolicy: opts.branchPolicy ?? "pin",
      preexistingDirty: opts.preexistingDirty ?? "exclude",
    },
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
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
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

interface Bench {
  root: TreePath;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  sdk: ReturnType<typeof makeFakeSdk>;
  fanout: Fanout;
  queue: Queue;
}

interface BenchOpts {
  queue: Queue;
  states: Record<string, ItemState>;
  config?: Config;
  classification?: ClassificationKind;
  repo?: boolean;
  // Files created and COMMITTED before the run exists (so they are clean at run start).
  seed?: (root: string) => void;
  // Worktree dirt established BEFORE the run exists, so it lands in run.startDirty.
  dirty?: (root: string) => void;
}

// The §3.5 tree view the fan-out engine is built over. These handlers dispatch nothing, so
// nothing is ever admitted through it; it exists because createFanout requires one.
const OPEN_TREE: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
): { sdk: ReturnType<typeof makeFakeSdk>; fanout: Fanout } {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  // A responder that would answer ANY prompt: the "zero dispatches" rows are then about the
  // handler never asking, not about the fixture being unable to reply.
  sdk.setResponder(() => ({ kind: "reply", text: "{}" }));
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );
  return { sdk, fanout };
}

function makeBench(opts: BenchOpts): Bench {
  const config = opts.config ?? makeConfig();
  const useRepo = opts.repo ?? true;
  const root = useRepo ? committedRepo() : plainDir();
  if (opts.seed !== undefined) {
    opts.seed(root);
    if (useRepo) {
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "fixture seed"]);
    }
  }
  if (opts.dirty !== undefined) opts.dirty(root);

  const stateHome = tmpDir("state");
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const run = store.createRun({
    prompt: USER_PROMPT,
    sessionID: "ses_orchestrator",
    classification: {
      kind: opts.classification ?? "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  const runId = run.runId;
  const runDir = path.join(store.root, ".conductor", "runs", runId);

  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(opts.queue, null, 2));
  for (const qi of opts.queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, opts.states[qi.id] ?? "PENDING"));
  }

  const wiring = makeWiring(runId, config, journal.sink);
  return {
    root,
    stateHome,
    store,
    runId,
    runDir,
    config,
    journal,
    sdk: wiring.sdk,
    fanout: wiring.fanout,
    queue: opts.queue,
  };
}

// ---------------------------------------------------------------------------
// Ledger helpers
// ---------------------------------------------------------------------------

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function verifyRecords(runDir: string): VerifyEvidence[] {
  return readEvidence(runDir).filter((r): r is VerifyEvidence => r.kind === "verify");
}

function nextSeqOf(runDir: string): number {
  return readEvidence(runDir).reduce((max, r) => Math.max(max, r.seq), 0) + 1;
}

function appendEvidenceLine(runDir: string, record: EvidenceRecord): EvidenceRecord {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  return record;
}

// Seed a §2.6 RED for an item and point the item's evidence at it (the red proof the §3.3
// step-5 template cites).
function seedRed(bench: Bench, itemId: string, testRel: string): RedEvidence {
  const record: RedEvidence = {
    seq: nextSeqOf(bench.runDir),
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", testRel],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER} (${itemId})\n\n7 !== -7`,
    failureClass: "assertion",
    targeted: true,
  };
  appendEvidenceLine(bench.runDir, record);
  const item = bench.store.loadItem(bench.runId, itemId);
  item.evidence.red = { ledger: "evidence.jsonl", seq: record.seq };
  bench.store.saveItem(bench.runId, item);
  return record;
}

// Seed the §2.6 VERIFY the item was VALIDATED on, and point the item at it. `startedMs` is
// the freshness lever: a future stamp is FRESH for every mtime term, a past one is STALE.
function seedValidated(
  bench: Bench,
  itemId: string,
  opts: { startedMs: number; head?: string; branch?: string; green?: boolean; excluded?: string[] },
): VerifyEvidence {
  const record: VerifyEvidence = {
    seq: nextSeqOf(bench.runDir),
    ts: START_MS,
    kind: "verify",
    itemId,
    startedMs: opts.startedMs,
    head: opts.head ?? (isRepo(bench.root) ? (headSha(bench.root) ?? "") : ""),
    branch: opts.branch ?? (isRepo(bench.root) ? (currentBranch(bench.root) ?? "") : ""),
    tree: TREE,
    excluded: [...(opts.excluded ?? [])],
    green: opts.green ?? true,
    scopes: { [SCOPE]: { green: true, exitCode: 0, durationMs: 5 } },
  };
  appendEvidenceLine(bench.runDir, record);
  const item = bench.store.loadItem(bench.runId, itemId);
  item.evidence.validated = { ledger: "evidence.jsonl", seq: record.seq };
  bench.store.saveItem(bench.runId, item);
  return record;
}

function readBatch(runDir: string): PublishBatchLine[] {
  const file = path.join(runDir, "publish-batch.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PublishBatchLine);
}

function readReport(runDir: string): string {
  return readFileSync(path.join(runDir, "report.md"), "utf8");
}

// The §2.6 freshness inputs an impure caller gathers, read off the REAL fixture: the
// worktree mtimes of the item's declared paths that exist, plus the current HEAD. Used
// ONLY as a control (this file never re-implements the rule — core verifyFreshFor judges).
function freshnessInputsFor(bench: Bench, rels: string[]): Parameters<typeof verifyFreshFor>[1] {
  const stagedMtimes: number[] = [];
  for (const rel of rels) {
    const abs = path.join(bench.root, rel);
    if (existsSync(abs)) stagedMtimes.push(statSync(abs).mtimeMs);
  }
  return {
    stagedMtimes,
    indexMtimeMs: statSync(bench.root).mtimeMs,
    hasStagedDeletion: false,
    currentHead: headSha(bench.root) ?? "",
    noGit: false,
  };
}

// The `## <name>` section of report.md, up to the next `## ` heading (P3).
function section(md: string, name: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${name.toLowerCase()}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function hasSection(md: string, name: string): boolean {
  return md.split("\n").some((line) => line.trim().toLowerCase() === `## ${name.toLowerCase()}`);
}

function headingsOf(md: string): string[] {
  return md
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.trim());
}

// The `### <itemId> — …` subsection of the Items section.
function itemSection(md: string, itemId: string): string {
  const items = section(md, "Items");
  const lines = items.split("\n");
  const start = lines.findIndex((line) => line.startsWith("### ") && line.includes(itemId));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// The gate's view of the SAME persisted fixture (the tools.ts gateItemsOf shape).
function gateItemsOf(bench: Bench): GateItem[] {
  return bench.queue.items.map((qi) => {
    const item = bench.store.loadItem(bench.runId, qi.id);
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

function gateRunOf(bench: Bench): GateRun {
  const run = bench.store.loadRun(bench.runId);
  return {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
  };
}

// ---------------------------------------------------------------------------
// Fixture source + test content
// ---------------------------------------------------------------------------

function subjectSource(marker: string): string {
  return `// ${marker}\nexport function parse(text) {\n  return Number(text);\n}\n`;
}

function passingTest(marker: string, subjectRel: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    `import { parse } from "${subjectRel}";\n` +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7, "sign");\n' +
    "});\n"
  );
}

function failingTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'test("t", () => {\n' +
    `  assert.equal(1, -1, ${JSON.stringify(marker)});\n` +
    "});\n"
  );
}

// Formatter fixtures live OUTSIDE the repo, so they never appear in its git status.
function formatterScript(body: string, name: string): string {
  const dir = tmpDir("fmt");
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
}

const STDIN_FORMATTER = `import { readFileSync } from "node:fs";
const raw = readFileSync(0, "utf8");
process.stdout.write(raw.split("UNFORMATTED").join("FORMATTED"));
`;

const CRASHING_FORMATTER = `process.stdout.write("half-a-file");
process.exit(3);
`;

const EMPTY_FORMATTER = `process.stdout.write("");
`;

const CHECK_FORMATTER = `import { readFileSync } from "node:fs";
const target = process.argv[2];
const text = readFileSync(target, "utf8");
process.exit(text.includes("BADFMT") ? 1 : 0);
`;

// ===========================================================================
// conductor_publish — §3.3's five steps, in order
// ===========================================================================

// ---------------------------------------------------------------------------
// [9.5b-publish-head-mismatch-denies]
// ---------------------------------------------------------------------------

test("[9.5b-publish-head-mismatch-denies] step 1: a HEAD moved by a BRANCH SWITCH — which no staged file's mtime can see — denies publish naming BOTH commits, before any staging, format or commit side effect", async () => {
  const bench = makeBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
      // A second branch carrying ONE unrelated file, so switching to it moves HEAD without
      // touching src/beta.mjs or tests/beta.test.mjs at all.
    },
  });
  git(bench.root, ["switch", "-c", "side"]);
  writeFileSync(path.join(bench.root, "side.txt"), "side\n");
  git(bench.root, ["add", "side.txt"]);
  git(bench.root, ["commit", "-m", "side commit"]);
  git(bench.root, ["switch", "main"]);

  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  const validated = seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
  const recordHead = validated.head;

  // The switch: HEAD moves, mtimes do not.
  const contentBefore = readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8");
  git(bench.root, ["switch", "side"]);
  const currentHead = headSha(bench.root) ?? "";
  assert.notEqual(currentHead, recordHead, "the fixture really did move HEAD");
  assert.equal(
    readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8"),
    contentBefore,
    "the fixture did not rewrite the item's own file (the case mtimes cannot see)",
  );

  const commitsBefore = commitCount(bench.root);
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  assert.equal(res.ok, false, "publish is denied");
  assert.ok(res.denial !== null, "the denial carries a message");
  const denial = res.denial ?? "";
  // Short or full spelling both count as "naming the commit"; the two shas must BOTH appear.
  assert.ok(denial.includes(recordHead.slice(0, 7)), "the denial names the commit the verify judged");
  assert.ok(denial.includes(currentHead.slice(0, 7)), "the denial names the commit HEAD is at now");
  assert.equal(res.commit, null, "no commit was created");
  assert.equal(commitCount(bench.root), commitsBefore, "the commit count is unchanged");
  assert.deepEqual(stagedFiles(bench.root), [], "the index is unchanged — nothing was staged");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stays REVIEWED");
  assert.equal(readBatch(bench.runDir).length, 0, "a denied publish writes no batch line");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-serial-index-singleton]
// ---------------------------------------------------------------------------

test("[9.5b-publish-serial-index-singleton] §4.2/§4.3: publish is serial in ONE tree — A commits, and B (whose verify predates A's commit) is denied at step 1 naming both commits, so exactly ONE new commit exists after both calls", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
      ],
    },
    states: { I1: "REVIEWED", I2: "REVIEWED" },
  });
  for (const [id, subject, testRel] of [
    ["I1", "src/a.mjs", "tests/a.test.mjs"],
    ["I2", "src/b.mjs", "tests/b.test.mjs"],
  ] as const) {
    writeFileSync(path.join(bench.root, subject), subjectSource(`SUBJECT-${id}`));
    writeFileSync(path.join(bench.root, testRel), passingTest(`TEST-${id}`, `../${subject}`));
    seedRed(bench, id, testRel);
  }
  const headBefore = headSha(bench.root) ?? "";
  const vA = seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
  const vB = seedValidated(bench, "I2", { startedMs: Date.now() + 60_000 });
  assert.equal(vA.head, headBefore, "both verifies judged the SAME pre-publish HEAD");
  assert.equal(vB.head, headBefore, "both verifies judged the SAME pre-publish HEAD");

  const commitsBefore = commitCount(bench.root);
  const publish = async (itemId: string): Promise<PublishResult> =>
    handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });

  const first: PublishResult = await publish("I1");
  assert.equal(first.ok, true, "the first item in wave order publishes");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "A reached PUBLISHED");
  const headAfterA = headSha(bench.root) ?? "";
  assert.notEqual(headAfterA, headBefore, "A's commit moved HEAD");

  const second: PublishResult = await publish("I2");
  assert.equal(second.ok, false, "B's green was produced before A's commit existed, so B is denied");
  const denial = second.denial ?? "";
  assert.ok(denial.includes(headBefore.slice(0, 7)), "B's denial names the commit B's verify judged");
  assert.ok(denial.includes(headAfterA.slice(0, 7)), "B's denial names the commit HEAD is at now");
  assert.equal(commitCount(bench.root), commitsBefore + 1, "exactly ONE new commit exists");
  assert.equal(bench.store.loadItem(bench.runId, "I2").state, "REVIEWED", "B stays REVIEWED");
  // The handler neither reorders nor auto-advances: that disposition is the 9.4c driver's.
  assert.equal(second.commit, null, "no commit was created for B");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-stage-refuse]
// ---------------------------------------------------------------------------

test('[9.5b-publish-stage-refuse] step 2 under preexistingDirty "refuse": a pre-existing dirty file inside the item scope denies publish, writes exactly ONE §2.11 question with origin "scope-conflict", creates no commit, and leaves the user WIP byte-identical', async () => {
  const wip = `${subjectSource("BASE")}// ${WIP_MARKER}\n`;
  const bench = makeBench({
    config: makeConfig({ preexistingDirty: "refuse" }),
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
    },
    dirty: (root) => {
      // The human's uncommitted work, established BEFORE the run — so it is in startDirty.
      writeFileSync(path.join(root, "src", "beta.mjs"), wip);
    },
  });
  assert.ok(
    bench.store.loadRun(bench.runId).startDirty.includes("src/beta.mjs"),
    "the fixture's WIP really is in run.startDirty",
  );

  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

  const commitsBefore = commitCount(bench.root);
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });

  assert.equal(res.ok, false, "publish is denied");
  assert.ok((res.denial ?? "").includes("src/beta.mjs"), "the denial names the conflicting path");
  const questions = readQuestions(bench.runDir);
  assert.equal(questions.length, 1, "exactly one question was written");
  assert.equal(questions[0].origin, "scope-conflict", "on the EXISTING scope-conflict origin (no widening)");
  assert.deepEqual(questions[0].blocksItems, ["I1"], "the question blocks the publishing item");
  assert.equal(res.questionId, questions[0].id, "the compact return names the question it minted");
  assert.equal(commitCount(bench.root), commitsBefore, "no commit was created");
  assert.equal(
    readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8"),
    wip,
    "the user's WIP is byte-identical",
  );
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stays REVIEWED");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-stage-exclude]
// ---------------------------------------------------------------------------

test('[9.5b-publish-stage-exclude] step 2 under preexistingDirty "exclude": publish commits WITHOUT the user WIP — the commit contains the item\'s test file and NOT the dirty path, which is left byte-identical — and records the skipped path for the report', async () => {
  const wip = `${subjectSource("BASE")}// ${WIP_MARKER}\n`;
  const bench = makeBench({
    config: makeConfig({ preexistingDirty: "exclude" }),
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
    },
    dirty: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), wip);
    },
  });
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  assert.equal(res.ok, true, "publish proceeds under exclude");
  assert.ok(res.commit !== null, "a commit was created");
  const shipped = commitNameStatus(bench.root);
  assert.ok(shipped.includes("tests/beta.test.mjs"), "the item's TEST file ships in the same commit");
  assert.ok(!shipped.includes("src/beta.mjs"), "the user's pre-existing WIP does NOT ship");
  assert.equal(
    readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8"),
    wip,
    "the WIP is left byte-identical in the worktree",
  );
  assert.ok(res.skipped.includes("src/beta.mjs"), "the skipped path is reported");
  const batch = readBatch(bench.runDir);
  assert.equal(batch.length, 1, "one batch line was appended");
  assert.ok(batch[0].skipped.includes("src/beta.mjs"), "the batch carries the skipped path for the report");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "the item advanced");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-format-stdin]
// ---------------------------------------------------------------------------

test("[9.5b-publish-format-stdin] step 3: a stdin-mode rule REWRITES and RE-STAGES the file with its stdout (first matching rule wins), while a check-mode rule exiting non-zero denies publish naming the file and the rule, with no auto-fix attempted", async (t) => {
  const fmt = formatterScript(STDIN_FORMATTER, "fmt.mjs");
  const check = formatterScript(CHECK_FORMATTER, "check.mjs");

  await t.test("stdin mode rewrites, re-stages, and ships the FORMATTED bytes", async () => {
    const bench = makeBench({
      config: makeConfig({
        formatRules: [
          { pattern: "src/**", mode: "stdin", command: [process.execPath, fmt] },
          // A decoy SECOND rule for the same file: first match wins, so this never runs —
          // if it did, the crashing formatter would deny the publish.
          { pattern: "src/**", mode: "check", command: [process.execPath, formatterScript(CRASHING_FORMATTER, "decoy.mjs")] },
        ],
      }),
      queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
      states: { I1: "REVIEWED" },
    });
    const unformatted = `// UNFORMATTED\n${subjectSource("BASE")}`;
    writeFileSync(path.join(bench.root, "src", "beta.mjs"), unformatted);
    writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
    seedRed(bench, "I1", "tests/beta.test.mjs");
    seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

    const res: PublishResult = await handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });

    const formatted = unformatted.split("UNFORMATTED").join("FORMATTED");
    assert.equal(res.ok, true, "publish proceeds");
    assert.equal(
      readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8"),
      formatted,
      "the worktree file was REWRITTEN with the formatter's stdout",
    );
    assert.equal(
      blobAt(bench.root, "HEAD", "src/beta.mjs"),
      formatted,
      "and RE-STAGED, so the committed blob is the formatted bytes",
    );
  });

  await t.test("check mode denies on a non-zero exit, naming the file and the rule, with no auto-fix", async () => {
    const bench = makeBench({
      config: makeConfig({ formatRules: [{ pattern: "src/**", mode: "check", command: [process.execPath, check] }] }),
      queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
      states: { I1: "REVIEWED" },
    });
    const badly = `// BADFMT\n${subjectSource("BASE")}`;
    writeFileSync(path.join(bench.root, "src", "beta.mjs"), badly);
    writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
    seedRed(bench, "I1", "tests/beta.test.mjs");
    seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
    const commitsBefore = commitCount(bench.root);

    const res: PublishResult = await handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });

    assert.equal(res.ok, false, "a check-mode failure denies publish");
    const denial = res.denial ?? "";
    assert.ok(denial.includes("src/beta.mjs"), "the denial names the file");
    assert.ok(denial.includes("src/**"), "the denial names the rule that judged it");
    assert.equal(
      readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8"),
      badly,
      "check mode attempts NO auto-fix — the file is byte-identical",
    );
    assert.equal(commitCount(bench.root), commitsBefore, "no commit was created");
    assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stays REVIEWED");
  });
});

// ---------------------------------------------------------------------------
// [9.5b-publish-format-crash-denies]
// ---------------------------------------------------------------------------

test("[9.5b-publish-format-crash-denies] a CRASHING formatter denies publish naming the formatter and the file, in three flavours (non-zero exit, spawn failure, empty stdout on non-empty input) — the file is byte-identical and no commit is created", async (t) => {
  const flavours: Array<{ label: string; command: string[]; token: string }> = [
    {
      label: "non-zero exit after partial stdout",
      command: [process.execPath, formatterScript(CRASHING_FORMATTER, "crash.mjs")],
      token: "crash.mjs",
    },
    {
      label: "spawn failure (the binary does not exist)",
      command: ["conductor-no-such-formatter-9512"],
      token: "conductor-no-such-formatter-9512",
    },
    {
      label: "empty stdout on non-empty input",
      command: [process.execPath, formatterScript(EMPTY_FORMATTER, "empty.mjs")],
      token: "empty.mjs",
    },
  ];

  for (const flavour of flavours) {
    await t.test(flavour.label, async () => {
      const bench = makeBench({
        config: makeConfig({ formatRules: [{ pattern: "src/**", mode: "stdin", command: [...flavour.command] }] }),
        queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
        states: { I1: "REVIEWED" },
      });
      const original = subjectSource("IMPLEMENTED");
      writeFileSync(path.join(bench.root, "src", "beta.mjs"), original);
      writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
      seedRed(bench, "I1", "tests/beta.test.mjs");
      seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
      const commitsBefore = commitCount(bench.root);

      const res: PublishResult = await handlePublish({
        store: bench.store,
        fanout: bench.fanout,
        runId: bench.runId,
        itemId: "I1",
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: WORKSPACE_KEY,
      });

      assert.equal(res.ok, false, "a crashed formatter is not a formatting verdict — publish is denied");
      const denial = res.denial ?? "";
      assert.ok(denial.includes("src/beta.mjs"), "the denial names the file");
      assert.ok(denial.includes(flavour.token), "the denial names the formatter");
      assert.equal(
        readFileSync(path.join(bench.root, "src", "beta.mjs"), "utf8"),
        original,
        "the file is byte-identical (failure and dirty are distinct outcomes)",
      );
      assert.equal(commitCount(bench.root), commitsBefore, "no commit was created");
      assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stays REVIEWED");
    });
  }
});

// ---------------------------------------------------------------------------
// [9.5b-publish-freshness-fresh-skips-reverify]
// ---------------------------------------------------------------------------

test("[9.5b-publish-freshness-fresh-skips-reverify] step 4: on a FRESH §2.6 verdict (both conditions, through core verifyFreshFor) publish goes straight to the commit — ZERO new verify records, no quarantine, no marker", async () => {
  const bench = makeBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
  });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  const validated = seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

  // CONTROL: the fixture really IS fresh by the core rule, not by this test's opinion.
  const verdict = verifyFreshFor(
    { startedMs: validated.startedMs, head: validated.head },
    freshnessInputsFor(bench, ["src/beta.mjs", "tests/beta.test.mjs"]),
  );
  assert.equal(verdict.fresh, true, "control: core verifyFreshFor calls this record FRESH");

  const verifiesBefore = verifyRecords(bench.runDir).length;
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  assert.equal(res.ok, true, "a fresh record publishes");
  assert.equal(res.reverified, false, "no auto re-verify was triggered");
  assert.equal(res.verifySeq, validated.seq, "the publish rests on the ORIGINAL verify record");
  assert.equal(verifyRecords(bench.runDir).length, verifiesBefore, "zero new §2.6 verify records");
  assert.equal(
    existsSync(quarantineDirFor(bench.stateHome, WORKSPACE_KEY, bench.runId)),
    false,
    "no quarantine was performed (its dir is created only by quarantineFiles)",
  );
  assert.equal(
    existsSync(path.join(bench.runDir, `verify-running-${TREE}.json`)),
    false,
    "no per-tree verify marker was written",
  );
});

// ---------------------------------------------------------------------------
// [9.5b-publish-stale-triggers-one-reverify]
// ---------------------------------------------------------------------------

test("[9.5b-publish-stale-triggers-one-reverify] a STALE verdict triggers EXACTLY ONE auto re-verify through evidence.runVerify, start-stamped after the call began, and a PASSING re-verify lets publish commit in the SAME call — no loop, no second freshness check", async () => {
  const bench = makeBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
  });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  // Stamped BEFORE the item's files were written: an edit landed after the verify started.
  const validated = seedValidated(bench, "I1", { startedMs: Date.now() - 3_600_000 });
  const verdict = verifyFreshFor(
    { startedMs: validated.startedMs, head: validated.head },
    freshnessInputsFor(bench, ["src/beta.mjs", "tests/beta.test.mjs"]),
  );
  assert.equal(verdict.fresh, false, "control: core verifyFreshFor calls this record STALE");

  const callStart = Date.now();
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  const fresh = verifyRecords(bench.runDir).filter((r) => r.seq !== validated.seq);
  assert.equal(fresh.length, 1, "EXACTLY ONE auto re-verify ran");
  assert.equal(res.reverified, true, "the compact return says the re-verify ran");
  assert.ok(fresh[0].startedMs >= callStart, "the re-verify is start-stamped after the publish call began");
  assert.equal(fresh[0].tree, TREE, "it ran in the shared tree");
  assert.equal(fresh[0].green, true, "the re-verify passed");
  assert.equal(res.verifySeq, fresh[0].seq, "the publish rests on the re-verify's record");
  assert.equal(res.ok, true, "and the SAME call proceeds to the commit");
  assert.ok(res.commit !== null, "a commit was created");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "the item advanced");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-reverify-exclusion-identity]
// ---------------------------------------------------------------------------

test("[9.5b-publish-reverify-exclusion-identity] the auto re-verify's exclusions ARE tools.ts foreignRedSet(store, runId, queue, itemId) — every OTHER item below GREEN's testScope ∪ the §2.11 registry, with the publishing item's OWN tests never excluded", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/sib.mjs"], testScope: ["tests/sib.test.mjs"] }),
      ],
    },
    states: { I1: "REVIEWED", I2: "RED" },
  });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  // The sibling's red, and an EARLIER RUN's stale-red entry: two independent foreign sources.
  writeFileSync(path.join(bench.root, "tests", "sib.test.mjs"), failingTest(FOREIGN_RED_MARKER));
  writeFileSync(path.join(bench.root, "tests", "legacy.test.mjs"), failingTest(STALE_RED_MARKER));
  bench.store.addStaleRed({
    path: "tests/legacy.test.mjs",
    itemId: "I-OLD",
    runId: "r-20260101-old1",
    sinceMs: START_MS - 86_400_000,
    reason: "left red when an earlier run terminated below GREEN",
  });
  seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1", { startedMs: Date.now() - 3_600_000 });

  // The SAME derivation, computed here BEFORE the call — never re-implemented in this file.
  const expected: string[] = foreignRedSet(bench.store, bench.runId, bench.queue, "I1");

  const before = verifyRecords(bench.runDir).map((r) => r.seq);
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  const fresh = verifyRecords(bench.runDir).filter((r) => !before.includes(r.seq));
  assert.equal(fresh.length, 1, "one auto re-verify ran");
  assert.deepEqual(fresh[0].excluded, expected, "its exclusions ARE the shared derivation, not a re-implementation");
  assert.deepEqual(res.excluded, expected, "and the compact return reports the same set");
  assert.ok(expected.includes("tests/sib.test.mjs"), "the sibling below GREEN is excluded");
  assert.ok(expected.includes("tests/legacy.test.mjs"), "the §2.11 registry entry is excluded");
  assert.ok(!expected.includes("tests/beta.test.mjs"), "the publishing item's OWN test is NEVER excluded");
  assert.equal(res.ok, true, "the foreign red did not poison the publish");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-reverify-fail-demotes]
// ---------------------------------------------------------------------------

test("[9.5b-publish-reverify-fail-demotes] a FAILING auto re-verify drops the item to GREEN with `debugging` set rather than looping: publish denies, no commit, and no second verify is attempted in the same call", async () => {
  const bench = makeBench({
    config: makeConfig({ brokenScope: true }),
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
  });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  const validated = seedValidated(bench, "I1", { startedMs: Date.now() - 3_600_000 });

  // CONTROL: the ITEM's own test still passes — it is the TREE that is broken.
  const control = runNodeTest(bench.root, "tests/beta.test.mjs");
  assert.equal(control.status, 0, "control: the item's own test passes");

  const commitsBefore = commitCount(bench.root);
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });

  assert.equal(res.ok, false, "publish is denied");
  assert.ok(res.denial !== null, "with a message");
  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(item.state, "GREEN", "the item DROPPED to GREEN rather than looping");
  assert.notEqual(item.debugging, null, "with the DEBUG annotation set");
  assert.equal(commitCount(bench.root), commitsBefore, "no commit was created");
  const fresh = verifyRecords(bench.runDir).filter((r) => r.seq !== validated.seq);
  assert.equal(fresh.length, 1, "exactly ONE verify was attempted — no retry loop inside the call");
  assert.equal(fresh[0].green, false, "and it was red");
  // The drop is administrative, never an FSM edge (C-037 ruling 7).
  assert.equal(
    recordsFor(bench.journal.records, "fsm", "transition").length,
    0,
    "the demotion journals NO fsm/transition — the FSM denies REVIEWED->GREEN",
  );
  assert.ok(
    recordsFor(bench.journal.records, "state", "item.updated").some((r) => r.corr.itemId === "I1"),
    "it journals state/item.updated instead",
  );
});

// ---------------------------------------------------------------------------
// [9.5b-demotion-helper-item-updated]
// ---------------------------------------------------------------------------

test("[9.5b-demotion-helper-item-updated] C-037 ruling 7: the REVIEWED->GREEN drop is ONE named exported helper that writes through the store and journals `state: item.updated`, NEVER `fsm: transition` — and the module defines it exactly once", async () => {
  const bench = makeBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
  });

  // The FSM really does deny this edge — which is why the helper must not claim it.
  const edge = legalItemTransition("REVIEWED", "GREEN", { item: { behavioral: true, blocked: null } });
  assert.equal(edge.ok, false, "core/fsm-item.ts has no backward REVIEWED->GREEN edge");

  const before = bench.journal.records.length;
  const returned: Item = demoteReviewedToGreen({
    store: bench.store,
    runId: bench.runId,
    itemId: "I1",
    journal: bench.journal.sink,
    reason: "the closing tree verify went red after the review",
    hypothesis: `the ${BROKEN_SCOPE} scope fails on the current tree`,
    now: () => START_MS,
  });

  assert.equal(returned.state, "GREEN", "the helper returns the demoted item");
  const persisted = bench.store.loadItem(bench.runId, "I1");
  assert.equal(persisted.state, "GREEN", "the drop is PERSISTED through the store (G6)");
  assert.notEqual(persisted.debugging, null, "with the DEBUG annotation set");
  assert.equal(
    persisted.debugging?.hypothesis,
    `the ${BROKEN_SCOPE} scope fails on the current tree`,
    "carrying the caller's hypothesis verbatim",
  );

  const emitted = bench.journal.records.slice(before);
  const updates = emitted.filter((r) => r.component === "state" && r.event === "item.updated");
  assert.equal(updates.length, 1, "exactly one state/item.updated record");
  assert.equal(updates[0].corr.itemId, "I1", "correlated to the item");
  assert.equal(
    emitted.filter((r) => r.component === "fsm").length,
    0,
    "and ZERO fsm records — calling this a transition would claim an edge the FSM denies",
  );

  // ONE definition, shared with Task 9.6 (which describes the identical helper).
  const source = readFileSync(new URL("../adapter/tools.ts", import.meta.url), "utf8");
  const definitions = source.match(/export\s+(?:async\s+)?(?:function|const)\s+demoteReviewedToGreen\b/g) ?? [];
  assert.equal(definitions.length, 1, "adapter/tools.ts defines the helper exactly once");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-message-template-pure]
// ---------------------------------------------------------------------------

test("[9.5b-publish-message-template-pure] step 5: the commit message is built by the PURE core template naming the item and citing its red proof — ZERO sub-session dispatches across the whole publish call, and the created commit's message is the template's own output", async () => {
  const queueItem = makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] });
  const bench = makeBench({ queue: { items: [queueItem] }, states: { I1: "REVIEWED" } });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  const red = seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  assert.equal(res.ok, true, "publish proceeds");
  assert.equal(bench.sdk.calls.length, 0, "ZERO sub-session traffic: a message is not a judgment");

  const proof: RedProof = { seq: red.seq, command: [...red.command], failureExcerpt: red.failureExcerpt };
  const expected: string = buildCommitMessage(queueItem, proof);
  assert.equal(res.message, expected, "the handler used the pure template");
  assert.equal(
    gitCleanup(headBody(bench.root)),
    gitCleanup(expected),
    "the created commit carries exactly that message (modulo git's own cleanup, P5)",
  );
  assert.ok(expected.includes("I1"), "the template names the item");
  assert.ok(expected.includes(String(red.seq)), "and cites the red proof by seq — a template cannot hallucinate one");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-denylist-generator-side]
// ---------------------------------------------------------------------------

test("[9.5b-publish-denylist-generator-side] generator side: over a matrix whose item text and red excerpts THEMSELVES carry the denylisted tokens in mixed case, the pure template never EMITS a denylisted trailer — the offending text is neutralized, not passed through into a trailer position", () => {
  // The four §3.3 tokens, exported as data so the generator and the handler share one list.
  const tokens = TRAILER_DENYLIST.map((token: string) => token.toLowerCase());
  for (const expected of ["co-authored-by", "signed-off-by", "generated with", "\u{1F916}"]) {
    assert.ok(tokens.includes(expected), `TRAILER_DENYLIST carries "${expected}"`);
  }

  // The detector itself, on both polarities (it is the generator's own proof obligation).
  assert.equal(hasDenylistedTrailer("subject\n\nbody\n"), false, "a clean message carries no trailer");
  assert.equal(hasDenylistedTrailer("subject\n\nCo-Authored-By: A <a@b.c>\n"), true, "canonical trailer");
  assert.equal(hasDenylistedTrailer("subject\n\n  signed-off-by: a\n"), true, "case-insensitive, leading space");
  assert.equal(hasDenylistedTrailer("subject\n\nGenerated with a tool\n"), true, "the generated-with token");
  assert.equal(hasDenylistedTrailer("subject\n\nbody \u{1F916}\n"), true, "U+1F916 anywhere at all");

  const nasty: Array<{ label: string; title: string; rationale: string; excerpt: string }> = [
    {
      label: "Co-Authored-By in the title",
      title: "Co-Authored-By: someone <a@b.c> keeps the sign",
      rationale: "the parser drops the sign",
      excerpt: "AssertionError: 7 !== -7",
    },
    {
      label: "signed-off-by (lowercase) in the rationale",
      title: "keep the sign of negative offsets",
      rationale: "reported as\nsigned-off-by: the reviewer\nin the issue",
      excerpt: "AssertionError: 7 !== -7",
    },
    {
      label: "GENERATED WITH (uppercase) inside the red excerpt",
      title: "keep the sign",
      rationale: "the parser drops the sign",
      excerpt: "AssertionError: 7 !== -7\nGENERATED WITH a fuzzer\n",
    },
    {
      label: "U+1F916 in every field",
      title: "keep the sign \u{1F916}",
      rationale: "the parser \u{1F916} drops the sign",
      excerpt: "AssertionError \u{1F916}: 7 !== -7",
    },
  ];

  for (const testCase of nasty) {
    const item = makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] });
    item.title = testCase.title;
    item.rationale = testCase.rationale;
    const proof: RedProof = {
      seq: 3,
      command: [process.execPath, "--test", "tests/beta.test.mjs"],
      failureExcerpt: testCase.excerpt,
    };
    const message: string = buildCommitMessage(item, proof);
    assert.equal(hasDenylistedTrailer(message), false, `${testCase.label}: the template emits no denylisted trailer`);
    for (const line of message.split("\n")) {
      assert.ok(
        !/^\s*(co-authored-by|signed-off-by|generated with)/i.test(line),
        `${testCase.label}: no line sits in a denylisted trailer position ("${line}")`,
      );
    }
    assert.ok(!message.includes("\u{1F916}"), `${testCase.label}: U+1F916 never survives into the message`);
  }
});

// ---------------------------------------------------------------------------
// [9.5b-publish-denylist-handler-rejects]
// ---------------------------------------------------------------------------

test("[9.5b-publish-denylist-handler-rejects] handler side, defense in depth: a message carrying ANY of the four §3.3 denylist tokens — injected through the template seam, in mixed case — denies publish naming the token and creates no commit", async (t) => {
  const injections: Array<{ label: string; message: string; token: string }> = [
    { label: "Co-Authored-By", message: "conductor: I1\n\nCo-Authored-By: Someone <a@b.c>\n", token: "Co-Authored-By" },
    { label: "signed-off-by (lowercase)", message: "conductor: I1\n\nsigned-off-by: someone\n", token: "signed-off-by" },
    { label: "GENERATED WITH (uppercase)", message: "conductor: I1\n\nGENERATED WITH a tool\n", token: "GENERATED WITH" },
    { label: "U+1F916", message: "conductor: I1\n\nshipped \u{1F916}\n", token: "\u{1F916}" },
  ];

  for (const injection of injections) {
    await t.test(injection.label, async () => {
      const bench = makeBench({
        queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
        states: { I1: "REVIEWED" },
      });
      writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
      writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
      seedRed(bench, "I1", "tests/beta.test.mjs");
      seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
      const commitsBefore = commitCount(bench.root);

      const res: PublishResult = await handlePublish({
        store: bench.store,
        fanout: bench.fanout,
        runId: bench.runId,
        itemId: "I1",
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: WORKSPACE_KEY,
        messageBuilder: () => injection.message,
      });

      assert.equal(res.ok, false, "the handler rejects the message rather than trusting the generator");
      assert.ok(
        (res.denial ?? "").toLowerCase().includes(injection.token.toLowerCase()),
        "the denial names the offending token",
      );
      assert.equal(commitCount(bench.root), commitsBefore, "no commit was created");
      assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stays REVIEWED");
    });
  }
});

// ---------------------------------------------------------------------------
// [9.5b-publish-push-leg]
// ---------------------------------------------------------------------------

test('[9.5b-publish-push-leg] §3.3:1296: the push happens AFTER a successful commit and ONLY under "commit-and-push" — the remote ref advances under commit-and-push and is UNCHANGED under commit', async (t) => {
  const withRemote = (mode: Config["git"]["mode"]): { bench: Bench; bare: string } => {
    const bare = tmpDir("bare");
    git(bare, ["init", "--bare", "-b", "main"]);
    const bench = makeBench({
      config: makeConfig({ gitMode: mode }),
      queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
      states: { I1: "REVIEWED" },
      seed: (root) => {
        writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
      },
    });
    git(bench.root, ["remote", "add", "origin", bare]);
    git(bench.root, ["push", "-u", "origin", "main"]);
    writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
    writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
    seedRed(bench, "I1", "tests/beta.test.mjs");
    seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
    return { bench, bare };
  };
  const remoteSha = (bare: string): string => git(bare, ["rev-parse", "refs/heads/main"]).trim();

  await t.test('"commit-and-push" advances the remote ref', async () => {
    const { bench, bare } = withRemote("commit-and-push");
    const before = remoteSha(bare);
    const res: PublishResult = await handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });
    assert.equal(res.ok, true, "publish succeeded");
    assert.equal(res.pushed, true, "the push leg ran");
    const after = remoteSha(bare);
    assert.notEqual(after, before, "the remote ref ADVANCED");
    assert.equal(after, headSha(bench.root), "to exactly the commit publish created");
  });

  await t.test('"commit" leaves the remote untouched', async () => {
    const { bench, bare } = withRemote("commit");
    const before = remoteSha(bare);
    const res: PublishResult = await handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });
    assert.equal(res.ok, true, "publish succeeded");
    assert.equal(res.pushed, false, "zero push attempts were made");
    assert.equal(remoteSha(bare), before, "the remote ref is UNCHANGED");
    assert.notEqual(headSha(bench.root), before, "even though the LOCAL commit was created");
  });
});

// ---------------------------------------------------------------------------
// [9.5b-publish-readonly-runs]
// ---------------------------------------------------------------------------

test('[9.5b-publish-readonly-runs] C-037 ruling 2, read-only half: publish RUNS steps 1-4, mutates NOTHING in git, writes the prepared batch for the report, and the item still ADVANCES REVIEWED->PUBLISHED', async () => {
  const bench = makeBench({
    config: makeConfig({ gitMode: "read-only" }),
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
    },
  });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  const red = seedRed(bench, "I1", "tests/beta.test.mjs");
  const validated = seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

  const headBefore = headSha(bench.root);
  const commitsBefore = commitCount(bench.root);
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });

  assert.equal(res.ok, true, "publish RUNS under read-only");
  assert.equal(res.commit, null, "no commit was created");
  assert.equal(res.pushed, false, "and nothing was pushed");
  assert.equal(headSha(bench.root), headBefore, "HEAD is unchanged");
  assert.equal(commitCount(bench.root), commitsBefore, "the commit count is unchanged");
  assert.deepEqual(stagedFiles(bench.root), [], "the index is unchanged");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "the item STILL advances");

  const batch = readBatch(bench.runDir);
  assert.equal(batch.length, 1, "the prepared batch was written");
  assert.equal(batch[0].itemId, "I1", "for this item");
  assert.equal(batch[0].mode, "read-only", "recording the mode it was prepared under");
  assert.deepEqual(
    [...batch[0].files].sort(),
    ["src/beta.mjs", "tests/beta.test.mjs"],
    "carrying the FILE LIST",
  );
  assert.ok(batch[0].diff.includes("beta"), "carrying the DIFF");
  const proof: RedProof = { seq: red.seq, command: [...red.command], failureExcerpt: red.failureExcerpt };
  assert.equal(
    batch[0].suggestedMessage,
    buildCommitMessage(bench.queue.items[0], proof),
    "carrying the SUGGESTED MESSAGE from the same pure template",
  );
  assert.equal(batch[0].verify.seq, validated.seq, "and the VERIFY VERDICT it rests on");
  assert.equal(batch[0].verify.green, true, "which was green");
});

// ---------------------------------------------------------------------------
// [9.5b-publish-nogit-refused]
// ---------------------------------------------------------------------------

test("[9.5b-publish-nogit-refused] C-037 ruling 2, no-git half: where gitio.isRepo is false publish is NOT legal — the handler refuses naming no-git mode, writes no batch, changes no state, and the GATE does not offer the tool either", async () => {
  const bench = makeBench({
    config: makeConfig({ gitMode: "read-only" }),
    repo: false,
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
  });
  assert.equal(isRepo(bench.root), false, "the fixture workspace is not a git repository");
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1", { startedMs: Date.now() + 60_000, head: "", branch: "" });

  await assert.rejects(
    async () =>
      handlePublish({
        store: bench.store,
        fanout: bench.fanout,
        runId: bench.runId,
        itemId: "I1",
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: WORKSPACE_KEY,
      }),
    /no-git|not a git repo|publish is disabled/i,
    "the handler refuses, naming no-git mode",
  );
  assert.equal(readBatch(bench.runDir).length, 0, "no batch artifact is written in no-git mode");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "REVIEWED is the item's terminal state here");

  // P2/G1: gate and handler cannot disagree — the gate consumes the same publishEnabled flag.
  const withPublish = gate(gateRunOf(bench), gateItemsOf(bench), [], true, true);
  assert.equal(withPublish.legal.has("conductor_publish"), true, "with publish enabled the gate offers it");
  const noGit = gate(gateRunOf(bench), gateItemsOf(bench), [], true, false);
  assert.equal(noGit.legal.has("conductor_publish"), false, "with publish DISABLED the gate does not offer it");
  assert.notEqual(noGit.recommended?.tool, "conductor_publish", "and never recommends it");
});

// ---------------------------------------------------------------------------
// [9.5b-batch-artifact-not-journal]
// ---------------------------------------------------------------------------

test("[9.5b-batch-artifact-not-journal] C-037 ruling 3: a per-file diff LARGER than journal.ts's 32 KiB record cap round-trips byte-for-byte from publish's runDir artifact into report.md, while NO journal record carries it", async () => {
  const bigBody = Array.from({ length: 900 }, (_, i) => `// ${BIG_MARKER} line ${i} ${"x".repeat(40)}`).join("\n");
  assert.ok(bigBody.length > 32 * 1024, "the fixture body really does exceed the 32 KiB record cap");

  const bench = makeBench({
    config: makeConfig({ gitMode: "read-only" }),
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/big.mjs"], testScope: ["tests/big.test.mjs"] })] },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      // Committed small, so the item's edit produces a >32 KiB TRACKED diff.
      writeFileSync(path.join(root, "src", "big.mjs"), "// base\n");
    },
  });
  writeFileSync(path.join(bench.root, "src", "big.mjs"), `${bigBody}\n`);
  writeFileSync(path.join(bench.root, "tests", "big.test.mjs"), passingTest("TEST-I1", "../src/big.mjs"));
  seedRed(bench, "I1", "tests/big.test.mjs");
  seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });

  // The REAL journal, so journal.jsonl (and its 32 KiB shrinkToFit) is exercised on disk.
  const real = makeRealJournal(bench.runDir, bench.config);
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: real.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
  });
  assert.equal(res.ok, true, "publish prepared the batch");

  const batch = readBatch(bench.runDir);
  assert.equal(batch.length, 1, "one batch line");
  assert.ok(batch[0].diff.length > 32 * 1024, "the artifact carries the WHOLE diff, untruncated");
  assert.ok(batch[0].diff.includes(BIG_MARKER), "and it is the fixture's diff");

  const report: ReportResult = await handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: real.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });
  assert.equal(report.runState, "REPORTED", "the run closed");
  const md = readReport(bench.runDir);
  assert.ok(md.includes(batch[0].diff), "the diff round-trips into report.md BYTE-FOR-BYTE");

  real.sink.flushSync();
  const journalRaw = readFileSync(path.join(bench.runDir, "journal.jsonl"), "utf8");
  assert.ok(journalRaw.length > 0, "the journal really was written");
  assert.ok(
    !journalRaw.includes(BIG_MARKER),
    "NO journal record carries the diff — a 32 KiB truncation would make report.md lie",
  );
});

// ===========================================================================
// conductor_report — the close
// ===========================================================================

// ---------------------------------------------------------------------------
// [9.5b-report-settled-predicate-shared]
// ---------------------------------------------------------------------------

test("[9.5b-report-settled-predicate-shared] C-037 ruling 1: ONE exported settled-for-report predicate (isSettled ∪ cannotEverPublish) is called by BOTH legalTools and handleReport — asserted on the case that splits them, a PENDING item whose only dependency is DEFERRED", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"], dependsOn: ["I1"] }),
      ],
    },
    states: { I1: "PENDING", I2: "PENDING" },
  });
  bench.store.setDeferred(bench.runId, "I1", {
    reason: `deferred by decision (${DEFER_MARKER})`,
    decisionId: "D-0001",
  });

  const items = gateItemsOf(bench);
  const predicate: SettledForReportResult = settledForReport(items);
  assert.equal(predicate.allSettled, true, "I2 can never publish behind a DEFERRED dependency, so the run is settled");
  assert.deepEqual(predicate.unsettled, [], "nothing is left unsettled");

  const verdict = gate(gateRunOf(bench), items, [], true);
  assert.equal(
    verdict.legal.has("conductor_report"),
    predicate.allSettled,
    "the gate's report offer IS the predicate's verdict — one derivation, two consumers",
  );

  const res: ReportResult = await handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });
  assert.equal(res.runState, "REPORTED", "and the HANDLER accepts exactly what the gate offered");
});

// ---------------------------------------------------------------------------
// [9.5b-report-allsettled-nonverify]
// ---------------------------------------------------------------------------

test("[9.5b-report-allsettled-nonverify] MANDATORY DEFERRED BINDING (C-018): the §3.2:1142 disposition precondition is a NON-VERIFY presence check over the PERSISTED items, taken BEFORE any verify — proven on a fixture whose unsettled item's own red is inside the §4.2 exclusion set, so a closing verify would pass vacuously", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
      ],
    },
    states: { I1: "PUBLISHED", I2: "PENDING" },
  });
  // I2 is unsettled AND below GREEN, so foreignRedSet would quarantine its own red out of
  // the closing verify: the verify cannot see the very failure that makes the run unfinished.
  writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), failingTest(FOREIGN_RED_MARKER));
  const control = runNodeTest(bench.root, "tests/b.test.mjs");
  assert.notEqual(control.status, 0, "control: the unsettled item's own test really IS red");
  assert.ok(
    foreignRedSet(bench.store, bench.runId, bench.queue, null).includes("tests/b.test.mjs"),
    "control: and the closing verify's exclusion rule would quarantine it — a vacuous pass",
  );

  await assert.rejects(
    async () =>
      handleReport({
        store: bench.store,
        fanout: bench.fanout,
        runId: bench.runId,
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: WORKSPACE_KEY,
        metrics: async () => null,
      }),
    /I2/,
    "report REFUSES, naming the unsettled item",
  );
  assert.equal(verifyRecords(bench.runDir).length, 0, "NO verify record was appended");
  assert.equal(
    existsSync(quarantineDirFor(bench.stateHome, WORKSPACE_KEY, bench.runId)),
    false,
    "no quarantine was performed",
  );
  assert.equal(existsSync(path.join(bench.runDir, "report.md")), false, "and no report.md was written");
});

// ---------------------------------------------------------------------------
// [9.5b-report-precondition-lite]
// ---------------------------------------------------------------------------

test("[9.5b-report-precondition-lite] the same precondition holds on the TRIVIAL report-lite path: report-lite is a content mode, never a relaxation of the completeness check", async () => {
  const bench = makeBench({
    classification: "trivial",
    queue: { items: [makeQueueItem("T1", { fileScope: ["src/t.mjs"], testScope: ["tests/t.test.mjs"] })] },
    states: { T1: "GREEN" },
  });

  await assert.rejects(
    async () =>
      handleReport({
        store: bench.store,
        fanout: bench.fanout,
        runId: bench.runId,
        config: bench.config,
        journal: bench.journal.sink,
        stateHome: bench.stateHome,
        workspaceKey: WORKSPACE_KEY,
        metrics: async () => null,
      }),
    /T1/,
    "the trivial run is refused too, naming the unsettled item",
  );
  assert.equal(verifyRecords(bench.runDir).length, 0, "no verify ran");
  assert.equal(existsSync(path.join(bench.runDir, "report.md")), false, "no report.md was written");
  assert.equal(bench.store.loadRun(bench.runId).state, "EXECUTING", "and the run did not close");
});

// ---------------------------------------------------------------------------
// [9.5b-report-nogit-reviewed-terminal]
// ---------------------------------------------------------------------------

test("[9.5b-report-nogit-reviewed-terminal] C-037 ruling 2, report half: under no-git the precondition ACCEPTS an item terminating at REVIEWED and the run closes; the identical fixture in a git repo is REFUSED. One predicate, one mode flag, two outcomes", async (t) => {
  const build = (repo: boolean): Bench => {
    const bench = makeBench({
      config: makeConfig({ gitMode: "read-only" }),
      repo,
      queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
      states: { I1: "REVIEWED" },
    });
    writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
    writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
    return bench;
  };

  await t.test("no-git: REVIEWED is terminal, the run closes", async () => {
    const bench = build(false);
    const items = gateItemsOf(bench);
    const predicate: SettledForReportResult = settledForReport(items, { publishEnabled: false });
    assert.equal(predicate.allSettled, true, "the predicate counts REVIEWED as settled in this mode ONLY");
    assert.equal(
      gate(gateRunOf(bench), items, [], true, false).legal.has("conductor_report"),
      true,
      "so the gate offers the report",
    );

    const res: ReportResult = await handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => null,
    });
    assert.equal(res.runState, "REPORTED", "and the handler closes the run");
  });

  await t.test("git mode: REVIEWED is mid-flight, publish is still owed", async () => {
    const bench = build(true);
    const items = gateItemsOf(bench);
    const predicate: SettledForReportResult = settledForReport(items);
    assert.equal(predicate.allSettled, false, "the SAME predicate refuses the SAME items with publish enabled");
    assert.deepEqual(predicate.unsettled, ["I1"], "naming the item that still owes a publish");
    await assert.rejects(
      async () =>
        handleReport({
          store: bench.store,
          fanout: bench.fanout,
          runId: bench.runId,
          config: bench.config,
          journal: bench.journal.sink,
          stateHome: bench.stateHome,
          workspaceKey: WORKSPACE_KEY,
          metrics: async () => null,
        }),
      /I1/,
      "and the handler refuses",
    );
    assert.equal(existsSync(path.join(bench.runDir, "report.md")), false, "no report.md was written");
  });
});

// ---------------------------------------------------------------------------
// [9.5b-report-fresh-closing-verify]
// ---------------------------------------------------------------------------

test("[9.5b-report-fresh-closing-verify] handleReport re-runs the FULL verify itself, fresh, through evidence.runVerify — start-stamped after the call began, HEAD/branch recorded, tree main, and `excluded` equal to the SHARED derivation with NO subject item", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
      ],
    },
    states: { I1: "PUBLISHED", I2: "RED" },
  });
  // A report is legal with blocked items whose red tests linger — which is exactly why the
  // closing verify carries exclusions.
  writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), failingTest(FOREIGN_RED_MARKER));
  bench.store.setBlocked(bench.runId, "I2", { reason: BLOCK_MARKER, stage: "TEST_VETTED" });

  // G8: the exclusions are computed from the registry as it is BEFORE this report registers.
  const expected: string[] = foreignRedSet(bench.store, bench.runId, bench.queue, null);
  assert.ok(expected.includes("tests/b.test.mjs"), "control: the lingering red is in the exclusion set");

  const callStart = Date.now();
  const res: ReportResult = await handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });

  const verifies = verifyRecords(bench.runDir);
  assert.equal(verifies.length, 1, "exactly ONE closing verify ran");
  const record = verifies[0];
  assert.ok(record.startedMs >= callStart, "start-stamped AFTER the report call began — it is FRESH, not replayed");
  assert.equal(record.head, headSha(bench.root), "the HEAD it judged is recorded");
  assert.equal(record.branch, currentBranch(bench.root), "with the branch");
  assert.equal(record.tree, TREE, "in the shared tree");
  assert.equal(record.itemId, bench.runId, "G7: a run-level verify carries the RUN id in the required itemId field");
  assert.deepEqual(record.excluded, expected, "its exclusions ARE the shared derivation with no subject item");
  assert.equal(record.green, true, "the closing verify is green");
  assert.equal(res.verifySeq, record.seq, "the compact return points at it");
  assert.deepEqual(res.excluded, expected, "and reports the same exclusions");
  assert.equal(bench.sdk.calls.length, 0, "report dispatches ZERO model sub-sessions");
});

// ---------------------------------------------------------------------------
// [9.5b-report-md-per-item]
// ---------------------------------------------------------------------------

test("[9.5b-report-md-per-item] §3.2:1144-1145: report.md carries a per-item section for EVERY item — what shipped with its red proof, review rounds and taints, plus every blocked and deferred item with its reason — all read from the PERSISTED items and the evidence ledger", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
        makeQueueItem("I3", { fileScope: ["src/c.mjs"], testScope: ["tests/c.test.mjs"] }),
      ],
    },
    states: { I1: "PUBLISHED", I2: "RED", I3: "PENDING" },
  });
  const red = seedRed(bench, "I1", "tests/a.test.mjs");
  const published = bench.store.loadItem(bench.runId, "I1");
  published.attempts.reviewRounds = 2;
  published.taint = [{ kind: "override", note: TAINT_MARKER }];
  bench.store.saveItem(bench.runId, published);
  bench.store.setBlocked(bench.runId, "I2", { reason: BLOCK_MARKER, stage: "TEST_VETTED" });
  bench.store.setDeferred(bench.runId, "I3", { reason: DEFER_MARKER, decisionId: "D-0001" });

  const res: ReportResult = await handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });
  assert.equal(res.runState, "REPORTED", "the run closed");

  const md = readReport(bench.runDir);
  for (const id of ["I1", "I2", "I3"]) {
    assert.notEqual(itemSection(md, id), "", `report.md carries a per-item section for ${id}`);
  }
  const shipped = itemSection(md, "I1");
  assert.ok(/Red proof:\s*seq\s*\d+/i.test(shipped), "the shipped item cites its red proof");
  assert.ok(shipped.includes(String(red.seq)), "by the PERSISTED evidence seq");
  assert.ok(shipped.includes(red.command.join(" ")), "and the red's own command");
  assert.ok(/Review rounds:\s*2/i.test(shipped), "with its review rounds from the persisted item");
  assert.ok(shipped.includes(TAINT_MARKER), "and its taints");
  assert.ok(itemSection(md, "I2").includes(BLOCK_MARKER), "the blocked item carries its reason");
  assert.ok(itemSection(md, "I3").includes(DEFER_MARKER), "the deferred item carries its reason");
});

// ---------------------------------------------------------------------------
// [9.5b-report-md-decision-ledger]
// ---------------------------------------------------------------------------

test("[9.5b-report-md-decision-ledger] §3.2:1147: report.md carries the decision-ledger summary READ FROM runs/<runId>/decisions.jsonl (which has no reader at HEAD), and an EMPTY ledger renders the section as empty rather than omitting the fact", async (t) => {
  const decision = (id: string, choice: string): DecisionRecord => ({
    id,
    tsIso: new Date(START_MS).toISOString(),
    question: `which parser handles the sign? (${id})`,
    options: [{ name: choice }, { name: "leave it alone" }],
    choice,
    why: `${DECISION_MARKER} ${id}`,
    kind: "derived",
    appliedWhere: "src/beta.mjs",
  });

  await t.test("a populated ledger is summarized", async () => {
    const bench = makeBench({
      queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
      states: { I1: "PUBLISHED" },
    });
    const records = [decision("D-0001", "rewrite the tokenizer"), decision("D-0002", "keep the tokenizer")];
    for (const record of records) {
      const verdict = validate("DecisionRecord", record);
      assert.equal(verdict.ok, true, `control: the fixture decision ${record.id} is schema-valid`);
      appendFileSync(path.join(bench.runDir, "decisions.jsonl"), JSON.stringify(record) + "\n");
    }

    await handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => null,
    });

    const decisions = section(readReport(bench.runDir), "Decisions");
    for (const record of records) {
      assert.ok(decisions.includes(record.id), `the summary names ${record.id}`);
      assert.ok(decisions.includes(record.choice), `with its choice`);
      assert.ok(decisions.includes(record.why), `and its rationale`);
    }
  });

  await t.test("an empty ledger renders an EMPTY section, not a missing one", async () => {
    const bench = makeBench({
      queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
      states: { I1: "PUBLISHED" },
    });
    await handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => null,
    });
    const md = readReport(bench.runDir);
    assert.equal(hasSection(md, "Decisions"), true, "the full report still carries the Decisions heading");
    assert.ok(section(md, "Decisions").includes("(none)"), "rendered empty (P3), so the absence is stated");
  });
});

// ---------------------------------------------------------------------------
// [9.5b-report-md-stale-red-listed]
// ---------------------------------------------------------------------------

test("[9.5b-report-md-stale-red-listed] §3.2:1147: report.md lists the test files THIS terminal path newly added to the §2.11 registry, naming path and item — and lists ONLY the new additions, never entries an earlier run left behind", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
      ],
    },
    states: { I1: "PUBLISHED", I2: "RED" },
  });
  writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), failingTest(FOREIGN_RED_MARKER));
  writeFileSync(path.join(bench.root, "tests", "legacy.test.mjs"), failingTest(STALE_RED_MARKER));
  bench.store.addStaleRed({
    path: "tests/legacy.test.mjs",
    itemId: "I-OLD",
    runId: "r-20260101-old1",
    sinceMs: START_MS - 86_400_000,
    reason: "left red when an EARLIER run terminated below GREEN",
  });
  bench.store.setBlocked(bench.runId, "I2", { reason: BLOCK_MARKER, stage: "TEST_VETTED" });

  const res: ReportResult = await handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });

  assert.deepEqual(res.staleRedAdded, ["tests/b.test.mjs"], "exactly the NEW addition is reported");
  const listed = section(readReport(bench.runDir), "Stale-red additions");
  assert.ok(listed.includes("tests/b.test.mjs"), "report.md names the newly registered path");
  assert.ok(listed.includes("I2"), "and the item that owns it");
  assert.ok(
    !listed.includes("tests/legacy.test.mjs"),
    "the earlier run's entry is NOT re-reported as new",
  );
  const registry = bench.store.readStaleRed();
  assert.equal(registry.entries.length, 2, "the registry now carries both, old and new");
});

// ---------------------------------------------------------------------------
// [9.5b-stale-red-registration-helper]
// ---------------------------------------------------------------------------

test("[9.5b-stale-red-registration-helper] C-037 ruling 4: ONE shared exported helper performs the §2.11 write on every terminal path — it registers each below-GREEN item whose test file EXISTS, skips one whose file is gone, never duplicates, and is what handleReport itself calls", async (t) => {
  const buildBench = (): Bench => {
    const bench = makeBench({
      queue: {
        items: [
          makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
          makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
          makeQueueItem("I3", { fileScope: ["src/c.mjs"], testScope: ["tests/gone.test.mjs"] }),
        ],
      },
      states: { I1: "PUBLISHED", I2: "RED", I3: "PENDING" },
    });
    writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), failingTest(FOREIGN_RED_MARKER));
    bench.store.setBlocked(bench.runId, "I2", { reason: BLOCK_MARKER, stage: "TEST_VETTED" });
    bench.store.setDeferred(bench.runId, "I3", { reason: DEFER_MARKER, decisionId: "D-0001" });
    return bench;
  };

  await t.test("called directly", () => {
    const bench = buildBench();
    const added: string[] = registerStaleRed({
      store: bench.store,
      runId: bench.runId,
      queue: bench.queue,
      reason: `left red when the run terminated (${STALE_RED_MARKER})`,
      now: () => START_MS,
    });
    assert.deepEqual(added, ["tests/b.test.mjs"], "only the below-GREEN item whose file EXISTS is registered");

    const entries = bench.store.readStaleRed().entries;
    assert.equal(entries.length, 1, "one registry entry was written through store.addStaleRed");
    assert.deepEqual(
      entries[0],
      {
        path: "tests/b.test.mjs",
        itemId: "I2",
        runId: bench.runId,
        sinceMs: START_MS,
        reason: `left red when the run terminated (${STALE_RED_MARKER})`,
      },
      "with the exact §2.11 StaleRedRegistry entry shape",
    );

    const again: string[] = registerStaleRed({
      store: bench.store,
      runId: bench.runId,
      queue: bench.queue,
      reason: "a second terminal path",
      now: () => START_MS,
    });
    assert.deepEqual(again, [], "a path the registry already carries is not re-added and not re-reported");
  });

  await t.test("handleReport calls the SAME helper (identical registrations on an identical fixture)", async () => {
    const bench = buildBench();
    const res: ReportResult = await handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => null,
    });
    assert.deepEqual(res.staleRedAdded, ["tests/b.test.mjs"], "report registers exactly what the helper would");
    const entries = bench.store.readStaleRed().entries;
    assert.equal(entries.length, 1, "through the same store call");
    assert.equal(entries[0].itemId, "I2", "naming the owning item");
    assert.equal(entries[0].runId, bench.runId, "and this run");
  });

  await t.test("the module defines it exactly once", () => {
    const source = readFileSync(new URL("../adapter/tools.ts", import.meta.url), "utf8");
    const definitions = source.match(/export\s+(?:async\s+)?(?:function|const)\s+registerStaleRed\b/g) ?? [];
    assert.equal(definitions.length, 1, "adapter/tools.ts defines registerStaleRed exactly once (9.5c reuses it)");
  });
});

// ---------------------------------------------------------------------------
// [9.5b-report-md-questions-exclusions-metrics]
// ---------------------------------------------------------------------------

test("[9.5b-report-md-questions-exclusions-metrics] report.md is written atomically to runs/<runId>/report.md and carries the open questions with their ids, the exclusions in force (closing verify ∪ publish's skipped paths), and metrics via the §7.2 client — with a null result rendering a metrics-unavailable line, fail-soft", async (t) => {
  const buildBench = (): Bench => {
    const wip = `${subjectSource("BASE")}// ${WIP_MARKER}\n`;
    const bench = makeBench({
      config: makeConfig({ preexistingDirty: "exclude" }),
      queue: {
        items: [
          makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] }),
          makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
        ],
      },
      states: { I1: "REVIEWED", I2: "RED" },
      seed: (root) => {
        writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
      },
      dirty: (root) => {
        writeFileSync(path.join(root, "src", "beta.mjs"), wip);
      },
    });
    writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
    writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), failingTest(FOREIGN_RED_MARKER));
    seedRed(bench, "I1", "tests/beta.test.mjs");
    seedValidated(bench, "I1", { startedMs: Date.now() + 60_000 });
    bench.store.setBlocked(bench.runId, "I2", { reason: BLOCK_MARKER, stage: "TEST_VETTED" });
    appendQuestion(
      bench.runDir,
      {
        runId: bench.runId,
        question: `should the parser accept a leading plus? (${QUESTION_MARKER})`,
        askedBy: { role: "implementer", sessionID: "ses_impl" },
        humanTerritory: true,
        origin: "surface-tool",
        blocksItems: [],
      },
      START_MS,
    );
    return bench;
  };

  await t.test("questions, exclusions and a live metrics summary", async () => {
    const bench = buildBench();
    const publishRes: PublishResult = await handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });
    assert.equal(publishRes.ok, true, "the item published, skipping the user's WIP");
    assert.ok(publishRes.skipped.includes("src/beta.mjs"), "and recorded the skipped path");

    const summary: MetricsSummary = {
      totalRequests: 4711,
      schemaMissing: 0,
      schemaConformed: 4711,
      statusCounts: { "200": 4711 },
      promptTokens: 1234,
      completionTokens: 5678,
    };
    const res: ReportResult = await handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => summary,
    });

    assert.equal(res.runState, "REPORTED", "the run closed");
    assert.equal(res.metricsAvailable, true, "metrics were available");
    const md = readReport(bench.runDir);
    const questions = readQuestions(bench.runDir);
    assert.equal(questions.length, 1, "control: one open question exists");
    assert.ok(section(md, "Open questions").includes(questions[0].id), "the report names the question by ID");
    assert.ok(section(md, "Open questions").includes(QUESTION_MARKER), "and carries its text");

    const exclusions = section(md, "Exclusions");
    for (const excluded of res.excluded) {
      assert.ok(exclusions.includes(excluded), `the exclusions section lists ${excluded}`);
    }
    assert.ok(exclusions.includes("src/beta.mjs"), "and the preexistingDirty path publish skipped");
    assert.ok(section(md, "Metrics").includes("4711"), "the metrics section carries the §7.2 summary");
    // GAP-029: the router-contact witness records that a real MetricsSummary
    // crossed the §4.4 seam, and renders the served totalRequests so an unrouted
    // run is loud rather than silent.
    assert.ok(
      section(md, "Metrics").includes("Router contact: CONFIRMED"),
      "the metrics section states the router was CONTACTED (GAP-029)",
    );
    assert.ok(
      section(md, "Metrics").includes("totalRequests=4711"),
      "and renders the served request count beside the witness (GAP-029)",
    );

    assert.equal(res.reportPath, path.join(bench.runDir, "report.md"), "written at the §1.2 path");
    assert.equal(
      readdirSync(bench.runDir).filter((name) => name.startsWith("report.md.") && name.endsWith(".tmp")).length,
      0,
      "and atomically — no temp file survives the write",
    );
  });

  await t.test("a null metrics result is fail-soft: an unavailable line, never a crash and never a blocked report", async () => {
    const bench = buildBench();
    await handlePublish({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      itemId: "I1",
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
    });
    const res: ReportResult = await handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => null,
    });
    assert.equal(res.runState, "REPORTED", "the run still closed");
    assert.equal(res.metricsAvailable, false, "the compact return says metrics were unavailable");
    assert.ok(
      /unavailable/i.test(section(readReport(bench.runDir), "Metrics")),
      "and report.md says so on its metrics line",
    );
    // GAP-029: and the positive ABSENT witness distinguishes "router was down" from
    // "metrics were never read" — the two the G5 tautology cannot tell apart.
    assert.ok(
      section(readReport(bench.runDir), "Metrics").includes("Router contact: ABSENT"),
      "the metrics section states the router was NOT contacted (GAP-029)",
    );
  });
});

// ---------------------------------------------------------------------------
// [9.5b-report-stop-done]
// ---------------------------------------------------------------------------

test("[9.5b-report-stop-done] handleReport closes the run: run.json READ BACK FROM DISK carries state REPORTED and stop {kind:'done'}, and the EXECUTING->REPORTED edge was taken through core legalRunTransition with the work-run context and journaled fsm/transition", async () => {
  const bench = makeBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })] },
    states: { I1: "PUBLISHED" },
  });

  const res: ReportResult = await handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });

  // The PERSISTED state is the load-bearing assertion: core/stops.ts:74-76 makes isTerminal
  // true the instant a stop is recorded, so isTerminal alone would pass on a run that never
  // transitioned at all.
  const persisted = JSON.parse(readFileSync(path.join(bench.runDir, "run.json"), "utf8")) as {
    state: string;
    stop: { kind: string; reasonDisplay: string; tsMs: number } | null;
  };
  assert.equal(persisted.state, "REPORTED", "run.json on disk carries the REPORTED state");
  assert.notEqual(persisted.stop, null, "with a stop record");
  assert.equal(persisted.stop?.kind, "done", "of the closed §2.9 kind `done`");
  assert.ok((persisted.stop?.reasonDisplay ?? "").length > 0, "carrying a display reason");
  assert.equal(typeof persisted.stop?.tsMs, "number", "and a timestamp");
  assert.equal(res.runState, "REPORTED", "the compact return agrees with the disk");
  assert.equal(res.stop?.kind, "done", "and reports the stop it recorded");

  const edge = legalRunTransition("EXECUTING", "REPORTED", { classification: "work" });
  assert.equal(edge.ok, true, "control: the work-run edge is legal");
  const transitions = recordsFor(bench.journal.records, "fsm", "transition").filter(
    (r) => r.data["from"] === "EXECUTING" && r.data["to"] === "REPORTED",
  );
  assert.equal(transitions.length, 1, "the edge was journaled exactly once");
  assert.equal(transitions[0].data["why"], edge.why, "with core legalRunTransition's own rationale, verbatim");

  // The same call refuses a trivial-classified run this edge: the split is the FSM's.
  assert.equal(
    legalRunTransition("EXECUTING", "REPORTED", { classification: "trivial" }).ok,
    false,
    "a trivial run is refused EXECUTING->REPORTED by the same core derivation",
  );
});

// ---------------------------------------------------------------------------
// [9.5b-report-trivial-lite]
// ---------------------------------------------------------------------------

test("[9.5b-report-trivial-lite] a trivial run is closed by the SAME handleReport in report-lite mode: EXECUTING->TRIVIAL_DONE (never REPORTED), still running the closing verify, still writing report.md, still registering stale-red, still recording the stop kind its dispositions produce — the lite/full difference is section content only", async () => {
  const buildBench = (classification: ClassificationKind): Bench => {
    const bench = makeBench({
      classification,
      queue: {
        items: [
          makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
          makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
        ],
      },
      states: { I1: "PUBLISHED", I2: "RED" },
    });
    writeFileSync(path.join(bench.root, "tests", "b.test.mjs"), failingTest(FOREIGN_RED_MARKER));
    bench.store.setBlocked(bench.runId, "I2", { reason: BLOCK_MARKER, stage: "TEST_VETTED" });
    return bench;
  };
  const report = async (bench: Bench): Promise<ReportResult> =>
    handleReport({
      store: bench.store,
      fanout: bench.fanout,
      runId: bench.runId,
      config: bench.config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: WORKSPACE_KEY,
      metrics: async () => null,
    });

  const trivial = buildBench("trivial");
  const lite = await report(trivial);
  assert.equal(lite.mode, "lite", "the trivial run is closed in report-lite mode");
  assert.equal(lite.runState, "TRIVIAL_DONE", "advancing EXECUTING->TRIVIAL_DONE, never REPORTED");
  assert.equal(
    JSON.parse(readFileSync(path.join(trivial.runDir, "run.json"), "utf8")).state,
    "TRIVIAL_DONE",
    "as persisted on disk",
  );
  // GAP-021: the recorded kind is the CLOSER's, not the mode's. This fixture leaves
  // I2 blocked, and ISSUE-065 recorded that shape closing `done` — "the run
  // completed" over an item still waiting on a human. What the lite/full split owes
  // is that BOTH modes record the SAME kind through the SAME derivation, which the
  // work half asserts below.
  assert.equal(lite.stop?.kind, "blocked", "recording the stop kind the run's dispositions produce");
  assert.equal(verifyRecords(trivial.runDir).length, 1, "still running the closing verify (only 9.5c's stop mode skips it)");
  assert.deepEqual(lite.staleRedAdded, ["tests/b.test.mjs"], "still registering stale-red through the shared helper");
  const liteMd = readReport(trivial.runDir);
  assert.notEqual(itemSection(liteMd, "I1"), "", "still writing the per-item sections");

  const work = buildBench("work");
  const full = await report(work);
  assert.equal(full.mode, "full", "a work run is closed in full mode by the SAME handler");
  assert.equal(full.runState, "REPORTED", "to REPORTED");
  assert.equal(full.stop?.kind, lite.stop?.kind, "and recording the SAME stop kind as lite on the same dispositions");
  const fullMd = readReport(work.runDir);

  // One writer, one mode parameter: the skeleton is shared, and the ONLY documented
  // difference on this fixture (an EMPTY decision ledger) is the section lite drops.
  assert.equal(hasSection(fullMd, "Decisions"), true, "full mode renders the empty Decisions section");
  assert.equal(hasSection(liteMd, "Decisions"), false, "lite mode omits it (a trivial run never created one)");
  const liteHeadings = headingsOf(liteMd).filter((h) => h.toLowerCase() !== "## decisions");
  const fullHeadings = headingsOf(fullMd).filter((h) => h.toLowerCase() !== "## decisions");
  assert.deepEqual(liteHeadings, fullHeadings, "every other section — and its order — is identical");
});
