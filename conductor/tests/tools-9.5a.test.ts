// Task 9.5a RED tests — FINAL LOCATION conductor/tests/tools-9.5a.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the §3.3 VALIDATED->REVIEWED handler added
// to the EXISTING conductor/adapter/tools.ts (which today carries the §5.3 gate wiring plus
// the Task 9.1/9.2/9.3/9.4a/9.4b/9.4c handlers). The red is the missing-export shape —
// tools.ts resolves, but this named binding does not yet exist:
//   handleItemReview  (conductor_item_review — the §3.3 lens fan-out, the per-finding
//                      skeptic panels, the path-routed fix loop, and the bounded
//                      fix => re-validate => re-review cycle)
// together with its two input/result types (ItemReviewInput / ItemReviewResult), which this
// file restates STRUCTURALLY below rather than importing, so the ONE unresolved import is
// the handler itself (the 9.4c convention).
//
// EVERY other import here resolves to a committed export today. ONE row goes red as an
// ASSERTION failure rather than an unresolved import, and that is deliberate:
// [9.5a-receive-review-pack-delivered] asserts NEW behaviour from the ALREADY-EXPORTED
// adapter/inject.ts buildSystemAppend — exactly as 9.4c's gate row did.
//
// The handler follows the §3.4 invariant loop — legality → derive → persist → journal →
// compact return — and REUSES the committed machinery rather than reimplementing it:
// core/verdict.ts findingSurvives (survival arithmetic), core/schedule.ts readFanout
// (configured counts), core/fsm-item.ts legalItemTransition (the edge), adapter/fanout.ts
// (every sub-session), adapter/evidence.ts runTest/runVerify (every child process),
// adapter/questions.ts appendQuestion + adapter/state.ts setBlocked (the cap exit).
// Sub-session traffic goes through the injected Fanout over the FAKE SDK
// (tests/fixtures/fake-sdk.ts); the item test, the reverted-behaviour probe and the
// re-validate run against REAL on-disk `git init` fixture repos and REAL child processes.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.5a (2652-2665) — the authoritative behaviour of the tool.
//   §3.3 (1232-1271)         — the lens set, the session-count rule, the adjudication
//                              ordering, the skeptic rule, the routing table, the
//                              re-vet requirement and the round cap.
//   §2.1 (563-570)           — itemReviewers, skepticsPerFinding, reviewMaxRounds,
//                              vetCritics.
//   §4.3                     — readFanout: the configured count clamped to maxReaders.
//   docs/build/specs/task-9.5a.assertions.json — the 14 rows mapped to the 14 tests
//                              below, its rosterSizingRule, its bindings, its
//                              verifiedAgainstHead facts, its reusesExisting list and
//                              its six resolved specGaps.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.5a.assertions.json; this file is the contract
// that pins them):
//  (G1) SESSION COUNT. sessions = clamp(readFanout("itemReview", config), 3, 6). The
//       rosterSizingRule's "floor at the named coverage set" is expressed THROUGH that
//       clamp plus the pairwise merge, so three sessions still cover all five mandatory
//       lenses. parallel.maxReaders is a wall-clock ceiling the fan-out engine enforces
//       internally; it is NEVER a coverage truncation.
//  (G2) THE CLAMP WARNING. When the PRE-clamp value is below 3 — whichever knob caused it
//       — the handler emits a level:"warn" JournalRecord on the EXISTING fanout
//       "subsession.dispatched" event of the FIRST review dispatch, with data naming the
//       configured (pre-clamp) and clamped values. JournalRecord.level is committed
//       (types.ts:435), so NO §7.4 event vocabulary widening happens anywhere in 9.5a.
//  (G3) WHICH LENSES ARE "QUALITY". The discard TRIGGER is a surviving spec/contract
//       finding; the DISCARDED-and-re-derived set is test-adequacy, minimality and perf.
//       Correctness and guardrail are tier-1: RETAINED and fixed alongside the spec
//       findings.
//  (G4) THE "WHERE CHEAP" PROBE. Attempt it iff the item's fileScope is non-empty AND the
//       working-tree changes round-trip via `git stash push -- <fileScope>` /
//       `git stash pop`, restored in a finally. ANY stash failure SKIPS the probe. The
//       probe AUGMENTS and never replaces the mandatory re-run + re-vet.
//  (G5) PUSHBACK DETECTION. Pushback = a fix dispatch returning ImplementerResult status
//       "DONE_WITH_CONCERNS" whose concerns[] names the finding id. NEEDS_CONTEXT and
//       BLOCKED follow the standard implementer-status escalation instead (no row here
//       exercises that, so no test below constrains it).
//  (G6) UNDER-DELIVERED SKEPTIC PANEL. Exactly ONE re-dispatch attempt of the missing
//       sessions, then any verdict STILL missing counts as an UPHOLD (conservative — keep
//       the finding). The row accepts either observable outcome; this pin is for the
//       implementer.
//
// ---------------------------------------------------------------------------
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) A ROUND is one lens fan-out + its skeptic panels + the routed fixes + the
//       re-validate. `item.attempts.reviewRounds` counts rounds STARTED. A round whose
//       surviving set is EMPTY advances the item VALIDATED->REVIEWED through core
//       legalItemTransition. A round with survivors runs the fixes, re-validates and
//       starts the NEXT round — unless reviewRounds has reached
//       config.workflow.reviewMaxRounds, in which case the handler mints ONE §2.11
//       question (origin "review-round-cap") naming the still-surviving findings and
//       blocks the item, which STAYS at VALIDATED.
//  (P2) THE LENS PROMPT CONTRACT. Every reviewer LENS prompt carries a line of the exact
//       form `LENSES: <id>[, <id>]`, with ids drawn from the closed §3.3 vocabulary
//       ["spec/contract","correctness","guardrail","test-adequacy","minimality","perf"].
//       That line is how a lens session is attributable to its lens without reading the
//       engine's internal FanoutJob.lens field. A reviewer-role prompt WITHOUT that line
//       is a TEST-VET critic (§2.10 TestVet), never a lens session — which is what makes
//       the re-vet on the testWriter route countable.
//  (P3) THE FINDING-ID CONTRACT. Every skeptic prompt names the finding id it adjudicates;
//       every fix dispatch (implementer or testWriter) names the finding id(s) it must
//       address; the pushback skeptic round additionally carries the implementer's own
//       reasoning VERBATIM. Ids are how this file binds a sub-session to a finding —
//       never an ordinal.
//  (P4) EVERY LENS DISPATCH CARRIES the item's DIFF, its §2.4 SPEC (title + acceptance)
//       and its TEST — §3.3's "fresh reviewers over the item's diff + spec + test".
//  (P5) A DENIAL THROWS (the 9.1-9.4c convention, and what makes "nothing was dispatched"
//       checkable): a call against an item the gate does not offer conductor_item_review
//       for throws BEFORE any sub-session is created. A round cap is an OUTCOME, not a
//       refusal: it returns ok:false.
//  (P6) THE RECEIVE-REVIEW SIGNAL rides the §3.5 SESSION REGISTRY ENTRY — the only
//       per-session input buildSystemAppend has, and the same object the committed
//       debug.md guard already keys its role/itemId test on. It cannot ride item state:
//       the SAME item's other implementer dispatches (a debug fix, a green fix) must NOT
//       receive receive-review.md. This file asserts only the OBSERVABLE: hand the LIVE
//       registry entry of the fix dispatch to the committed buildSystemAppend and
//       receive-review.md must come back as a SECONDARY pack, with tdd.md still at
//       append[0].
//  (P7) The handler NEVER re-implements the §4.2 foreign-red set, the quarantine, the
//       verify marker or the item-test command derivation: every child process is
//       reached through adapter/evidence.ts, which is why the fixture's witness files
//       (written by the REAL scope commands) are admissible ordering evidence.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). ONE options
// object, the 9.4b/9.4c convention; runDir is derived as
// <store.root>/.conductor/runs/<runId>/ and the fixture repo IS <store.root>.
//
//   export interface ItemReviewInput {
//     store: StateStore; fanout: Fanout; runId: string; itemId: string; config: Config;
//     journal: HandlerJournal; stateHome: string; workspaceKey: string;
//     packs: Record<string, string>; sessionID?: string; now?: () => number;
//   }
//
//   export interface ItemReviewResult {
//     ok: boolean;               // true IFF the item advanced VALIDATED->REVIEWED
//     itemState: ItemState;      // the PERSISTED state after the call
//     rounds: number;            // review rounds run (== item.attempts.reviewRounds)
//     surviving: string[];       // finding ids still surviving at exit ([] on a clean exit)
//     questionId: string | null; // the "review-round-cap" question (null on a clean exit)
//   }
//
//   export async function handleItemReview(input: ItemReviewInput): Promise<ItemReviewResult>
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id as its FIRST token):
//   9.5a-mandatory-lenses-at-3        → itemReviewers 3 still covers all five mandatory
//                                       lenses, in the §3.3 merged composition.
//   9.5a-lens-count-rule              → the composition at 6/5/4, the sub-3 clamp + warn,
//                                       and maxReaders below the floor NOT truncating.
//   9.5a-trivial-guardrail            → a trivial run uses the trivial composition at
//                                       itemReviewers 6, guardrail intact.
//   9.5a-adjudication-ordering        → surviving spec/contract ⇒ quality findings
//                                       discarded and re-derived after the fix.
//   9.5a-skeptics-findingsurvives     → k=2 tie UPHOLDS via core findingSurvives; a
//                                       refuted finding costs nothing.
//   9.5a-underdelivered-panel-upholds → BINDING: a crashed skeptic never drops a major.
//   9.5a-route-implementer-filescope  → fileScope-only ⇒ implementer ⇒ re-validate ⇒
//                                       re-review.
//   9.5a-route-testwriter-test-discipline → testScope ⇒ testWriter, NEVER the implementer;
//                                       re-run + re-vet BEFORE re-validate.
//   9.5a-route-both-sequential        → testWriter FIRST, implementer SECOND, sequential.
//   9.5a-reverted-behavior-probe      → both branches of the "where cheap" probe.
//   9.5a-pushback-one-skeptic-round   → DONE_WITH_CONCERNS ⇒ exactly one extra skeptic
//                                       round, never more.
//   9.5a-receive-review-pack-delivered → BINDING/C-028: DELIVERED, not merely loaded.
//   9.5a-zero-survivors-reviewed      → the clean exit through legalItemTransition, and
//                                       the pre-dispatch refusal off VALIDATED.
//   9.5a-round-cap-question-blocked   → ONE "review-round-cap" question + the PERSISTED
//                                       blocked item.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// THE SUBJECT — absent at red time (missing-export red from the existing tools.ts).
import { handleItemReview } from "../adapter/tools.ts";

// Adapters + core that DO exist today.
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, RegistryEntry, TreeState } from "../adapter/fanout.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { buildSystemAppend, loadPacks } from "../adapter/inject.ts";
import type { SessionRegistryEntry } from "../adapter/chat-message.ts";
import type { GateItem, GateQuestion, GateRun } from "../core/gates-phase.ts";
import { readFanout } from "../core/schedule.ts";
import { findingSurvives } from "../core/verdict.ts";
import { legalItemTransition } from "../core/fsm-item.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import { MAIN_TREE, treePath, validate } from "../core/types.ts";
import type {
  Config,
  EvidenceRecord,
  Item,
  ItemState,
  LogLevel,
  Queue,
  QueueItem,
  TreePath,
  Verdict,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import { witnessFromPrompt } from "./fixtures/review-witness.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY so every call site below type-checks the
// green implementation against this file's contract (the 9.4a/9.4b/9.4c convention).
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

interface ItemReviewResultShape {
  ok: boolean;
  itemState: ItemState;
  rounds: number;
  surviving: string[];
  questionId: string | null;
}

// ---------------------------------------------------------------------------
// §3.3 lens vocabulary (P2). Closed — a prompt naming anything else fails the parse.
// ---------------------------------------------------------------------------

const SPEC = "spec/contract";
const CORRECTNESS = "correctness";
const GUARDRAIL = "guardrail";
const TEST_ADEQUACY = "test-adequacy";
const MINIMALITY = "minimality";
const PERF = "perf";

// The FIRST FIVE are mandatory and are never truncated by configuration (§3.3).
const MANDATORY_LENSES: readonly string[] = [SPEC, CORRECTNESS, GUARDRAIL, TEST_ADEQUACY, MINIMALITY];
const ALL_LENSES: readonly string[] = [...MANDATORY_LENSES, PERF];

// The §3.3 compositions, keyed by SESSION COUNT. 3 is the trivial-run composition.
const COMPOSITIONS: Record<number, string[][]> = {
  6: [[SPEC], [CORRECTNESS], [GUARDRAIL], [TEST_ADEQUACY], [MINIMALITY], [PERF]],
  5: [[SPEC], [CORRECTNESS], [GUARDRAIL], [TEST_ADEQUACY], [MINIMALITY, PERF]],
  4: [[SPEC, TEST_ADEQUACY], [CORRECTNESS], [GUARDRAIL], [MINIMALITY, PERF]],
  3: [[SPEC, CORRECTNESS], [GUARDRAIL, MINIMALITY], [TEST_ADEQUACY, PERF]],
};

// The quality lenses a surviving spec/contract finding discards for that round (G3).
const QUALITY_LENSES: readonly string[] = [TEST_ADEQUACY, MINIMALITY, PERF];

// Order-insensitive both across sessions and within a session, so the implementation is
// free to dispatch the groups in any order.
function compositionKey(groups: readonly (readonly string[])[]): string {
  return groups
    .map((group) => [...group].sort().join("+"))
    .sort()
    .join(" | ");
}

// P2: the machine-readable lens declaration. Returns null for a prompt that carries none
// (a TEST-VET critic, a skeptic, an implementer, a test-writer).
function lensesOf(text: string): string[] | null {
  const match = /^LENSES:[ \t]*(.+)$/m.exec(text);
  if (match === null) return null;
  const ids = match[1]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return ids.length > 0 ? ids : null;
}

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a
// value DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-9501";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-9502";
const TEST_MARKER = "ITEM-TEST-MARKER-9503";
const FIX_MARKER = "WORKING-TREE-FIX-MARKER-9504";
const PUSHBACK_MARKER = "PUSHBACK-REASONING-MARKER-9505: the finding misreads the contract";
const MUSTFIX_MARKER = "MUSTFIX-MARKER-9506: assert the sign, not the magnitude";

// The verify scope name is deliberately distinctive so a hardcoded "unit" cannot satisfy it.
const SCOPE = "unit9507";

// A fixed injected clock: every stamped value the handler mints reads it.
const START_MS = 1_754_990_000_000;

// The §4.2 shared tree under parallel.writes "off", as the evidence layer's marker
// SLUG. The same tree's gate-side PATH is the workspace itself — bench.root — and
// the two are different types (core/types.ts); a dispatch tree is always the path.
const TREE = MAIN_TREE;

// This file's home (conductor/tests/) — the doctrine packs are read RELATIVE to it.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");

// The REAL doctrine packs through the COMMITTED loader — the receive-review row is fed
// from this map, never from a literal typed here.
const PACKS: Record<string, string> = loadPacks(DOCTRINE_DIR);

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom). Every fixture
// is a throwaway repo under os.tmpdir(); the out-of-repo state home is a SEPARATE dir.
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

function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools95a-state-"));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// The fixture repo: a REAL behavioural change sitting uncommitted in the working tree.
//
//   committed  src/a.mjs  drops the sign  -> tests/a.test.mjs FAILS   (the REVERTED tree)
//   worktree   src/a.mjs  keeps the sign  -> tests/a.test.mjs PASSES  (the item's change)
//
// That is what makes the §3.3 "reverted-behavior probe" a REAL probe: `git stash push --
// src/a.mjs` genuinely reverts the behaviour and the changed test genuinely fails against
// it, with no faking anywhere in the loop.
// ---------------------------------------------------------------------------

const SUBJECT_REL = "src/a.mjs";
const TEST_REL = "tests/a.test.mjs";

const REVERTED_SUBJECT = "export function parse(s) { return Math.abs(Number(s)); }\n";
const FIXED_SUBJECT = `export function parse(s) { return Number(s); } // ${FIX_MARKER}\n`;

const ITEM_TEST_SOURCE =
  `// ${TEST_MARKER}\n` +
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'import { parse } from "../src/a.mjs";\n' +
  'test("keeps the sign of negative offsets", () => {\n' +
  '  assert.equal(parse("-7"), -7, "sign");\n' +
  "});\n";

// `trackSubject:false` leaves src/a.mjs UNTRACKED, which is exactly what makes
// `git stash push -- src/a.mjs` fail ("pathspec … did not match any file(s) known to
// git") — the SKIP branch of the probe, produced by real git rather than by a stub.
function reviewRepo(trackSubject: boolean): TreePath {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools95a-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  // REPO-LOCAL identity, so the handler's OWN git invocations (the §3.3 probe's
  // `git stash push`, which mints a real commit object) succeed no matter what
  // environment the handler happens to run them under.
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  writeFileSync(path.join(dir, TEST_REL), ITEM_TEST_SOURCE);
  if (trackSubject) {
    writeFileSync(path.join(dir, SUBJECT_REL), REVERTED_SUBJECT);
    git(dir, ["add", "seed.txt", TEST_REL, SUBJECT_REL]);
  } else {
    git(dir, ["add", "seed.txt", TEST_REL]);
  }
  git(dir, ["commit", "-m", "seed"]);
  // The item's own (uncommitted) change.
  writeFileSync(path.join(dir, SUBJECT_REL), FIXED_SUBJECT);
  return treePath(dir);
}

// A REAL `git worktree` on its own branch — the §4.2 isolation the wave driver
// creates and persists onto the item as `item.worktree`. Real rather than a made-up
// path because the handler EXECUTES in it (the re-validate's cwd), not just dispatches
// into it.
function worktreeFor(repo: string, itemId: string): TreePath {
  const parent = mkdtempSync(path.join(tmpdir(), "conductor-tools95a-wt-"));
  tmpDirs.push(parent);
  const wt = path.join(parent, itemId);
  git(repo, ["worktree", "add", "-b", `conductor/${itemId}`, wt]);
  return treePath(wt);
}

function subjectOnDisk(root: string): string {
  return readFileSync(path.join(root, SUBJECT_REL), "utf8");
}

function stashList(root: string): string {
  return git(root, ["stash", "list"]).trim();
}

// ---------------------------------------------------------------------------
// The §2.1 scope COMMANDS — real child processes that leave an admissible witness trail.
//
//  verifyCmd   : the FULL verify (runVerify). Appends one line per run and exits 0, so
//                every re-validate is countable and always green (a red verify is
//                conductor_validate's business, not this stage's).
//  itemTestCmd : the ITEM TEST (runTest, via the §2.1 itemTest template). Snapshots the
//                CONTENT of the item's fileScope file, then spawns the real
//                `node --test <files>` and exits with its status — so a run against the
//                REVERTED tree is distinguishable from a run against the fixed tree by
//                what the child actually saw, not by when it happened.
// ---------------------------------------------------------------------------

function verifyCmd(witness: string): string[] {
  const script =
    "const fs=require('fs');\n" + `fs.appendFileSync(${JSON.stringify(witness)}, "verify\\n");\n` + "process.exit(0);\n";
  return [process.execPath, "-e", script];
}

function itemTestCmd(witness: string, repoRoot: string): string[] {
  const script =
    "const fs=require('fs'),path=require('path'),cp=require('child_process');\n" +
    `const repo=${JSON.stringify(repoRoot)};\n` +
    `const subjectPath=path.join(repo, ${JSON.stringify(SUBJECT_REL)});\n` +
    "const subject = fs.existsSync(subjectPath) ? fs.readFileSync(subjectPath,'utf8') : null;\n" +
    "const files = process.argv.slice(1);\n" +
    "const r = cp.spawnSync(process.execPath, ['--test', ...files], { cwd: repo, encoding: 'utf8' });\n" +
    "const code = r.status === null ? 1 : r.status;\n" +
    `fs.appendFileSync(${JSON.stringify(witness)}, JSON.stringify({subject, files, code}) + "\\n");\n` +
    "process.stdout.write(r.stdout || '');\n" +
    "process.stderr.write(r.stderr || '');\n" +
    "process.exit(code);\n";
  return [process.execPath, "-e", script, "{files}"];
}

function countLines(file: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0).length;
}

interface ItemTestRun {
  subject: string | null;
  files: string[];
  code: number;
}

function itemTestRuns(witness: string): ItemTestRun[] {
  if (!existsSync(witness)) return [];
  return readFileSync(witness, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ItemTestRun);
}

// ---------------------------------------------------------------------------
// Journal sinks (the tools-9.1…9.4c harness shape).
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
// closed §7.4 vocabulary (core/journal-events.ts EVENTS): a handler that invented an
// event name for the clamp warning fails loudly instead of quietly widening it.
function makeRealJournal(runDir: string, config: Config): { sink: JournalSink; records: CaptureRecord[] } {
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

// Does this record's data carry EVERY one of these values anywhere? Deliberately
// key-agnostic: G2 pins the VALUES the warning must name, not the field names.
function dataCarries(data: Record<string, unknown>, values: readonly unknown[]): boolean {
  const seen = new Set<unknown>(Object.values(data));
  return values.every((value) => seen.has(value));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface FixtureScope {
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
}

interface ConfigOpts {
  command: string[];
  itemTest: string[];
  itemReviewers?: number;
  skepticsPerFinding?: number;
  reviewMaxRounds?: number;
  vetCritics?: number;
  maxReaders?: number;
}

function makeConfig(opts: ConfigOpts): Config {
  const scope: FixtureScope = {
    command: [...opts.command],
    timeoutMs: 120_000,
    itemTest: [...opts.itemTest],
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
      planReviewMaxRounds: 3,
      itemReviewers: opts.itemReviewers ?? 6,
      skepticsPerFinding: opts.skepticsPerFinding ?? 1,
      reviewMaxRounds: opts.reviewMaxRounds ?? 3,
      vetCritics: opts.vetCritics ?? 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: {
      writes: "off",
      maxImplementers: 4,
      maxReaders: opts.maxReaders ?? 8,
      subSessionTimeoutMs: 120_000,
    },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// The §3.3 session count this config produces (G1): clamp(readFanout, 3, 6).
function expectedSessions(config: Config): number {
  const pre = readFanout("itemReview", config);
  return Math.min(6, Math.max(3, pre));
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
const ITEM_ID = "I1";

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

function makeQueueItem(id: string): QueueItem {
  return {
    id,
    title: `keep the sign of negative offsets (${TITLE_MARKER})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [SUBJECT_REL],
    testScope: [TEST_REL],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

const QUEUE: Queue = { items: [makeQueueItem(ITEM_ID)] };

// Drive a run to EXECUTING WITHOUT calling any other task's handler (direct on-disk
// seeding, the tools-9.2/9.3/9.4a/9.4b/9.4c discipline).
function seedExecuting(store: StateStore, runId: string, state: ItemState, trivial: boolean): void {
  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  if (trivial) run.classification.kind = "trivial";
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(QUEUE, null, 2));
  store.saveItem(runId, makeRuntimeItem(ITEM_ID, state));
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function itemFileBytes(runDir: string, itemId: string): string {
  return readFileSync(path.join(runDir, "items", `${itemId}.json`), "utf8");
}

// ---------------------------------------------------------------------------
// The §2.10 receipts every sub-session replies with. Each is schema-checked in the
// probe block below, so a red is about the handler and never about the fixture.
// ---------------------------------------------------------------------------

interface FixtureFinding {
  id: string;
  lens: string;
  suggestedFix: string;
  severity?: "major" | "minor" | "nit";
  claim?: string;
  evidence?: string;
}

// GAP-011: every lens reply carries the read witness the handler re-derives against
// the item's diff — read out of the prompt the reviewer was handed, the way a
// reviewer who opened the diff would produce it.
function findingsJson(findings: readonly FixtureFinding[], promptText = ""): string {
  return JSON.stringify({
    findings: findings.map((f) => ({
      id: f.id,
      severity: f.severity ?? "major",
      lens: f.lens,
      claim: f.claim ?? `finding ${f.id} raised by the ${f.lens} lens`,
      evidence: f.evidence ?? `see ${SUBJECT_REL} and ${TEST_REL}`,
      suggestedFix: f.suggestedFix,
    })),
    readWitness: witnessFromPrompt(promptText),
  });
}

const NO_FINDINGS = findingsJson([]);

// GAP-036: `upheld:false` counts as a REFUTATION only when it carries the
// discriminating input, the run and the reading. Every overturn below is an
// evidenced one, so these rows still mean what they meant; `abstain` is the
// evidence-free form, which upholds.
function verdictJson(findingId: string, upheld: boolean, reasoning?: string, abstain = false): string {
  return JSON.stringify({
    findingId,
    upheld,
    reasoning: reasoning ?? (upheld ? `${findingId} stands up to refutation` : `${findingId} does not survive refutation`),
    refutationEvidence:
      upheld || abstain
        ? null
        : {
            discriminatingInput: `the input ${findingId} claims reaches the defect`,
            run: `re-ran the item test against ${SUBJECT_REL} with that input`,
            reading: "the cited line is guarded on the branch above, so the claim does not reproduce",
          },
  });
}

function implJson(status = "DONE", summary = "applied the routed fix", concerns: readonly string[] = []): string {
  return JSON.stringify({
    status,
    summary,
    concerns: [...concerns],
    neededContext: null,
    blockReason: null,
  });
}

function vetJson(mustFix: readonly string[]): string {
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

// ---------------------------------------------------------------------------
// Fan-out wiring over the FAKE SDK. Every ordering claim in this file is read off
// `wiring.prompted` (the fixture's monotonic prompt log) and off the WITNESS COUNTS
// recorded at the instant each prompt was sent — never off wall time.
// ---------------------------------------------------------------------------

type Canned = { kind: "reply"; text: string } | { kind: "error"; error: unknown } | { kind: "park" };

interface RespondReq {
  role: string;
  itemId: string;
  sessionID: string;
  // 0-based ordinal of this SESSION among the (role,itemId) sessions, assigned on its
  // first prompt — stable across the fan-out engine's bounded re-prompt retries.
  sessionNth: number;
  // 1-based prompt attempt WITHIN this session (1 = initial, 2 = first retry, …).
  attempt: number;
  // 0-based ordinal of this LENS session among lens sessions; -1 for a non-lens prompt.
  lensOrdinal: number;
  lenses: string[] | null;
  text: string;
}

type Responder = (req: RespondReq) => Canned;

interface PromptedRecord {
  seq: number;
  role: string;
  itemId: string;
  tree: string;
  sessionID: string;
  sessionNth: number;
  attempt: number;
  lensOrdinal: number;
  lenses: string[] | null;
  text: string;
  // Witness counts AT THE INSTANT this prompt was sent — the file's ordering currency.
  verifies: number;
  itemTests: number;
  // The LIVE §3.5 registry entry for this session (P6). Captured by reference before the
  // fan-out engine deletes it, so any signal the handler threaded onto it is observable.
  entry: RegistryEntry | undefined;
}

interface Wiring {
  fanout: Fanout;
  sdk: ReturnType<typeof makeFakeSdk>;
  registry: Map<string, RegistryEntry>;
  prompted: PromptedRecord[];
  byRole: (role: string) => PromptedRecord[];
  lensPrompts: () => PromptedRecord[];
  vetPrompts: () => PromptedRecord[];
  fixPrompts: () => PromptedRecord[];
}

interface Witnesses {
  verify: string;
  itemTest: string;
}

function applyFixtureFix(root: string, role: string, sessionID: string): void {
  const rel = role === "testWriter" ? TEST_REL : SUBJECT_REL;
  const file = path.join(root, rel);
  if (!existsSync(file)) return;
  writeFileSync(file, readFileSync(file, "utf8") + `// review fix by ${role} ${sessionID}\n`);
}

function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  witnesses: Witnesses,
  respond: Responder,
  root: string,
): Wiring {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const sessionOrdinals = new Map<string, number>();
  const perRoleItem = new Map<string, number>();
  const lensOrdinals = new Map<string, number>();
  let lensSeen = 0;

  // The §3.5 tree view. No fixture in this file freezes a tree, so admission is open and
  // `onClear` never fires; the engine's own hold path is exercised by tests/fanout.test.ts.
  const treeState: TreeState = {
    isFrozen(): boolean {
      return false;
    },
    onClear(): () => void {
      return (): void => undefined;
    },
  };

  sdk.setResponder((req) => {
    const entry = registry.get(req.sessionID);
    const role = entry?.role ?? "";
    const itemId = entry?.itemId ?? "";
    let sessionNth = sessionOrdinals.get(req.sessionID);
    if (sessionNth === undefined) {
      const key = `${role} ${itemId}`;
      sessionNth = perRoleItem.get(key) ?? 0;
      perRoleItem.set(key, sessionNth + 1);
      sessionOrdinals.set(req.sessionID, sessionNth);
    }
    const lenses = lensesOf(req.text);
    let lensOrdinal = -1;
    if (lenses !== null) {
      const known = lensOrdinals.get(req.sessionID);
      if (known === undefined) {
        lensOrdinal = lensSeen;
        lensOrdinals.set(req.sessionID, lensOrdinal);
        lensSeen += 1;
      } else {
        lensOrdinal = known;
      }
    }
    prompted.push({
      seq: sdk.prompts[sdk.prompts.length - 1].seq,
      role,
      itemId,
      tree: entry?.tree ?? "",
      sessionID: req.sessionID,
      sessionNth,
      attempt: req.attempt,
      lensOrdinal,
      lenses,
      text: req.text,
      verifies: countLines(witnesses.verify),
      itemTests: countLines(witnesses.itemTest),
      entry,
    });
    const canned = respond({
      role,
      itemId,
      sessionID: req.sessionID,
      sessionNth,
      attempt: req.attempt,
      lensOrdinal,
      lenses,
      text: req.text,
    });
    if (canned.kind === "park") return { kind: "pending" };
    if (canned.kind === "error") return { kind: "error", error: canned.error };
    if (role === "implementer" || role === "testWriter") applyFixtureFix(root, role, req.sessionID);
    return { kind: "reply", text: canned.text };
  });

  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    treeState,
    runId,
  );

  // Only the FIRST prompt of a session counts as a dispatch; the engine's bounded
  // re-prompt retries re-use the same session and must never inflate a fan-out count.
  const firsts = (): PromptedRecord[] => prompted.filter((p) => p.attempt === 1);

  return {
    fanout,
    sdk,
    registry,
    prompted,
    byRole: (role: string) => firsts().filter((p) => p.role === role),
    lensPrompts: () => firsts().filter((p) => p.lenses !== null),
    vetPrompts: () => firsts().filter((p) => p.role === "reviewer" && p.lenses === null),
    fixPrompts: () => firsts().filter((p) => p.role === "implementer" || p.role === "testWriter"),
  };
}

// ---------------------------------------------------------------------------
// The bench: one VALIDATED behavioural item over a real repo, wired to the fake SDK.
// ---------------------------------------------------------------------------

interface Bench {
  root: TreePath;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  witnesses: Witnesses;
  wiring: Wiring;
}

interface BenchOpts {
  respond: Responder;
  itemReviewers?: number;
  skepticsPerFinding?: number;
  reviewMaxRounds?: number;
  vetCritics?: number;
  maxReaders?: number;
  itemState?: ItemState;
  trivial?: boolean;
  trackSubject?: boolean;
  realJournal?: boolean;
}

function seedBench(opts: BenchOpts): Bench {
  const root = reviewRepo(opts.trackSubject ?? true);
  const stateHome = freshStateHome();
  const witnesses: Witnesses = {
    verify: path.join(stateHome, "verify-runs.txt"),
    itemTest: path.join(stateHome, "item-test-runs.jsonl"),
  };
  const config = makeConfig({
    command: verifyCmd(witnesses.verify),
    itemTest: itemTestCmd(witnesses.itemTest, root),
    ...(opts.itemReviewers !== undefined ? { itemReviewers: opts.itemReviewers } : {}),
    ...(opts.skepticsPerFinding !== undefined ? { skepticsPerFinding: opts.skepticsPerFinding } : {}),
    ...(opts.reviewMaxRounds !== undefined ? { reviewMaxRounds: opts.reviewMaxRounds } : {}),
    ...(opts.vetCritics !== undefined ? { vetCritics: opts.vetCritics } : {}),
    ...(opts.maxReaders !== undefined ? { maxReaders: opts.maxReaders } : {}),
  });
  // The store is opened with a THROWAWAY sink first, because the REAL journal needs the
  // run directory the store has not created yet.
  const bootstrap = makeJournal();
  const store = openStore(root, bootstrap.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  seedExecuting(store, runId, opts.itemState ?? "VALIDATED", opts.trivial ?? false);
  const journal = opts.realJournal === true ? makeRealJournal(runDir, config) : makeJournal();
  const wiring = makeWiring(runId, config, journal.sink, witnesses, opts.respond, root);
  return { root, stateHome, store, runId, runDir, config, journal, witnesses, wiring };
}

function review(bench: Bench, itemId = ITEM_ID): Promise<ItemReviewResultShape> {
  return handleItemReview({
    store: bench.store,
    fanout: bench.wiring.fanout,
    runId: bench.runId,
    itemId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: "wkey-9.5a",
    packs: PACKS,
    sessionID: "ses_orchestrator",
    now: () => START_MS,
  }) as Promise<ItemReviewResultShape>;
}

// ---------------------------------------------------------------------------
// Responder builders. Round detection is DETERMINISTIC and ordinal-free at the call
// site: a round is `floor(lensOrdinal / sessionsPerRound)`, and a lens session's
// ordinal is fixed at its FIRST prompt (so the engine's retries never shift it).
// ---------------------------------------------------------------------------

interface ScriptOpts {
  sessionsPerRound: number;
  // Findings raised per ROUND, per LENS. A lens session covering two lenses returns the
  // union of both entries — merging must never lose a lens's findings.
  perRound: Array<Record<string, FixtureFinding[]>>;
  // The skeptic panel's answer. `nth` is the 0-based ordinal of this verdict WITHIN the
  // finding's panel (including the pushback round, which continues the same counter).
  verdict?: (findingId: string, nth: number, text: string) => Canned;
  // The fix dispatch's answer (implementer AND testWriter).
  fix?: (req: RespondReq, findingIds: string[]) => Canned;
  // The TEST-VET critics' mustFix union.
  vetMustFix?: string[];
  // The whole TEST-VET receipt, for a row that needs verdict fields `vetMustFix`
  // cannot express (ISSUE-013: a pass:false beside an EMPTY mustFix).
  vetReply?: Canned;
  // Every finding id this script can mint — how a skeptic/fix prompt is bound to its
  // finding (P3). Ids are distinctive, so substring matching is unambiguous.
  findingIds: string[];
}

function scripted(opts: ScriptOpts): Responder {
  const panelCounts = new Map<string, number>();
  return (req: RespondReq): Canned => {
    if (req.lenses !== null) {
      const round = Math.floor(req.lensOrdinal / opts.sessionsPerRound);
      const table = opts.perRound[round] ?? {};
      const out: FixtureFinding[] = [];
      for (const lens of req.lenses) {
        for (const finding of table[lens] ?? []) out.push(finding);
      }
      return { kind: "reply", text: findingsJson(out, req.text) };
    }
    const named = opts.findingIds.filter((id) => req.text.includes(id));
    if (req.role === "skeptic") {
      const findingId = named[0] ?? "";
      const nth = panelCounts.get(findingId) ?? 0;
      panelCounts.set(findingId, nth + 1);
      if (opts.verdict !== undefined) return opts.verdict(findingId, nth, req.text);
      return { kind: "reply", text: verdictJson(findingId, true) };
    }
    if (req.role === "implementer" || req.role === "testWriter") {
      if (opts.fix !== undefined) return opts.fix(req, named);
      return { kind: "reply", text: implJson() };
    }
    // A reviewer prompt with no LENSES line is a §2.10 TEST-VET critic (P2).
    if (opts.vetReply !== undefined) return opts.vetReply;
    return { kind: "reply", text: vetJson(opts.vetMustFix ?? []) };
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function lensGroupsOf(wiring: Wiring, round: number, sessionsPerRound: number): string[][] {
  return wiring
    .lensPrompts()
    .filter((p) => Math.floor(p.lensOrdinal / sessionsPerRound) === round)
    .map((p) => p.lenses as string[]);
}

function assertLensVocabulary(groups: readonly (readonly string[])[]): void {
  for (const group of groups) {
    for (const id of group) {
      assert.ok(ALL_LENSES.includes(id), `the lens id "${id}" is in the closed §3.3 lens vocabulary`);
    }
  }
}

// Every lens prompt must carry §3.3's three inputs: the item's DIFF, its SPEC and its
// TEST (P4). The diff marker only exists in the WORKING TREE, so a prompt carrying it
// was built from a real diff and not from the committed file.
function assertCarriesDiffSpecTest(prompt: PromptedRecord): void {
  assert.ok(prompt.text.includes(FIX_MARKER), `the ${prompt.lenses?.join("+") ?? "?"} lens prompt carries the item's DIFF`);
  assert.ok(prompt.text.includes(TITLE_MARKER), "the lens prompt carries the item's §2.4 title");
  assert.ok(prompt.text.includes(ACCEPT_MARKER), "the lens prompt carries the item's acceptance criterion");
  assert.ok(prompt.text.includes(TEST_MARKER), "the lens prompt carries the item's TEST");
}

function namesAny(prompt: PromptedRecord, ids: readonly string[]): boolean {
  return ids.some((id) => prompt.text.includes(id));
}

function persistedItem(bench: Bench, itemId = ITEM_ID): Item {
  return bench.store.loadItem(bench.runId, itemId);
}

// The gate's view of the SAME persisted fixture, spread from the runtime item first so a
// new §2.5 field an implementation adds rides through to the injection layer unchanged.
function gateItemsOf(bench: Bench): GateItem[] {
  return QUEUE.items.map((qi) => {
    const item = bench.store.loadItem(bench.runId, qi.id);
    const gate = {
      ...item,
      id: qi.id,
      state: item.state,
      behavioral: qi.behavioral,
      dependsOn: [...qi.dependsOn],
      fileScope: [...qi.fileScope],
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
      debugging: item.debugging !== null,
    };
    return gate as unknown as GateItem;
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

function gateQuestionsOf(bench: Bench): GateQuestion[] {
  return readQuestions(bench.runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
}

// ===========================================================================
// Fixture sanity (the 9.1-9.4c probe-block discipline): every canned payload must
// satisfy the schema the fan-out engine validates it against, the compositions must be
// internally coherent, and the ARITHMETIC this file asserts must be the committed core's.
// A red below is then about the handler, never about the fixture.
// ===========================================================================

assert.equal(validate("Findings", JSON.parse(NO_FINDINGS) as unknown).ok, true, "sanity: an empty Findings receipt is schema-valid");
assert.equal(
  validate("Findings", JSON.parse(findingsJson([{ id: "F-X", lens: SPEC, suggestedFix: SUBJECT_REL }])) as unknown).ok,
  true,
  "sanity: a populated Findings receipt is schema-valid",
);
assert.equal(validate("Verdict", JSON.parse(verdictJson("F-X", true)) as unknown).ok, true, "sanity: an UPHOLD verdict is schema-valid");
assert.equal(validate("Verdict", JSON.parse(verdictJson("F-X", false)) as unknown).ok, true, "sanity: an OVERTURN verdict is schema-valid");
assert.equal(validate("ImplementerResult", JSON.parse(implJson()) as unknown).ok, true, "sanity: the implementer receipt is schema-valid");
assert.equal(
  validate("ImplementerResult", JSON.parse(implJson("DONE_WITH_CONCERNS", "pushback", ["F-X: " + PUSHBACK_MARKER])) as unknown).ok,
  true,
  "sanity: the DONE_WITH_CONCERNS pushback receipt is schema-valid",
);
assert.equal(validate("TestVet", JSON.parse(vetJson([])) as unknown).ok, true, "sanity: a clean critic receipt is schema-valid");
assert.equal(validate("TestVet", JSON.parse(vetJson([MUSTFIX_MARKER])) as unknown).ok, true, "sanity: a mustFix critic receipt is schema-valid");
assert.equal(validate("Queue", QUEUE).ok, true, "sanity: the queue fixture satisfies SCHEMAS.Queue");
assert.equal(validate("Item", makeRuntimeItem(ITEM_ID, "VALIDATED")).ok, true, "sanity: the runtime item fixture satisfies SCHEMAS.Item");
assert.ok(Object.keys(PACKS).length > 0, "sanity: the REAL doctrine packs loaded through the committed loader");
assert.ok(typeof PACKS["receive-review.md"] === "string", "sanity: receive-review.md is one of the loaded packs");
assert.notEqual(PACKS["receive-review.md"], PACKS["tdd.md"], "sanity: receive-review.md and tdd.md are DIFFERENT packs");

// Every composition covers all five mandatory lenses, at every legal session count.
for (const [count, groups] of Object.entries(COMPOSITIONS)) {
  const covered = new Set(groups.flat());
  for (const lens of MANDATORY_LENSES) {
    assert.ok(covered.has(lens), `sanity: the ${count}-session composition covers the mandatory "${lens}" lens`);
  }
  assert.equal(groups.length, Number(count), `sanity: the ${count}-session composition has ${count} groups`);
}

// The two survival facts this file leans on are the COMMITTED core rule's, never a
// restatement: k=2 TIE-UPHOLDS, and a two-overturn panel dies.
const REFUTATION_EVIDENCE = {
  discriminatingInput: "the input the finding names",
  run: "traced the caller and re-ran the unit test",
  reading: "the guard on the branch above already covers it",
};
const TIE_PANEL: Verdict[] = [
  { findingId: "F-X", upheld: true, reasoning: "stands", refutationEvidence: null },
  { findingId: "F-X", upheld: false, reasoning: "falls", refutationEvidence: REFUTATION_EVIDENCE },
];
assert.equal(findingSurvives(TIE_PANEL, 2), true, "sanity: core findingSurvives — at k=2 a TIE UPHOLDS");
assert.equal(
  findingSurvives([{ findingId: "F-X", upheld: false, reasoning: "falls", refutationEvidence: REFUTATION_EVIDENCE }], 2),
  false,
  "sanity: core findingSurvives — a lone EVIDENCED OVERTURN at k=2 does NOT survive (the trap the binding row guards)",
);

// The clamp arithmetic, read off the COMMITTED readFanout.
const PROBE_CMD = [process.execPath, "-e", "0"];
assert.equal(expectedSessions(makeConfig({ command: PROBE_CMD, itemTest: PROBE_CMD, itemReviewers: 6, maxReaders: 8 })), 6, "sanity: 6 readers ⇒ 6 sessions");
assert.equal(expectedSessions(makeConfig({ command: PROBE_CMD, itemTest: PROBE_CMD, itemReviewers: 2, maxReaders: 8 })), 3, "sanity: 2 readers clamp UP to 3 sessions");
assert.equal(expectedSessions(makeConfig({ command: PROBE_CMD, itemTest: PROBE_CMD, itemReviewers: 6, maxReaders: 1 })), 3, "sanity: a maxReaders of 1 clamps UP to 3 sessions, never down to 1");
assert.equal(isKnownEvent("fanout", "subsession.dispatched"), true, "sanity: the clamp warning rides an EXISTING §7.4 event");
assert.equal(isKnownEvent("fsm", "transition"), true, "sanity: fsm/transition is an EXISTING §7.4 event");

// ===========================================================================
// [9.5a-mandatory-lenses-at-3]
// ===========================================================================

test("[9.5a-mandatory-lenses-at-3] with workflow.itemReviewers 3, conductor_item_review dispatches EXACTLY three fresh reviewer sub-sessions in the §3.3 merged composition — spec/contract+correctness, guardrail+minimality, test-adequacy+perf — so ALL FIVE mandatory lenses still dispatch; asserted on the fake's recorded prompts: three pairwise-different prompts each naming its own lens pair, every dispatch carrying the item's diff + spec + test", async () => {
  const bench = seedBench({
    itemReviewers: 3,
    respond: scripted({ sessionsPerRound: 3, perRound: [{}], findingIds: [] }),
  });

  const res: ItemReviewResultShape = await review(bench);

  const lensPrompts = bench.wiring.lensPrompts();
  assert.equal(lensPrompts.length, 3, "EXACTLY three lens sub-sessions dispatched at itemReviewers 3");
  for (const prompt of lensPrompts) {
    assert.equal(prompt.role, "reviewer", "every lens session runs as role reviewer (§4.1)");
    assert.equal(prompt.itemId, ITEM_ID, "every lens session is registered against the item under review");
  }

  const groups = lensGroupsOf(bench.wiring, 0, 3);
  assertLensVocabulary(groups);
  assert.equal(
    compositionKey(groups),
    compositionKey(COMPOSITIONS[3]),
    "the three sessions carry the §3.3 three-session composition: spec/contract+correctness, guardrail+minimality, test-adequacy+perf",
  );

  // ALL FIVE mandatory lenses reached a session — the whole point of merging.
  const covered = new Set(groups.flat());
  for (const lens of MANDATORY_LENSES) {
    assert.ok(covered.has(lens), `the MANDATORY "${lens}" lens still dispatched at itemReviewers 3`);
  }

  // Three DIFFERENT instruments, not one prompt sent three times.
  const texts = new Set(lensPrompts.map((p) => p.text));
  assert.equal(texts.size, 3, "the three lens prompts are pairwise DIFFERENT (three instruments, not one repeated)");
  const sessions = new Set(lensPrompts.map((p) => p.sessionID));
  assert.equal(sessions.size, 3, "each lens ran in its own FRESH sub-session (§3.3 'fresh reviewers')");

  for (const prompt of lensPrompts) assertCarriesDiffSpecTest(prompt);

  // No findings ⇒ the item settles; the composition claim is not smuggling a stall.
  assert.equal(res.ok, true, "a round with no findings advances the item");
  assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item reached REVIEWED");
});

// ===========================================================================
// [9.5a-lens-count-rule]
// ===========================================================================

test("[9.5a-lens-count-rule] the §3.3 session-count rule holds at the other configs: 6 dispatches six sessions one lens each ADDING perf; 5 merges minimality+perf; 4 additionally merges test-adequacy into spec/contract; below 3 clamps to 3 and journals a warn-level record on an EXISTING closed-vocabulary event; merging NEVER drops a mandatory lens at any count — and per the rosterSizingRule a parallel.maxReaders below the floor must NOT truncate the lens set", async () => {
  const runAt = async (opts: {
    itemReviewers: number;
    maxReaders?: number;
    realJournal?: boolean;
  }): Promise<{ bench: Bench; sessions: number }> => {
    const bench = seedBench({
      itemReviewers: opts.itemReviewers,
      ...(opts.maxReaders !== undefined ? { maxReaders: opts.maxReaders } : {}),
      ...(opts.realJournal === true ? { realJournal: true } : {}),
      respond: scripted({ sessionsPerRound: expectedSessions(makeConfig({
        command: PROBE_CMD,
        itemTest: PROBE_CMD,
        itemReviewers: opts.itemReviewers,
        ...(opts.maxReaders !== undefined ? { maxReaders: opts.maxReaders } : {}),
      })), perRound: [{}], findingIds: [] }),
    });
    const sessions = expectedSessions(bench.config);
    await review(bench);
    return { bench, sessions };
  };

  const assertComposition = (bench: Bench, sessions: number): void => {
    const lensPrompts = bench.wiring.lensPrompts();
    assert.equal(lensPrompts.length, sessions, `EXACTLY ${sessions} lens sub-sessions dispatched`);
    const groups = lensGroupsOf(bench.wiring, 0, sessions);
    assertLensVocabulary(groups);
    assert.equal(
      compositionKey(groups),
      compositionKey(COMPOSITIONS[sessions]),
      `the ${sessions}-session composition is §3.3's`,
    );
    const covered = new Set(groups.flat());
    for (const lens of MANDATORY_LENSES) {
      assert.ok(covered.has(lens), `merging at ${sessions} sessions did NOT drop the mandatory "${lens}" lens`);
    }
  };

  const clampWarnings = (bench: Bench): CaptureRecord[] =>
    bench.journal.records.filter(
      (r) => r.level === "warn" && r.component === "fanout" && r.event === "subsession.dispatched",
    );

  await test("itemReviewers 6: six sessions, one lens each, ADDING perf", async () => {
    const { bench, sessions } = await runAt({ itemReviewers: 6 });
    assert.equal(sessions, 6, "the config yields six sessions");
    assertComposition(bench, 6);
    const covered = new Set(lensGroupsOf(bench.wiring, 0, 6).flat());
    assert.ok(covered.has(PERF), "itemReviewers >= 6 ADDS the perf lens (§3.3)");
    assert.equal(clampWarnings(bench).length, 0, "no clamp warning fires when nothing was clamped");
  });

  await test("itemReviewers 5: minimality+perf merge", async () => {
    const { bench, sessions } = await runAt({ itemReviewers: 5 });
    assert.equal(sessions, 5, "the config yields five sessions");
    assertComposition(bench, 5);
    assert.equal(clampWarnings(bench).length, 0, "no clamp warning fires at five sessions");
  });

  await test("itemReviewers 4: test-adequacy additionally joins spec/contract", async () => {
    const { bench, sessions } = await runAt({ itemReviewers: 4 });
    assert.equal(sessions, 4, "the config yields four sessions");
    assertComposition(bench, 4);
    assert.equal(clampWarnings(bench).length, 0, "no clamp warning fires at four sessions");
  });

  await test("itemReviewers 2: clamps UP to 3 and journals a warn on an EXISTING event", async () => {
    const { bench, sessions } = await runAt({ itemReviewers: 2, realJournal: true });
    assert.equal(sessions, 3, "a configured 2 clamps UP to the floor of 3");
    assertComposition(bench, 3);
    const warnings = clampWarnings(bench);
    assert.equal(warnings.length, 1, "EXACTLY ONE warn-level record rides the first review dispatch");
    assert.ok(
      dataCarries(warnings[0].data, [2, 3]),
      "the warning's data names BOTH the configured (2) and the clamped (3) values — " + JSON.stringify(warnings[0].data),
    );
    // The tee onto the REAL journal already threw if the event name were invented; this
    // states the claim the tee proves.
    assert.equal(isKnownEvent(warnings[0].component, warnings[0].event), true, "the warning rides an EXISTING §7.4 event — no vocabulary widening");
  });

  await test("parallel.maxReaders 1 under itemReviewers 6: the READER CEILING never truncates the lens set", async () => {
    const { bench, sessions } = await runAt({ itemReviewers: 6, maxReaders: 1, realJournal: true });
    assert.equal(sessions, 3, "readFanout clamps to 1, which the §3.3 floor lifts back to 3 sessions");
    assertComposition(bench, 3);
    // The rosterSizingRule's consequence, stated as an assertion: maxReaders is a
    // wall-clock concurrency ceiling, NEVER a coverage truncation.
    const covered = new Set(lensGroupsOf(bench.wiring, 0, 3).flat());
    assert.equal(covered.size >= MANDATORY_LENSES.length, true, "all five mandatory lenses still dispatched under a maxReaders of 1");
    const warnings = clampWarnings(bench);
    assert.equal(warnings.length, 1, "the sub-3 warning fires on the PRE-clamp value whichever knob caused it");
    assert.ok(
      dataCarries(warnings[0].data, [1, 3]),
      "the warning names the pre-clamp fan-out (1) and the clamped session count (3) — " + JSON.stringify(warnings[0].data),
    );
  });
});

// ===========================================================================
// [9.5a-trivial-guardrail]
// ===========================================================================

test("[9.5a-trivial-guardrail] a run flagged trivial uses the trivial merged composition even when itemReviewers is 6, and the guardrail lens provably survives the merge — no trivial-mode compression removes a mandatory lens", async () => {
  const bench = seedBench({
    itemReviewers: 6,
    trivial: true,
    respond: scripted({ sessionsPerRound: 3, perRound: [{}], findingIds: [] }),
  });
  assert.equal(bench.store.loadRun(bench.runId).classification.kind, "trivial", "fixture: the run is classified trivial");
  assert.equal(expectedSessions(bench.config), 6, "fixture: the CONFIG alone would buy six sessions — only trivial can compress it");

  const res: ItemReviewResultShape = await review(bench);

  const lensPrompts = bench.wiring.lensPrompts();
  assert.equal(lensPrompts.length, 3, "a trivial run uses the THREE-session trivial composition despite itemReviewers 6");
  const groups = lensGroupsOf(bench.wiring, 0, 3);
  assertLensVocabulary(groups);
  assert.equal(compositionKey(groups), compositionKey(COMPOSITIONS[3]), "the trivial composition is §3.3's three-session composition");

  const covered = new Set(groups.flat());
  assert.ok(covered.has(GUARDRAIL), "the GUARDRAIL lens provably survives the trivial merge (§3.3 never-lazy list)");
  for (const lens of MANDATORY_LENSES) {
    assert.ok(covered.has(lens), `trivial-mode compression did NOT remove the mandatory "${lens}" lens`);
  }
  assert.equal(res.ok, true, "the trivial run's clean round still advances the item");
});

// ===========================================================================
// [9.5a-adjudication-ordering]
// ===========================================================================

test("[9.5a-adjudication-ordering] a round in which a spec/contract finding SURVIVES its skeptics discards that round's quality-lens findings (test-adequacy, minimality, perf): they are routed to NO fix dispatch, and after the spec fix and its re-validate a FRESH quality derivation is dispatched before any quality finding is acted on — asserted on the fake's dispatch sequence. Correctness and guardrail findings are tier-1 and are NOT discarded", async () => {
  const F_SPEC = "F-SPEC-9510";
  const F_CORR = "F-CORR-9511";
  const F_GUARD = "F-GUARD-9512";
  const F_TADQ = "F-TADQ-9513";
  const F_MIN = "F-MIN-9514";
  const F_PERF = "F-PERF-9515";
  const F_TADQ_ROUND2 = "F-TADQ2-9516";
  const ROUND1_QUALITY = [F_TADQ, F_MIN, F_PERF];

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: 3,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_SPEC, F_CORR, F_GUARD, F_TADQ, F_MIN, F_PERF, F_TADQ_ROUND2],
      perRound: [
        {
          [SPEC]: [{ id: F_SPEC, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }],
          [CORRECTNESS]: [{ id: F_CORR, lens: CORRECTNESS, suggestedFix: `edit ${SUBJECT_REL}` }],
          [GUARDRAIL]: [{ id: F_GUARD, lens: GUARDRAIL, suggestedFix: `edit ${SUBJECT_REL}` }],
          [TEST_ADEQUACY]: [{ id: F_TADQ, lens: TEST_ADEQUACY, suggestedFix: `edit ${TEST_REL}` }],
          [MINIMALITY]: [{ id: F_MIN, lens: MINIMALITY, suggestedFix: `edit ${SUBJECT_REL}` }],
          [PERF]: [{ id: F_PERF, lens: PERF, suggestedFix: `edit ${SUBJECT_REL}` }],
        },
        {
          [TEST_ADEQUACY]: [{ id: F_TADQ_ROUND2, lens: TEST_ADEQUACY, suggestedFix: `edit ${TEST_REL}` }],
        },
        {},
      ],
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  // (a) THE DISCARD. No fix dispatch — implementer OR test-writer — ever acted on the
  //     quality findings this round raised alongside a surviving spec/contract finding.
  for (const prompt of bench.wiring.fixPrompts()) {
    assert.equal(
      namesAny(prompt, ROUND1_QUALITY),
      false,
      `no fix dispatch acts on round 1's DISCARDED quality findings (${prompt.role} prompt named one of ${ROUND1_QUALITY.join(", ")})`,
    );
  }

  // (b) TIER-1 SURVIVES. Correctness and guardrail are NOT quality lenses: they are fixed
  //     alongside the spec finding, in the SAME round-1 fix pass (verifies still 0).
  const round1Fixes = bench.wiring.fixPrompts().filter((p) => p.verifies === 0);
  assert.ok(round1Fixes.length > 0, "round 1 dispatched at least one fix BEFORE any re-validate");
  const round1FixText = round1Fixes.map((p) => p.text).join("\n");
  for (const id of [F_SPEC, F_CORR, F_GUARD]) {
    assert.ok(round1FixText.includes(id), `the round-1 fix pass carries the tier-1 finding ${id}`);
  }
  for (const prompt of round1Fixes) {
    assert.equal(prompt.role, "implementer", "a fileScope-only fix routes to the implementer (§3.3 table row 1)");
  }

  // (c) THE RE-DERIVATION ORDERING. Round 2's lens fan-out ran AFTER a re-validate, and
  //     every fix that acts on a quality finding comes AFTER that fresh derivation.
  const round2Lenses = bench.wiring.lensPrompts().filter((p) => Math.floor(p.lensOrdinal / 6) === 1);
  assert.equal(round2Lenses.length, 6, "a FRESH full lens derivation ran in round 2");
  for (const prompt of round2Lenses) {
    assert.ok(prompt.verifies >= 1, "the fresh quality derivation runs AFTER the spec fix's re-validate");
  }
  const lastRound2Lens = Math.max(...round2Lenses.map((p) => p.seq));
  const qualityFixes = bench.wiring.fixPrompts().filter((p) => p.text.includes(F_TADQ_ROUND2));
  assert.equal(qualityFixes.length, 1, "the re-derived quality finding is acted on exactly once");
  assert.ok(
    qualityFixes[0].seq > lastRound2Lens,
    "the quality finding is acted on only AFTER the fresh derivation that produced it",
  );
  assert.equal(qualityFixes[0].role, "testWriter", "a test-adequacy finding routes to the test-writer (§3.3 table row 2)");

  assert.equal(res.ok, true, "the third, clean round settles the item");
  assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item reached REVIEWED");
});

// ===========================================================================
// [9.5a-skeptics-findingsurvives]
// ===========================================================================

test("[9.5a-skeptics-findingsurvives] every finding gets exactly workflow.skepticsPerFinding skeptic sub-sessions and survival is decided by core/verdict findingSurvives, never reimplemented: with k=2 a one-uphold/one-overturn TIE UPHOLDS the finding; a REFUTED finding triggers no fix dispatch, no re-validate, and contributes nothing at the round cap", async () => {
  const F_TIE = "F-TIE-9520";
  const F_REFUTED = "F-REFUTED-9521";

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 2,
    reviewMaxRounds: 1,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_TIE, F_REFUTED],
      perRound: [
        {
          [SPEC]: [{ id: F_TIE, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }],
          [CORRECTNESS]: [{ id: F_REFUTED, lens: CORRECTNESS, suggestedFix: `edit ${SUBJECT_REL}` }],
        },
      ],
      // F_TIE: one uphold, one overturn -> the core rule's TIE-UPHOLDS at k=2.
      // F_REFUTED: two overturns -> dies.
      verdict: (findingId, nth) => {
        if (findingId === F_TIE) return { kind: "reply", text: verdictJson(F_TIE, nth === 0) };
        return { kind: "reply", text: verdictJson(F_REFUTED, false) };
      },
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  // (a) THE PANEL SIZE. Exactly skepticsPerFinding sessions per finding, bound to their
  //     finding by the prompt that asked for the verdict (P3), never by an ordinal.
  const skeptics = bench.wiring.byRole("skeptic");
  assert.equal(skeptics.length, 4, "two findings x skepticsPerFinding 2 = FOUR skeptic sub-sessions");
  for (const id of [F_TIE, F_REFUTED]) {
    const panel = skeptics.filter((p) => p.text.includes(id));
    assert.equal(panel.length, 2, `finding ${id} got EXACTLY workflow.skepticsPerFinding (2) skeptic sub-sessions`);
    assert.equal(new Set(panel.map((p) => p.sessionID)).size, 2, `finding ${id}'s panel is two DISTINCT sub-sessions`);
  }

  // (b) THE TIE UPHOLDS — the committed ceil(k/2) rule, not a reimplementation.
  const fixes = bench.wiring.fixPrompts();
  const tieFixes = fixes.filter((p) => p.text.includes(F_TIE));
  assert.ok(tieFixes.length >= 1, "the TIED finding SURVIVES (⌈2/2⌉ = 1 uphold) and is routed to a fix");

  // (c) THE REFUTED FINDING COSTS NOTHING.
  for (const prompt of fixes) {
    assert.equal(prompt.text.includes(F_REFUTED), false, "a REFUTED finding triggers NO fix dispatch");
  }
  assert.equal(
    res.surviving.includes(F_REFUTED),
    false,
    "a REFUTED finding contributes nothing to the round cap's surviving list",
  );
  assert.deepEqual(res.surviving, [F_TIE], "only the surviving finding reaches the cap's list");

  // The cap fired (reviewMaxRounds 1 with a survivor), so exactly one lens fan-out ran and
  // the only re-validate in the run belongs to the SURVIVOR's fix, never to the refuted one.
  assert.equal(bench.wiring.lensPrompts().length, 6, "exactly ONE lens fan-out ran at reviewMaxRounds 1");
  assert.equal(res.ok, false, "the round cap is an OUTCOME, not an advance");
  assert.equal(persistedItem(bench).state, "VALIDATED", "the item stays at VALIDATED at the cap");
});

// ===========================================================================
// [9.5a-underdelivered-panel-upholds]  — MANDATORY DEFERRED BINDING (Phase 1 gate)
// ===========================================================================

test("[9.5a-underdelivered-panel-upholds] MANDATORY DEFERRED BINDING (Phase 1 gate, verdict.findingSurvives): with skepticsPerFinding 2, one skeptic env-failed and the sole returned verdict an OVERTURN, the handler must NOT feed the partial panel straight to findingSurvives — which would read the missing verdict as an overturn and DROP the finding. It either re-dispatches the missing skeptic or counts the missing verdict as UPHOLD; asserted outcome: the finding SURVIVES. A real major is never dropped because a skeptic session crashed", async () => {
  const F_MAJOR = "F-MAJOR-9530";

  // Skeptic session ordinal 1 delivers the sole (OVERTURN) verdict. EVERY other skeptic
  // session — the original crash AND the pinned single re-dispatch attempt — env-fails, so
  // the panel is under-delivered on BOTH branches the binding allows.
  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 2,
    reviewMaxRounds: 1,
    respond: (req: RespondReq): Canned => {
      if (req.lenses !== null) {
        return {
          kind: "reply",
          text: req.lenses.includes(SPEC)
            ? findingsJson([{ id: F_MAJOR, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }], req.text)
            : findingsJson([], req.text),
        };
      }
      if (req.role === "skeptic") {
        if (req.sessionNth === 1) return { kind: "reply", text: verdictJson(F_MAJOR, false) };
        return { kind: "error", error: { message: "skeptic sub-session crashed (env)" } };
      }
      if (req.role === "implementer" || req.role === "testWriter") return { kind: "reply", text: implJson() };
      return { kind: "reply", text: vetJson([]) };
    },
  });

  const res: ItemReviewResultShape = await review(bench);

  // The trap, restated on the committed core so the claim is unmistakable: feeding the
  // PARTIAL panel straight to findingSurvives drops the major.
  assert.equal(
    findingSurvives(
      [
        {
          findingId: F_MAJOR,
          upheld: false,
          reasoning: "the delivered overturn",
          refutationEvidence: {
            discriminatingInput: "the input the finding names",
            run: "traced the caller",
            reading: "the guard above already covers it",
          },
        },
      ],
      2,
    ),
    false,
    "the naive partial-panel call WOULD drop this major — which is exactly what the handler must not do",
  );

  // The observable the binding demands, whichever branch the implementation took.
  const fixes = bench.wiring.fixPrompts();
  const majorFixes = fixes.filter((p) => p.text.includes(F_MAJOR));
  assert.ok(majorFixes.length >= 1, "the finding SURVIVED an under-delivered panel and was routed to a fix");
  assert.ok(res.surviving.includes(F_MAJOR), "the surviving list carries the major an under-delivered panel could not refute");
  assert.equal(res.ok, false, "a surviving major at the round cap does not advance the item");
  assert.equal(persistedItem(bench).state, "VALIDATED", "the item stays at VALIDATED");

  // At most ONE re-dispatch attempt of the missing session (G6): three skeptic sessions
  // for one finding is the ceiling — two panel seats plus one retry.
  const skeptics = bench.wiring.byRole("skeptic");
  assert.ok(
    skeptics.length <= 3,
    `at most ONE re-dispatch of the missing skeptic (saw ${skeptics.length} skeptic sub-sessions for one finding)`,
  );
});

// ===========================================================================
// [9.5a-route-implementer-filescope]
// ===========================================================================

test("[9.5a-route-implementer-filescope] routing by path (§3.3 table row 1): a surviving finding whose fix touches ONLY the item's fileScope dispatches an implementer, and the fix is followed by re-validate then re-review — asserted on the fake's dispatch order", async () => {
  const F_IMPL = "F-IMPL-9540";

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: 2,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_IMPL],
      perRound: [{ [CORRECTNESS]: [{ id: F_IMPL, lens: CORRECTNESS, suggestedFix: `edit ${SUBJECT_REL} only` }] }, {}],
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  const implementers = bench.wiring.byRole("implementer");
  assert.equal(implementers.length, 1, "EXACTLY one implementer dispatch for the one fileScope-only finding");
  assert.ok(implementers[0].text.includes(F_IMPL), "the implementer dispatch names the finding it must fix");
  assert.equal(
    implementers[0].tree,
    bench.root,
    "the fix runs in the §4.2 shared tree — as the PATH the edit gate normalizes an edit against, which is the workspace itself when the item has no worktree",
  );
  assert.equal(bench.wiring.byRole("testWriter").length, 0, "a fileScope-only fix NEVER reaches the test-writer");

  // ORDER: fix → re-validate → re-review, read off the witness counts each prompt saw.
  assert.equal(implementers[0].verifies, 0, "the fix is dispatched BEFORE the re-validate");
  const round2 = bench.wiring.lensPrompts().filter((p) => Math.floor(p.lensOrdinal / 6) === 1);
  assert.equal(round2.length, 6, "a full re-review ran after the fix");
  for (const prompt of round2) {
    assert.ok(prompt.verifies >= 1, "the re-review runs AFTER the re-validate (§3.3 fix ⇒ re-validate ⇒ re-review)");
    assert.ok(prompt.seq > implementers[0].seq, "the re-review is dispatched after the fix");
  }

  // The re-validate is evidence.ts's, not a re-implementation: a §2.6 verify record.
  const verifies = readEvidence(bench.runDir).filter((rec) => rec.kind === "verify");
  assert.ok(verifies.length >= 1, "the re-validate appended a §2.6 verify record through adapter/evidence.ts");
  assert.equal(countLines(bench.witnesses.verify), verifies.length, "every verify record corresponds to a REAL scope-command run");

  assert.equal(res.ok, true, "the clean second round advances the item");
  assert.equal(res.itemState, "REVIEWED", "the compact return reports the PERSISTED state");
  assert.equal(persistedItem(bench).state, "REVIEWED", "the item file says REVIEWED");
});

// ===========================================================================
// [9.5a-route-testwriter-test-discipline]
// ===========================================================================

test("[9.5a-route-testwriter-test-discipline] routing by path (§3.3 table row 2): a test-adequacy finding — and any finding whose suggestedFix names a testScope path — dispatches a TEST-WRITER and NEVER the implementer (zero implementer dispatches for it: the implementer is gated to fileScope and would hit a guaranteed edit-gate denial, burning review rounds on a mandatory lens). The changed test RE-ENTERS the test discipline: it is re-run through evidence and re-vetted with vetCritics critics BEFORE re-validate and re-review", async () => {
  const runCase = async (opts: { findingId: string; lens: string; suggestedFix: string; vetCritics: number }): Promise<void> => {
    const bench = seedBench({
      itemReviewers: 6,
      skepticsPerFinding: 1,
      reviewMaxRounds: 2,
      vetCritics: opts.vetCritics,
      respond: scripted({
        sessionsPerRound: 6,
        findingIds: [opts.findingId],
        perRound: [{ [opts.lens]: [{ id: opts.findingId, lens: opts.lens, suggestedFix: opts.suggestedFix }] }, {}],
      }),
    });

    const res: ItemReviewResultShape = await review(bench);

    // (a) THE ROUTE.
    const writers = bench.wiring.byRole("testWriter");
    assert.equal(writers.length, 1, "EXACTLY one test-writer dispatch for the testScope-touching finding");
    assert.ok(writers[0].text.includes(opts.findingId), "the test-writer dispatch names the finding it must fix");
    assert.equal(
      bench.wiring.byRole("implementer").length,
      0,
      "ZERO implementer dispatches — routing this to the implementer is a guaranteed §3.5 edit-gate denial",
    );

    // (b) THE RE-RUN, through adapter/evidence.ts and a REAL child process.
    const runs = itemTestRuns(bench.witnesses.itemTest);
    assert.ok(runs.length >= 1, "the changed test was RE-RUN through evidence.runTest (a real child process)");
    for (const run of runs) {
      assert.deepEqual(run.files, [TEST_REL], "the re-run is TARGETED at the item's own test file");
    }
    const itemRecords = readEvidence(bench.runDir).filter((rec) => rec.kind === "red" || rec.kind === "green");
    assert.ok(itemRecords.length >= 1, "the re-run appended a §2.6 item-test record");

    // (c) THE RE-VET, with vetCritics critics, BEFORE the re-validate and the re-review.
    const vets = bench.wiring.vetPrompts();
    assert.equal(vets.length, opts.vetCritics, `the changed test is re-vetted with EXACTLY workflow.vetCritics (${opts.vetCritics}) critics`);
    assert.equal(new Set(vets.map((p) => p.sessionID)).size, opts.vetCritics, "each critic runs in its own fresh sub-session");
    for (const vet of vets) {
      assert.equal(vet.role, "reviewer", "the vet critics run as role reviewer (§4.1)");
      assert.ok(vet.seq > writers[0].seq, "the re-vet judges the CHANGED test — it runs after the test-writer");
      assert.ok(vet.itemTests >= 1, "the re-vet runs AFTER the test has been re-run (a true captured outcome, not a stale one)");
      assert.equal(vet.verifies, 0, "the re-vet runs BEFORE the re-validate (§3.3: re-run + re-vet, then re-validate ⇒ re-review)");
    }

    // (d) THEN re-validate ⇒ re-review.
    const round2 = bench.wiring.lensPrompts().filter((p) => Math.floor(p.lensOrdinal / 6) === 1);
    assert.equal(round2.length, 6, "a full re-review ran after the test discipline and the re-validate");
    for (const prompt of round2) {
      assert.ok(prompt.verifies >= 1, "the re-review runs after the re-validate");
      assert.ok(prompt.seq > Math.max(...vets.map((v) => v.seq)), "the re-review runs after the re-vet");
    }

    assert.equal(res.ok, true, "the clean second round advances the item");
    assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item reached REVIEWED");
  };

  await test("a TEST-ADEQUACY finding routes to the test-writer (vetCritics 2)", async () => {
    await runCase({
      findingId: "F-TADQ-9550",
      lens: TEST_ADEQUACY,
      suggestedFix: "tighten the assertion so it pins the sign",
      vetCritics: 2,
    });
  });

  await test("any finding whose suggestedFix names a testScope path routes to the test-writer (vetCritics 3)", async () => {
    await runCase({
      findingId: "F-CORR-9551",
      lens: CORRECTNESS,
      suggestedFix: `the assertion in ${TEST_REL} is wrong`,
      vetCritics: 3,
    });
  });
});

// ===========================================================================
// [9.5a-revet-criteria-bite]
// ===========================================================================

test("[9.5a-revet-criteria-bite] ISSUE-013 at the §3.3 changed-test re-vet: a schema-valid critic receipt that fails a §2.10 criterion with an EMPTY mustFix does NOT clear the re-vet — the item is BLOCKED on a question naming the failed criterion, and no re-review follows the test it never approved", async () => {
  const F_TADQ = "F-TADQ-9552";
  // THE ESCAPE, in one receipt: a written-down failure with no repair asked for.
  // Reading the empty mustFix as the approval is what lets a changed test the
  // critic condemned carry the item on to re-validate and re-review.
  const contradictoryReceipt = JSON.stringify({
    verdictsByCriterion: {
      observableBehavior: { pass: true, note: "asserts the returned value" },
      wouldCatchWrongImpl: { pass: false, note: "the tightened assertion holds for any implementation" },
      rightLevel: { pass: true, note: "unit level is right for a pure function" },
      pinsAcceptance: { pass: true, note: "pins this item's acceptance criterion" },
      antiPatterns: { pass: true, note: "no mock-testing, no tautology" },
    },
    mustFix: [],
  });
  assert.equal(
    validate("TestVet", JSON.parse(contradictoryReceipt) as unknown).ok,
    true,
    "premise: the contradictory receipt is SCHEMA-VALID — the schema cannot be what refuses it",
  );

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: 2,
    vetCritics: 1,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_TADQ],
      perRound: [
        {
          [TEST_ADEQUACY]: [
            { id: F_TADQ, lens: TEST_ADEQUACY, suggestedFix: "tighten the assertion so it pins the sign" },
          ],
        },
        {},
      ],
      vetReply: { kind: "reply", text: contradictoryReceipt },
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  // The re-vet did not clear, so the item goes no further.
  assert.equal(res.ok, false, "a failed §2.10 criterion refuses the changed test");
  assert.notEqual(persistedItem(bench).state, "REVIEWED", "the item did NOT reach REVIEWED");
  assert.notEqual(persistedItem(bench).blocked, null, "the item is BLOCKED on the re-vet it failed");
  assert.notEqual(res.questionId, null, "a §2.11 question was minted");

  const question = readQuestions(bench.runDir).find((q) => q.id === res.questionId);
  assert.notEqual(question, undefined, "the question is on disk");
  assert.ok(
    (question?.question ?? "").includes("wouldCatchWrongImpl"),
    `the question NAMES the criterion the critic failed: ${question?.question ?? "(none)"}`,
  );

  // And nothing downstream ran on a test the critics never approved.
  const round2 = bench.wiring.lensPrompts().filter((p) => Math.floor(p.lensOrdinal / 6) === 1);
  assert.equal(round2.length, 0, "no re-review followed a re-vet that did not clear");
});

// ===========================================================================
// [9.5a-route-both-sequential]
// ===========================================================================

test("[9.5a-route-both-sequential] routing by path (§3.3 table row 3): a surviving finding whose fix touches BOTH scopes dispatches the testWriter FIRST and the implementer SECOND, sequentially, each under its own discipline, before re-validate and re-review", async () => {
  const F_BOTH = "F-BOTH-9560";

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: 2,
    vetCritics: 2,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_BOTH],
      perRound: [
        { [SPEC]: [{ id: F_BOTH, lens: SPEC, suggestedFix: `edit BOTH ${SUBJECT_REL} and ${TEST_REL}` }] },
        {},
      ],
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  const writers = bench.wiring.byRole("testWriter");
  const implementers = bench.wiring.byRole("implementer");
  assert.equal(writers.length, 1, "EXACTLY one test-writer dispatch");
  assert.equal(implementers.length, 1, "EXACTLY one implementer dispatch");
  assert.ok(writers[0].text.includes(F_BOTH), "the test-writer dispatch names the finding");
  assert.ok(implementers[0].text.includes(F_BOTH), "the implementer dispatch names the same finding");

  // ORDER: testWriter FIRST.
  assert.ok(writers[0].seq < implementers[0].seq, "the testWriter is dispatched FIRST and the implementer SECOND");

  // SEQUENTIALLY, not as one wave: the implementer's SESSION was not even CREATED until
  // after the test-writer had been prompted. A single fan-out group would have created
  // both sessions before either prompt.
  const implCreate = bench.wiring.sdk.calls.find((call) => call.method === "create" && call.sessionID === implementers[0].sessionID);
  assert.ok(implCreate !== undefined, "the implementer's session.create is in the fake's ordered call log");
  assert.ok(
    implCreate.seq > writers[0].seq,
    "the implementer's sub-session is created only AFTER the test-writer was prompted — the two fixes are SEQUENTIAL, not one wave",
  );

  // EACH UNDER ITS OWN DISCIPLINE: the test discipline (re-run + re-vet) completes before
  // the implementer is dispatched, and the re-validate comes after both.
  const vets = bench.wiring.vetPrompts();
  assert.equal(vets.length, 2, "the changed test is re-vetted with vetCritics critics");
  for (const vet of vets) {
    assert.ok(vet.seq > writers[0].seq, "the re-vet follows the test-writer");
    assert.ok(vet.seq < implementers[0].seq, "the test discipline completes BEFORE the implementer is dispatched");
  }
  assert.ok(implementers[0].itemTests >= 1, "the changed test had been re-run before the implementer was dispatched");
  assert.equal(implementers[0].verifies, 0, "both fixes precede the re-validate");

  const round2 = bench.wiring.lensPrompts().filter((p) => Math.floor(p.lensOrdinal / 6) === 1);
  assert.equal(round2.length, 6, "a full re-review ran after both fixes");
  for (const prompt of round2) {
    assert.ok(prompt.verifies >= 1, "the re-review runs after the re-validate");
  }

  assert.equal(res.ok, true, "the clean second round advances the item");
  assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item reached REVIEWED");
});

// ===========================================================================
// [9.5a-reverted-behavior-probe]
// ===========================================================================

test("[9.5a-reverted-behavior-probe] the 'where cheap' probe, both branches: when the item's fileScope changes round-trip through git stash, the changed test is proven to STILL FAIL against the reverted tree (so it pins behaviour rather than the implementation's shape) and the tree is restored in a finally; when the stash fails, the probe is SKIPPED and the mandatory re-run + re-vet still happen — the probe augments the discipline and never replaces it", async () => {
  const F_TADQ = "F-TADQ-9570";

  const build = (trackSubject: boolean): Bench =>
    seedBench({
      itemReviewers: 6,
      skepticsPerFinding: 1,
      reviewMaxRounds: 2,
      vetCritics: 2,
      trackSubject,
      respond: scripted({
        sessionsPerRound: 6,
        findingIds: [F_TADQ],
        perRound: [
          { [TEST_ADEQUACY]: [{ id: F_TADQ, lens: TEST_ADEQUACY, suggestedFix: "pin the sign, not the magnitude" }] },
          {},
        ],
      }),
    });

  await test("the fileScope round-trips: the probe FIRES and the tree is restored", async () => {
    const bench = build(true);
    assert.equal(subjectOnDisk(bench.root).includes(FIX_MARKER), true, "fixture: the working tree carries the item's change");

    const res: ItemReviewResultShape = await review(bench);

    const runs = itemTestRuns(bench.witnesses.itemTest);
    assert.ok(runs.length >= 2, `the probe ADDS a run to the mandatory re-run (saw ${runs.length})`);

    // The MANDATORY re-run: against the item's real (fixed) tree, and it PASSES.
    const againstFix = runs.filter((run) => run.subject !== null && run.subject.includes(FIX_MARKER));
    assert.ok(againstFix.length >= 1, "the changed test was re-run against the item's own tree");
    assert.ok(
      againstFix.some((run) => run.code === 0),
      "against the item's tree the changed test PASSES (the implementation exists at VALIDATED)",
    );

    // The PROBE: the same test, against a tree where the behaviour has been reverted.
    const againstReverted = runs.filter((run) => run.subject !== null && !run.subject.includes(FIX_MARKER));
    assert.ok(againstReverted.length >= 1, "the changed test was ALSO run against the REVERTED tree");
    for (const run of againstReverted) {
      assert.notEqual(run.code, 0, "the changed test STILL FAILS against the reverted behaviour — it pins behaviour, not shape");
      assert.equal(run.subject, REVERTED_SUBJECT, "the reverted tree is the committed content, restored by git itself");
    }

    // RESTORED IN A FINALLY.
    assert.equal(subjectOnDisk(bench.root), FIXED_SUBJECT, "the working tree is byte-restored after the probe");
    assert.equal(stashList(bench.root), "", "no stash entry is left behind — the round trip completed");

    // The probe AUGMENTS: the mandatory re-vet still happened, before the re-validate.
    const vets = bench.wiring.vetPrompts();
    assert.equal(vets.length, 2, "the mandatory re-vet still ran");
    for (const vet of vets) assert.equal(vet.verifies, 0, "the re-vet still precedes the re-validate");
    assert.equal(res.ok, true, "the clean second round still advances the item");
  });

  await test("the stash FAILS (untracked fileScope): the probe is SKIPPED and the discipline still runs", async () => {
    const bench = build(false);
    // fixture: the subject is present but UNTRACKED, so `git stash push -- src/a.mjs`
    // cannot match a pathspec known to git — a REAL stash failure, not a stubbed one.
    const probe = spawnSync("git", ["stash", "push", "--", SUBJECT_REL], {
      cwd: bench.root,
      env: GIT_ENV,
      encoding: "utf8",
    });
    assert.notEqual(probe.status, 0, "fixture: git itself refuses to stash the untracked fileScope");

    const res: ItemReviewResultShape = await review(bench);

    const runs = itemTestRuns(bench.witnesses.itemTest);
    assert.ok(runs.length >= 1, "the MANDATORY re-run still happened");
    for (const run of runs) {
      assert.ok(run.subject !== null && run.subject.includes(FIX_MARKER), "no run saw a reverted tree — the probe was SKIPPED");
    }
    assert.equal(subjectOnDisk(bench.root), FIXED_SUBJECT, "a failed stash leaves the working tree untouched");
    assert.equal(stashList(bench.root), "", "a failed stash leaves no stash entry behind");

    const vets = bench.wiring.vetPrompts();
    assert.equal(vets.length, 2, "the MANDATORY re-vet still happened — the probe augments and never replaces the discipline");
    for (const vet of vets) {
      assert.ok(vet.itemTests >= 1, "the re-vet still follows the re-run");
      assert.equal(vet.verifies, 0, "the re-vet still precedes the re-validate");
    }
    assert.equal(res.ok, true, "a skipped probe does not stall the item");
    assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item still reached REVIEWED");
  });
});

// ===========================================================================
// [9.5a-pushback-one-skeptic-round]
// ===========================================================================

test("[9.5a-pushback-one-skeptic-round] an implementer that answers a routed finding with reasoning instead of implementing it (DONE_WITH_CONCERNS naming the finding id) is routed through exactly ONE extra skeptic round carrying that reasoning: a refuted finding then dies with no further fix demand, an upheld finding still requires the fix. Pushback is never accepted silently and never loops more than the one extra round", async () => {
  const F_PUSH = "F-PUSH-9580";

  const build = (pushbackVerdictUpheld: boolean): Bench =>
    seedBench({
      itemReviewers: 6,
      skepticsPerFinding: 1,
      reviewMaxRounds: 2,
      respond: scripted({
        sessionsPerRound: 6,
        findingIds: [F_PUSH],
        perRound: [{ [SPEC]: [{ id: F_PUSH, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }] }, {}],
        // nth 0 is the ORIGINAL panel (upholds, so the finding is routed at all);
        // nth 1 is the ONE extra pushback round, whose answer the sub-cases vary.
        verdict: (findingId, nth) => ({ kind: "reply", text: verdictJson(findingId, nth === 0 ? true : pushbackVerdictUpheld) }),
        // EVERY implementer dispatch pushes back, so an implementation that looped would
        // keep minting skeptic rounds — and the ceiling assertion below would catch it.
        fix: () => ({ kind: "reply", text: implJson("DONE_WITH_CONCERNS", "answered with reasoning", [`${F_PUSH}: ${PUSHBACK_MARKER}`]) }),
      }),
    });

  await test("the pushback is REFUTED: the finding dies with no further fix demand", async () => {
    const bench = build(false);
    const res: ItemReviewResultShape = await review(bench);

    const skeptics = bench.wiring.byRole("skeptic").filter((p) => p.text.includes(F_PUSH));
    assert.equal(skeptics.length, 2, "one original panel seat plus EXACTLY ONE extra skeptic round");
    assert.ok(
      skeptics[1].text.includes(PUSHBACK_MARKER),
      "the extra skeptic round CARRIES the implementer's own reasoning verbatim — pushback is never accepted silently",
    );
    const implementers = bench.wiring.byRole("implementer");
    assert.equal(implementers.length, 1, "a refuted pushback makes NO further fix demand");
    assert.equal(
      res.surviving.includes(F_PUSH),
      false,
      "a finding refuted by the pushback round does not survive into the next round",
    );
    assert.equal(res.ok, true, "with the finding dead the round is clean and the item advances");
    assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item reached REVIEWED");
  });

  await test("the pushback is UPHELD: the fix is still required, and the loop stops at one extra round", async () => {
    const bench = build(true);
    await review(bench);

    const skeptics = bench.wiring.byRole("skeptic").filter((p) => p.text.includes(F_PUSH));
    assert.equal(
      skeptics.length,
      2,
      `EXACTLY one extra skeptic round per routed finding, even though every implementer kept pushing back (saw ${skeptics.length})`,
    );
    const implementers = bench.wiring.byRole("implementer");
    assert.equal(implementers.length, 2, "an UPHELD pushback still requires the fix: one more implementer dispatch, and only one");
    assert.ok(implementers[1].text.includes(F_PUSH), "the re-demanded fix names the same finding");
    assert.ok(
      implementers[1].seq > skeptics[1].seq,
      "the fix is re-demanded only AFTER the extra skeptic round upheld the finding",
    );
  });
});

// ===========================================================================
// [9.5a-receive-review-pack-delivered]  — MANDATORY DEFERRED BINDING (Phase 8 / C-028)
// ===========================================================================

test("[9.5a-receive-review-pack-delivered] MANDATORY DEFERRED BINDING (Phase 8 gate / C-028): the fix-round dispatch that sends surviving findings to the implementer threads the 'receiving-review' signal so buildSystemAppend appends receive-review.md as a SECONDARY pack (tdd.md stays primary), mirroring the committed debug.md path — asserted on the DELIVERED system append for that implementer session, never on pack loading. Loaded is not delivered: that was the whole C-028 finding", async () => {
  const F_FIX = "F-FIX-9590";

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: 2,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_FIX],
      perRound: [{ [SPEC]: [{ id: F_FIX, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }] }, {}],
    }),
  });

  await review(bench);

  const implementers = bench.wiring.byRole("implementer");
  assert.equal(implementers.length, 1, "the surviving finding produced exactly one implementer fix dispatch");
  const entry = implementers[0].entry;
  assert.ok(entry !== undefined, "the fix dispatch's §3.5 registry entry was live at prompt time (registry-before-first-prompt)");
  assert.equal(entry.role, "implementer", "the fix dispatch is registered as an implementer");

  // THE DELIVERY. buildSystemAppend is the committed injection layer; this hands it the
  // handler's OWN registry entry and reads what the session would ACTUALLY receive.
  const run = gateRunOf(bench);
  const items = gateItemsOf(bench);
  const questions = gateQuestionsOf(bench);
  const ctx = { repoConfigured: true, publishEnabled: true, taintCount: 0, overridesRemaining: 1 };
  const delivered = buildSystemAppend(entry as SessionRegistryEntry, run, items, questions, PACKS, ctx);

  assert.equal(delivered[0], PACKS["tdd.md"], "tdd.md stays the PRIMARY pack at append[0] (§4.1)");
  const idx = delivered.indexOf(PACKS["receive-review.md"]);
  assert.ok(idx > 0, "receive-review.md IS DELIVERED, as a SECONDARY pack — not merely loaded and cached (C-028)");
  assert.ok(idx < delivered.length - 1, "the live state block stays the LAST append entry");
  assert.equal(
    delivered.filter((chunk) => chunk === PACKS["receive-review.md"]).length,
    1,
    "receive-review.md is de-duplicated, exactly as the committed debug.md path is",
  );

  // THE CONTROL: an implementer session with no such signal gets NOTHING extra, so the
  // delivery above is signal-driven and not a blanket addition to every implementer.
  const control: SessionRegistryEntry = { role: "implementer", itemId: ITEM_ID, tree: bench.root };
  const controlAppend = buildSystemAppend(control, run, items, questions, PACKS, ctx);
  assert.equal(controlAppend[0], PACKS["tdd.md"], "the control implementer still gets tdd.md as its primary pack");
  assert.equal(
    controlAppend.includes(PACKS["receive-review.md"]),
    false,
    "an implementer NOT receiving a review gets no receive-review.md — the signal, not the role, drives delivery",
  );
});

// ===========================================================================
// [9.5a-zero-survivors-reviewed]
// ===========================================================================

test("[9.5a-zero-survivors-reviewed] a round with ZERO surviving findings advances VALIDATED->REVIEWED through legalItemTransition (never a direct state write), and a call against an item not at VALIDATED is refused by the same legality check BEFORE any dispatch", async () => {
  await test("zero survivors: the edge is taken through the core rule", async () => {
    const F_REFUTED = "F-NONE-9600";
    const bench = seedBench({
      itemReviewers: 6,
      skepticsPerFinding: 1,
      reviewMaxRounds: 2,
      respond: scripted({
        sessionsPerRound: 6,
        findingIds: [F_REFUTED],
        // A finding IS raised and IS adjudicated — and is refuted, so the round's
        // surviving set is empty. "Zero survivors" is not "zero findings".
        perRound: [{ [PERF]: [{ id: F_REFUTED, lens: PERF, suggestedFix: `edit ${SUBJECT_REL}` }] }],
        verdict: (findingId) => ({ kind: "reply", text: verdictJson(findingId, false) }),
      }),
    });

    const res: ItemReviewResultShape = await review(bench);

    assert.equal(res.ok, true, "a round with zero SURVIVING findings advances the item");
    assert.equal(res.itemState, "REVIEWED", "the compact return reports the persisted state");
    assert.equal(res.questionId, null, "a clean exit mints no question");
    assert.deepEqual(res.surviving, [], "a clean exit reports no survivors");
    assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item file says REVIEWED");
    assert.equal(bench.wiring.byRole("implementer").length, 0, "a refuted finding triggers no fix");

    // NEVER A DIRECT STATE WRITE: the edge is journaled with the `why` the COMMITTED core
    // rule produced, verbatim — the observable proof the gate was consulted, not re-derived.
    const expected = legalItemTransition("VALIDATED", "REVIEWED", { item: { behavioral: true, blocked: null } });
    assert.equal(expected.ok, true, "sanity: core legalItemTransition permits VALIDATED->REVIEWED");
    const edges = bench.journal.records.filter(
      (r) => r.component === "fsm" && r.event === "transition" && r.data["from"] === "VALIDATED" && r.data["to"] === "REVIEWED",
    );
    assert.equal(edges.length, 1, "EXACTLY one VALIDATED->REVIEWED transition was journaled");
    assert.equal(
      edges[0].data["why"],
      expected.why,
      "the journaled `why` is core legalItemTransition's own, VERBATIM — the edge went through the rule",
    );
    assert.equal(edges[0].corr.itemId, ITEM_ID, "the transition record is correlated to the item");
  });

  await test("an item not at VALIDATED is refused BEFORE any dispatch", async () => {
    const bench = seedBench({
      itemState: "GREEN",
      respond: () => ({ kind: "reply", text: NO_FINDINGS }),
    });
    const before = itemFileBytes(bench.runDir, ITEM_ID);

    await assert.rejects(
      review(bench),
      /conductor_item_review/,
      "a GREEN item is refused by the SAME legality check, by name",
    );

    assert.equal(bench.wiring.sdk.calls.length, 0, "NOT ONE sub-session was created before the refusal");
    assert.equal(countLines(bench.witnesses.verify), 0, "no verify ran");
    assert.equal(countLines(bench.witnesses.itemTest), 0, "no item test ran");
    assert.equal(itemFileBytes(bench.runDir, ITEM_ID), before, "the item file is BYTE-IDENTICAL after the refusal");
    assert.equal(readQuestions(bench.runDir).length, 0, "no question was written");

    // The same refusal the pure core rule would give for the edge off GREEN.
    const edge = legalItemTransition("GREEN", "REVIEWED", { item: { behavioral: true, blocked: null } });
    assert.equal(edge.ok, false, "sanity: core legalItemTransition refuses GREEN->REVIEWED");
  });
});

// ===========================================================================
// [9.5a-round-cap-question-blocked]
// ===========================================================================

test("[9.5a-round-cap-question-blocked] when workflow.reviewMaxRounds is exhausted with findings still surviving, the handler appends ONE §2.11 question with origin exactly 'review-round-cap' carrying the surviving finding list, and blocks the item via store.setBlocked — asserted by READING THE PERSISTED ITEM FILE back, never by inspecting a journal line", async () => {
  const F_CAP = "F-CAP-9610";
  const ROUNDS = 2;

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: ROUNDS,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_CAP],
      // The SAME finding survives every round: the fix never satisfies the reviewer, which
      // is precisely the situation the cap exists for.
      perRound: [
        { [SPEC]: [{ id: F_CAP, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }] },
        { [SPEC]: [{ id: F_CAP, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }] },
        { [SPEC]: [{ id: F_CAP, lens: SPEC, suggestedFix: `edit ${SUBJECT_REL}` }] },
      ],
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  // The loop is BOUNDED by the configured cap and by nothing else.
  assert.equal(bench.wiring.lensPrompts().length, 6 * ROUNDS, `EXACTLY ${ROUNDS} lens fan-outs ran — the loop is bounded by reviewMaxRounds`);
  assert.equal(res.rounds, ROUNDS, "the compact return reports the rounds spent");
  assert.equal(persistedItem(bench).attempts.reviewRounds, ROUNDS, "the PERSISTED item counts the rounds it spent");
  assert.equal(res.ok, false, "the cap does not advance the item");
  assert.ok(res.surviving.includes(F_CAP), "the return names the still-surviving finding");

  // ONE §2.11 question, on the EXISTING origin, carrying the surviving finding list.
  const questions = readQuestions(bench.runDir);
  assert.equal(questions.length, 1, "EXACTLY ONE §2.11 question is minted at the cap");
  const question = questions[0];
  assert.equal(question.origin, "review-round-cap", 'the origin is EXACTLY "review-round-cap" (an EXISTING §2.11 origin — no vocabulary widening)');
  assert.ok(question.question.includes(F_CAP), "the question carries the surviving finding list");
  assert.deepEqual(question.blocksItems, [ITEM_ID], "the question blocks exactly the item it was raised for");
  assert.equal(question.runId, bench.runId, "the question is correlated to this run");
  assert.equal(question.answeredIso, null, "the question is unanswered");
  assert.equal(res.questionId, question.id, "the compact return names the question it minted");

  // THE BLOCK, read off the PERSISTED ITEM FILE — never off a journal line.
  const onDisk = JSON.parse(itemFileBytes(bench.runDir, ITEM_ID)) as Item;
  assert.notEqual(onDisk.blocked, null, "the PERSISTED item carries a §2.5 blocked annotation");
  assert.equal(onDisk.blocked?.questionId, question.id, "the persisted block names the question that must be answered");
  assert.equal(onDisk.blocked?.stage, "REVIEWED", "the persisted block names the stage the item could not reach");
  assert.ok((onDisk.blocked?.reason ?? "").length > 0, "the persisted block carries a human-readable reason");
  assert.equal(onDisk.state, "VALIDATED", "a blocked item makes NO transition — it stays at VALIDATED (§3.3)");
  assert.equal(res.itemState, "VALIDATED", "the compact return reports the persisted state");

  // A blocked item makes no further transition, by the same core rule.
  const edge = legalItemTransition("VALIDATED", "REVIEWED", {
    item: { behavioral: true, blocked: { questionId: question.id, reason: onDisk.blocked?.reason ?? "" } },
  });
  assert.equal(edge.ok, false, "sanity: core legalItemTransition refuses every edge for a blocked item");
});

// ===========================================================================
// [9.5a-skeptics-cover-non-major]  — ORCHESTRATOR RULING (severity does not gate the panel)
// ===========================================================================

test('[9.5a-skeptics-cover-non-major] a finding below "major" severity is adjudicated too: at ITEM review every finding gets exactly workflow.skepticsPerFinding skeptic sub-sessions regardless of severity — item review\'s output is ROUTED FIXES, and a fix demand nobody adjudicated is not dispatchable — and a minor\'s survival is decided by core findingSurvives exactly as a major\'s is: a k=2 TIE UPHOLDS the minor and routes it to a fix; a refuted minor triggers nothing. A majors-only panel rule (handlePlanReview\'s, correct at PLAN level) must fail this row', async () => {
  const F_MINOR = "F-MINOR-9620";
  const F_MINOR_DEAD = "F-MINORDEAD-9621";

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 2,
    reviewMaxRounds: 2,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_MINOR, F_MINOR_DEAD],
      perRound: [
        {
          [CORRECTNESS]: [
            { id: F_MINOR, lens: CORRECTNESS, severity: "minor", suggestedFix: `edit ${SUBJECT_REL}` },
          ],
          [GUARDRAIL]: [
            { id: F_MINOR_DEAD, lens: GUARDRAIL, severity: "minor", suggestedFix: `edit ${SUBJECT_REL}` },
          ],
        },
        {},
      ],
      // F_MINOR: one uphold, one overturn -> the core rule's TIE-UPHOLDS at k=2.
      // F_MINOR_DEAD: two overturns -> dies.
      verdict: (findingId, nth) => {
        if (findingId === F_MINOR) return { kind: "reply", text: verdictJson(F_MINOR, nth === 0) };
        return { kind: "reply", text: verdictJson(F_MINOR_DEAD, false) };
      },
    }),
  });

  const res: ItemReviewResultShape = await review(bench);

  // (a) THE PANEL, severity-blind: k seats per MINOR finding, each its own session.
  const skeptics = bench.wiring.byRole("skeptic");
  assert.equal(
    skeptics.length,
    4,
    "two MINOR findings x skepticsPerFinding 2 = FOUR skeptic sub-sessions — severity does not gate the panel at item review",
  );
  for (const id of [F_MINOR, F_MINOR_DEAD]) {
    const panel = skeptics.filter((p) => p.text.includes(id));
    assert.equal(panel.length, 2, `minor finding ${id} got EXACTLY workflow.skepticsPerFinding (2) skeptic sub-sessions`);
    assert.equal(new Set(panel.map((p) => p.sessionID)).size, 2, `minor finding ${id}'s panel is two DISTINCT sub-sessions`);
  }

  // (b) SURVIVAL BY THE SAME CORE RULE: the tied minor survives (⌈2/2⌉ = 1 uphold)
  //     and is routed to a fix, exactly as a tied major would be.
  const fixes = bench.wiring.fixPrompts();
  assert.ok(
    fixes.filter((p) => p.text.includes(F_MINOR)).length >= 1,
    "the TIED minor SURVIVES via core findingSurvives and is routed to a fix — an unadjudicated or dropped minor never reaches this dispatch",
  );

  // (c) A REFUTED minor costs nothing, exactly as a refuted major does.
  for (const prompt of fixes) {
    assert.equal(prompt.text.includes(F_MINOR_DEAD), false, "a REFUTED minor triggers NO fix dispatch");
  }

  assert.equal(res.ok, true, "the clean second round advances the item");
  assert.equal(persistedItem(bench).state, "REVIEWED", "the PERSISTED item reached REVIEWED");
});

// ===========================================================================
// [9.5a-worktree-scopes-review-sessions] — ORCHESTRATOR ADDITION (C-053).
//
// Every job conductor_item_review dispatches — lens reviewers, skeptics, the
// routed fix sessions and the re-vet critics — hardcoded `tree: STAGE_TREE`.
// While item review was not a wave stage that was invisible: an item worked in
// the shared tree, so "main" was the right answer by coincidence.
//
// C-050 put item review INTO the wave. Under parallel.writes:"worktrees" the
// item's changes then live in ITS OWN worktree, and two things follow that the
// coincidence was hiding:
//
//   * a reviewer dispatched against "main" reviews a tree WITHOUT the changes it
//     was convened to judge — it would report on the wrong content, and a clean
//     verdict would mean nothing;
//   * a routed FIX session is writeCapable and would edit the MAIN tree while
//     the item is isolated in a worktree — two items' fixes racing in one tree
//     is the precise hazard §4.2 worktree mode exists to prevent.
//
// Every other stage already derives its tree from the item via sessionTreeOf
// (submit_test, vet, mark_green, validate). Item review was the one that did
// not, which is why the row above can assert the SHARED tree and stay correct:
// with item.worktree null, sessionTreeOf answers the workspace itself. This row
// pins the other half of that same function.
// ===========================================================================

test("[9.5a-worktree-scopes-review-sessions] under worktree mode every session conductor_item_review dispatches — lens reviewers, skeptics AND the write-capable fix — is bound to the ITEM'S worktree, never the shared tree: a reviewer pointed at main would judge a tree without the change, and a fix pointed at main would write outside the isolation §4.2 created", async () => {
  const F_WT = "F-WT-9053";

  const bench = seedBench({
    itemReviewers: 6,
    skepticsPerFinding: 1,
    reviewMaxRounds: 2,
    respond: scripted({
      sessionsPerRound: 6,
      findingIds: [F_WT],
      perRound: [{ [CORRECTNESS]: [{ id: F_WT, lens: CORRECTNESS, suggestedFix: `edit ${SUBJECT_REL} only` }] }, {}],
    }),
  });

  // The item is being worked in its own worktree — exactly what the wave driver
  // persists under parallel.writes:"worktrees". A REAL `git worktree`, because the
  // handler's own execution follows the item's tree too (C-055): the fix round's
  // re-validate runs with cwd = this path, so a fictional one would only prove that
  // nothing ever ran there.
  const WORKTREE = worktreeFor(bench.root, ITEM_ID);
  const seeded = bench.store.loadItem(bench.runId, ITEM_ID);
  seeded.worktree = WORKTREE;
  bench.store.saveItem(bench.runId, seeded);

  await review(bench);

  const reviewers = bench.wiring.byRole("reviewer");
  const skeptics = bench.wiring.byRole("skeptic");
  const implementers = bench.wiring.byRole("implementer");

  assert.ok(reviewers.length > 0, "premise: lens reviewers were dispatched");
  assert.ok(skeptics.length > 0, "premise: a skeptic panel was dispatched");
  assert.ok(implementers.length > 0, "premise: the surviving finding routed a fix");

  for (const prompt of reviewers) {
    assert.equal(prompt.tree, WORKTREE, "a lens reviewer judges the tree the item's change actually lives in");
  }
  for (const prompt of skeptics) {
    assert.equal(prompt.tree, WORKTREE, "a skeptic adjudicates against that same tree");
  }
  for (const prompt of implementers) {
    assert.equal(
      prompt.tree,
      WORKTREE,
      "and the WRITE-CAPABLE fix is confined to the item's worktree — writing 'main' here would break §4.2 isolation",
    );
  }
});
