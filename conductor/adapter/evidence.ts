// conductor/adapter/evidence.ts — Task 6.1 (G6): THE evidence writer. Runs the
// item's test / verify commands, captures the red/green/verify outcome, classifies
// a failure via core.classifyFailure with the item's fileScope, and appends the
// §2.6 evidence ledger (evidence.jsonl) plus the §7.4 journal. Composes the
// out-of-repo quarantine (adapter/quarantine.ts) under runVerify.
//
// An ADAPTER (G14): it spawns child processes (node:child_process spawnSync,
// shell:false) and does filesystem I/O (node:fs) with node:path — no single-runtime
// global, no shell tag, no single-runtime import (the purity guard scans it). It may read the clock; every
// stamped time flows through an injected `now` defaulting to `Date.now`.
//
// It is the SOLE legitimate importer of state.appendLedgerLineRaw (G6): every other
// component reads the ledger through state.ts, and only this writer appends to it.
//
// Two residual-risk correctness points the witness tests pin:
//   - runVerify order: refuse on a live same-tree marker, else heal orphaned
//     quarantines, quarantine the foreign red set OUT of the repo, start-stamp,
//     record HEAD/branch, write the marker, then run each scope (build-before-test,
//     timeout kills), removing the marker and restoring the quarantine on
//     completion — including on timeout.
//   - ESM absolute-path relativization: real Node v26 ESM emits an ABSOLUTE
//     `Cannot find module '/abs/.../src/x.ts'` (the realpath, which on macOS differs
//     from the cwd symlink), so the captured output's cwd/realpath prefixes are
//     stripped BEFORE core.classifyFailure — otherwise an in-fileScope missing
//     module would misclassify as `error` and a legal greenfield red would die.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import {
  appendLedgerLineRaw,
  assertSafeId,
  assertWorkspaceLockHeld,
  pidIsAlive,
  writeFileAtomicSync,
} from "./state.ts";
import { readJsonlTolerant } from "./jsonl.ts";
import { currentBranch, headSha } from "./gitio.ts";
import type { Journal } from "./journal.ts";
import { quarantineFiles, replayPendingRestores, restoreQuarantine } from "./quarantine.ts";
import type { QuarantineHandle } from "./quarantine.ts";
import { classifyFailure } from "../core/freshness.ts";
import type { RunnerRules } from "../core/freshness.ts";
import { globMatch } from "../core/shell-parse.ts";
import { MAIN_TREE, treeSlug, validate } from "../core/types.ts";
import type { EvidenceRecord, FailureClass, TreeSlug, WriterIdentity } from "../core/types.ts";

// This process's start, derived once at load: the wall clock minus the runtime's
// uptime. Paired with the pid it forms the §2.6 writer identity — a pid alone is
// recyclable, and a recycled pid is precisely the case that makes a foreign record
// look like one of ours.
const PROCESS_STARTED_MS = Date.now() - Math.round(process.uptime() * 1000);

// The identity to stamp on a record this process writes.
function writerIdentity(pid: number, override?: WriterIdentity): WriterIdentity {
  return override ?? { pid, startedMs: PROCESS_STARTED_MS };
}

// The verify member of the §2.6 discriminated union, named so a VerifyOutcome can
// expose the verify-specific fields (scopes/head/startedMs/…) without a re-narrow.
type VerifyRecord = Extract<EvidenceRecord, { kind: "verify" }>;

// ---------------------------------------------------------------------------
// Runner profiles — the §2.6.1 classification rules and §2.1 zero-test patterns as
// DATA (regex sources, never code), one per detected runner (plan 2408-2410).
// ---------------------------------------------------------------------------

export interface RunnerProfile {
  runner: string;
  rules: RunnerRules;
  zeroTestPatterns: string[];
}

export const RUNNER_PROFILES: Record<string, RunnerProfile> = {
  // Node's ESM/CJS loader: `Cannot find module '<specifier>'` (ESM emits the
  // absolute realpath, relativized before classify) / `Cannot find package …`.
  // Assertions are node:assert's AssertionError / ERR_ASSERTION — tight enough
  // that an unrelated crash ("Segmentation fault") carries neither token.
  node: {
    runner: "node",
    rules: {
      runner: "node",
      unresolvedPatterns: [
        "Cannot find module '([^']+)'",
        "Cannot find package '([^']+)'",
      ],
      assertionPatterns: ["AssertionError", "\\bERR_ASSERTION\\b"],
    },
    zeroTestPatterns: ["# tests 0", "tests 0\\b", "no tests to run", "No tests were found", "no tests ran"],
  },
  // pytest: dotted module names are path separators for the fileScope check
  // ("slugger.core" -> "slugger/core"), so dotsAsSeparators is set.
  pytest: {
    runner: "pytest",
    rules: {
      runner: "pytest",
      unresolvedPatterns: [
        "ModuleNotFoundError: No module named '([^']+)'",
        "ImportError: cannot import name '([^']+)'",
      ],
      assertionPatterns: ["\\bAssertionError\\b", "^E\\s+assert\\b"],
      dotsAsSeparators: true,
    },
    zeroTestPatterns: ["no tests ran", "collected 0 items"],
  },
  go: {
    runner: "go",
    rules: {
      runner: "go",
      unresolvedPatterns: [
        "cannot find package \"([^\"]+)\"",
        "no required module provides package ([^\\s]+)",
        "undefined: ([A-Za-z0-9_.]+)",
      ],
      assertionPatterns: ["--- FAIL:", "\\bFAIL\\b"],
    },
    zeroTestPatterns: ["no test files", "no tests to run"],
  },
  ctest: {
    runner: "ctest",
    rules: {
      runner: "ctest",
      unresolvedPatterns: [
        "Cannot find test executable ([^\\s]+)",
        "Could NOT find ([^\\s]+)",
        "Unable to find executable: ([^\\s]+)",
      ],
      assertionPatterns: ["\\*\\*\\*Failed", "\\bFailed\\b", "Assertion .* failed"],
    },
    zeroTestPatterns: ["No tests were found", "No tests to run", "Total Tests: 0"],
  },
};

/**
 * Pick the runner profile from a command's argv (plan 2408-2410): the rules are
 * DATA keyed off the command, never a guess about the failure text. Falls back to
 * the node profile for an unrecognized command (the conservative default — its
 * tight patterns bin an unfamiliar crash as `error`).
 */
export function detectRunner(command: string[]): RunnerProfile {
  const argv = Array.isArray(command) ? command : [];
  const first = argv.length > 0 ? argv[0] : "";
  const base = path.basename(first).toLowerCase();
  const rest = argv.slice(1);
  if (base === "go" && rest[0] === "test") return RUNNER_PROFILES.go;
  if (base === "ctest") return RUNNER_PROFILES.ctest;
  if (base === "pytest" || (base.startsWith("python") && rest.includes("pytest"))) {
    return RUNNER_PROFILES.pytest;
  }
  if (base === "node" || base.startsWith("node") || argv.includes("--test")) {
    return RUNNER_PROFILES.node;
  }
  if (base === "go") return RUNNER_PROFILES.go;
  return RUNNER_PROFILES.node;
}

// ---------------------------------------------------------------------------
// §2.1 itemTest template substitution
// ---------------------------------------------------------------------------

// Unique parent dirs of the testScope files in ./dir form (go package targeting).
function uniqueDirs(files: string[]): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const f of files) {
    const d = path.dirname(f);
    const rel = d === "." ? "." : "./" + d;
    if (!seen.has(rel)) {
      seen.add(rel);
      dirs.push(rel);
    }
  }
  return dirs;
}

// An alternation regex over the BASENAMES (extensions stripped) of the testScope
// files: tests/parser_test.go -> parser_test; two files -> parser_test|lexer_test.
function nameAlternation(files: string[]): string {
  return files.map((f) => path.parse(f).name).join("|");
}

/**
 * Substitute the §2.1 template tokens in an itemTest template against the item's
 * testScope files:
 *   {files} -> each testScope file as its own argv entry;
 *   {dirs}  -> the unique parent dirs in ./dir form, each its own argv entry;
 *   {name}  -> an alternation regex over the basenames (extensions stripped),
 *              substituted into the containing argv token.
 */
export function substituteItemTest(template: string[], testFiles: string[]): string[] {
  const out: string[] = [];
  for (const token of template) {
    if (token === "{files}") {
      for (const f of testFiles) out.push(f);
    } else if (token === "{dirs}") {
      for (const d of uniqueDirs(testFiles)) out.push(d);
    } else if (token.includes("{name}")) {
      out.push(token.split("{name}").join(nameAlternation(testFiles)));
    } else {
      out.push(token);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-kind evidence validation (phaseGate 1a — the Finding 4/5 close-out)
// ---------------------------------------------------------------------------

function isRecordObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Required fields BEYOND the §2 merged-union schema, which requires only the four
// shared fields. Each kind carries its own contract.
const RED_REQUIRED = ["command", "exitCode", "failureExcerpt", "failureClass", "targeted", "writer"];
const GREEN_REQUIRED = ["command", "exitCode", "writer"];
const VERIFY_REQUIRED = ["startedMs", "head", "branch", "tree", "excluded", "green", "scopes", "writer"];

/**
 * Validate an EvidenceRecord against BOTH the §2 merged-union schema AND the
 * per-kind required fields the merged schema deliberately omits. A verify record
 * missing startedMs/head/green/scopes passes the merged schema but MUST be
 * rejected here — never silently treated as fresh (phaseGate 1a).
 *
 * `writer` is required of every kind: a record nobody can attribute is the record
 * a foreign session's collision hides inside (ISSUE-026/-027). The §2 schema keeps
 * it optional so a ledger written before the stamp still READS; the writer keeps
 * it mandatory so nothing is APPENDED without it.
 */
export function validateEvidenceRecord(rec: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const merged = validate("EvidenceRecord", rec);
  for (const e of merged.errors) errors.push(e);
  if (!isRecordObj(rec)) {
    errors.push("evidence record is not an object");
    return { ok: false, errors };
  }
  const kind = rec.kind;
  const requireFields = (fields: string[]): void => {
    for (const field of fields) {
      if (!Object.hasOwn(rec, field) || rec[field] === undefined) {
        errors.push(`kind "${String(kind)}" requires field "${field}"`);
      }
    }
  };
  if (kind === "red") requireFields(RED_REQUIRED);
  else if (kind === "green") requireFields(GREEN_REQUIRED);
  else if (kind === "verify") requireFields(VERIFY_REQUIRED);
  else errors.push(`unknown evidence kind "${String(kind)}"`);
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Ledger append + journal (both, per plan 2422)
// ---------------------------------------------------------------------------

function ledgerPathOf(runDir: string): string {
  return path.join(runDir, "evidence.jsonl");
}

// ---------------------------------------------------------------------------
// Seq minting (ISSUE-026): single-writer by the workspace lock, collision-proof
// by a durable reservation
// ---------------------------------------------------------------------------

// The reservation counter: the highest seq ever ISSUED for this run, which is not
// the same fact as the highest seq PRESENT on the ledger. A read-max-plus-one mint
// re-issues its own last number to any caller that has not appended yet, so two
// records that were minted before either was written collide by construction — the
// in-process shape of ISSUE-026's cross-process collision.
const SEQ_COUNTER_NAME = "evidence.seq";
// The short-lived exclusive-create latch the reservation is taken under, so the
// read-then-write of the counter is not itself a race.
const SEQ_LATCH_NAME = "evidence.seq.lock";
// A latch is held for the duration of one file read and one atomic write. Anything
// older than this is a killed process's leftover, never live contention.
const SEQ_LATCH_STALE_MS = 30_000;

interface SeqLatch {
  pid: number;
  ms: number;
}

function counterPathOf(runDir: string): string {
  return path.join(runDir, SEQ_COUNTER_NAME);
}

// The highest seq already on the ledger. Torn lines are skipped: an unparseable
// line cannot advance the counter, and it must not throw either.
function ledgerMaxSeq(runDir: string): number {
  const { records } = readJsonlTolerant<{ seq?: unknown }>(ledgerPathOf(runDir));
  let max = 0;
  for (const record of records) {
    if (typeof record.seq === "number" && Number.isFinite(record.seq) && record.seq > max) {
      max = record.seq;
    }
  }
  return max;
}

function readIssuedCounter(runDir: string): number {
  const file = counterPathOf(runDir);
  if (!existsSync(file)) return 0;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    const parsed = JSON.parse(raw) as { issued?: unknown };
    if (typeof parsed.issued === "number" && Number.isFinite(parsed.issued)) return parsed.issued;
  } catch {
    return 0; // a torn counter falls back to the ledger's own maximum
  }
  return 0;
}

function readSeqLatch(latchPath: string): SeqLatch | null {
  if (!existsSync(latchPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(latchPath, "utf8")) as { pid?: unknown; ms?: unknown };
    if (typeof parsed.pid === "number" && typeof parsed.ms === "number") {
      return { pid: parsed.pid, ms: parsed.ms };
    }
  } catch {
    return null;
  }
  return null;
}

// Break a latch by RENAMING it aside and removing the renamed file. rename is
// atomic, so of two processes that both judged the same latch stale exactly one
// moves that inode; the loser gets ENOENT and re-enters the acquisition loop
// against whatever the winner created. A read-then-unlink would let both proceed —
// the same TOCTOU shape ISSUE-024 names in the workspace lock.
function breakSeqLatch(latchPath: string, pid: number): void {
  const aside = `${latchPath}.stale.${pid}.${randomBytes(4).toString("hex")}`;
  try {
    renameSync(latchPath, aside);
  } catch {
    return; // someone else moved it first: nothing of ours to clean up
  }
  rmSync(aside, { force: true });
}

function acquireSeqLatch(latchPath: string, pid: number, now: () => number): void {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      writeFileSync(latchPath, JSON.stringify({ pid, ms: now() }), { flag: "wx" });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const held = readSeqLatch(latchPath);
    const stale = held === null || !pidIsAlive(held.pid) || now() - held.ms > SEQ_LATCH_STALE_MS;
    if (stale) breakSeqLatch(latchPath, pid);
  }
  const held = readSeqLatch(latchPath);
  throw new Error(
    "evidence: could not reserve a seq in " +
      path.dirname(latchPath) +
      " — the mint latch is held" +
      (held === null ? "" : " by pid " + String(held.pid)) +
      "; a number issued without the reservation could collide with another writer's (ISSUE-026)",
  );
}

function releaseSeqLatch(latchPath: string, pid: number): void {
  // Delete only OUR latch, for the reason release() checks the workspace lock's
  // pid: a latch we did not take belongs to whoever broke ours and took it next.
  const held = readSeqLatch(latchPath);
  if (held !== null && held.pid !== pid) return;
  rmSync(latchPath, { force: true });
}

export interface MintSeqOptions {
  pid?: number;
  now?: () => number;
}

/**
 * Mint the next §2.6 evidence seq for `runDir`.
 *
 * THE LOCK DEPENDENCY, stated where the number is issued: the primary guarantee
 * that two conductors never mint into one ledger is the workspace single-writer
 * lock (state.ts) — a second session opening the workspace is refused outright, so
 * only one process ever reaches this function for a given run. assertWorkspaceLockHeld
 * makes that dependency executable rather than assumed: minting beside a LIVE
 * foreign holder throws instead of issuing a number that process is about to issue
 * too. The durable reservation below closes the remaining in-process hole (two
 * mints before either append).
 */
export function mintEvidenceSeq(runDir: string, opts: MintSeqOptions = {}): number {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? Date.now;
  assertWorkspaceLockHeld(runDir, pid, "an evidence seq");
  mkdirSync(runDir, { recursive: true });
  const latchPath = path.join(runDir, SEQ_LATCH_NAME);
  acquireSeqLatch(latchPath, pid, now);
  try {
    const next = Math.max(readIssuedCounter(runDir), ledgerMaxSeq(runDir)) + 1;
    writeFileAtomicSync(counterPathOf(runDir), JSON.stringify({ issued: next }), { pid });
    return next;
  } finally {
    releaseSeqLatch(latchPath, pid);
  }
}

// Validate per-kind, append to <runDir>/evidence.jsonl, then journal the kind under
// the "evidence" component (red|green|verify are the only §7.4 evidence events).
function appendEvidence(
  runDir: string,
  record: EvidenceRecord,
  journal: Journal,
  itemId: string,
  runId: string | undefined,
  data: Record<string, unknown>,
): void {
  const verdict = validateEvidenceRecord(record);
  if (!verdict.ok) {
    throw new Error("evidence: refusing to append an invalid record: " + verdict.errors.join("; "));
  }
  appendLedgerLineRaw(ledgerPathOf(runDir), record);
  journal.log("info", "evidence", record.kind, data, { runId: runId ?? "", itemId });
}

// ---------------------------------------------------------------------------
// Subprocess capture (shell:false; timeout kills)
// ---------------------------------------------------------------------------

interface RunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// The target's own test command must run as a fresh top-level invocation, not as a
// nested child of whatever spawned the conductor. Node's own test runner marks the
// children it forks with NODE_TEST_CONTEXT; inherited, a `node --test` verify
// command would mistake itself for a test child (misreport counts, mask a failing
// import as a pass) — so it is stripped, mirroring gitio's GIT_DIR hygiene.
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.NODE_TEST_CONTEXT;
  // Git hygiene (gitio parity, F7): an inherited GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/
  // GIT_COMMON_DIR would point the target repo's own test/build git reads at the PARENT
  // conductor's checkout — a cross-repo leak. Strip them, and disable optional locks so a
  // child `git status`/`git rev-parse` never writes an index.lock into the target tree.
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

// Spawn `cmd` (argv, shell:false) in `cwd`, killing it at timeoutMs. A non-numeric
// status (killed by the timeout signal, or a spawn failure) is a non-zero (red)
// exit — the child's post-timeout side effects never happen because it was killed.
function spawnCapture(cmd: string[], cwd: string, timeoutMs: number, now: () => number): RunOutcome {
  const start = now();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    env: childEnv(),
    timeout: timeoutMs,
    // F8: kill with SIGKILL, not the default (trappable) SIGTERM. A hung test that
    // installs a SIGTERM handler could otherwise catch the timeout signal, exit 0, and
    // be read as a false GREEN; SIGKILL is uncatchable so the timeout is authoritative.
    killSignal: "SIGKILL",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = now() - start;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const exitCode = typeof result.status === "number" ? result.status : 124;
  return { exitCode, stdout, stderr, durationMs };
}

// Build-before-test per scope (§2.1, plan 485-486): run buildCommand first; if it
// fails the scope is red with the build's exit and the test command is NOT run
// (a test against a stale artifact is a false green). Returns which outcome stands.
function runWithBuild(
  buildCommand: string[] | undefined,
  testCmd: string[],
  cwd: string,
  timeoutMs: number,
  now: () => number,
): { outcome: RunOutcome; buildFailed: boolean } {
  if (buildCommand !== undefined && buildCommand.length > 0) {
    const build = spawnCapture(buildCommand, cwd, timeoutMs, now);
    if (build.exitCode !== 0) return { outcome: build, buildFailed: true };
  }
  return { outcome: spawnCapture(testCmd, cwd, timeoutMs, now), buildFailed: false };
}

// ---------------------------------------------------------------------------
// Classification support: ESM absolute-path relativization (phaseGate 1c)
// ---------------------------------------------------------------------------

// realpathSync, tolerant of a path that no longer resolves (relativized against its
// literal form instead) — never a throw that would sink a legal classification.
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p; // a vanished cwd relativizes against its literal spelling
  }
}

/**
 * Strip the cwd (and its realpath — on macOS os.tmpdir() is a /var symlink while
 * Node's ESM loader reports the /private realpath) from captured output, turning an
 * absolute `Cannot find module '/abs/.../src/x.ts'` into the repo-relative
 * `src/x.ts` core.classifyFailure can match against a repo-relative fileScope glob.
 */
function relativizePaths(text: string, cwd: string): string {
  // Strip the LONGEST prefix first: on macOS the /var symlink cwd is a substring of
  // its /private/var realpath, so stripping the shorter one first would corrupt the
  // longer path (…/private/var/…/src → /privatesrc) instead of relativizing it.
  const prefixes = [...new Set<string>([cwd, safeRealpath(cwd)])]
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const prefix of prefixes) {
    out = out.split(prefix + path.sep).join("");
  }
  return out;
}

function matchesAny(patterns: string[], text: string): boolean {
  for (const source of patterns) {
    if (new RegExp(source).test(text)) return true;
  }
  return false;
}

// The §2.6 excerpt is bounded to <=300 chars.
function boundExcerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed;
}

// §2.1 illegal-red rule support: does the bounded failure EXCERPT name a file in the
// item's testScope by its FULL relative path? (A fallback red naming no testScope file
// in its excerpt is a suite failure elsewhere impersonating this item's red — §2404/2431.)
// F5: the check reads ONLY the excerpt (not the full captured output) and matches the
// FULL relative path (not the basename), so a deep tail mention of the item's file, or a
// same-basename file in another directory, never launders an illegal red into a legal one.
function excerptNamesTestFile(excerpt: string, testFiles: string[]): boolean {
  return testFiles.some((f) => f.length > 0 && excerpt.includes(f));
}

function isLegalClass(fc: FailureClass): boolean {
  return fc === "assertion" || fc === "missing-subject";
}

// ---------------------------------------------------------------------------
// runTest
// ---------------------------------------------------------------------------

export interface ScopeSpec {
  name: string;
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
  buildCommand?: string[];
}

export interface RunTestOptions {
  scope: ScopeSpec;
  testFiles: string[];
  cwd: string;
  fileScope: string[];
  excludeTestFiles?: string[];
  journal: Journal;
  stateHome?: string;
  workspaceKey?: string;
  runId?: string;
  now?: () => number;
  // The writing process, for the seq mint's lock guard; defaults to process.pid.
  pid?: number;
  // The identity stamped on the appended record; defaults to this process's.
  writer?: WriterIdentity;
}

export interface RunTestResult {
  /** The appended red|green record. */
  record: EvidenceRecord;
  targeted: boolean;
  fellBack: boolean;
  ranZeroTests: boolean;
  buildFailed: boolean;
  namesTestScopeFile: boolean;
  legalRed: boolean;
}

// Run the full scope command as the §2.1 fallback (targeted:false), under the §4.2
// quarantine when the excludeTestFiles + out-of-repo params are supplied.
function runFallback(
  opts: RunTestOptions,
  now: () => number,
): { cmd: string[]; outcome: RunOutcome; buildFailed: boolean } {
  const cmd = opts.scope.command;
  const exclude = opts.excludeTestFiles ?? [];
  const stateHome = opts.stateHome;
  const workspaceKey = opts.workspaceKey;
  const runId = opts.runId;
  let handle: QuarantineHandle | null = null;
  if (exclude.length > 0 && stateHome !== undefined && workspaceKey !== undefined && runId !== undefined) {
    handle = quarantineFiles({ repoRoot: opts.cwd, files: exclude, stateHome, workspaceKey, runId });
  }
  try {
    const run = runWithBuild(opts.scope.buildCommand, cmd, opts.cwd, opts.scope.timeoutMs, now);
    return { cmd, outcome: run.outcome, buildFailed: run.buildFailed };
  } finally {
    if (handle !== null) restoreQuarantine(handle);
  }
}

/**
 * Run the item's test command and append the resulting red|green record.
 *
 * Derives the command from the scope's itemTest template (§2.1 substitutions); a
 * TARGETED run that executed no tests (the zero-test guard) is neither red nor pass
 * and FALLS BACK to the full scope command (marked targeted:false). With no
 * template it runs the full scope command directly (targeted:false). The failure is
 * classified by core.classifyFailure with the item's fileScope, after the captured
 * output's absolute cwd/realpath prefixes are stripped (phaseGate 1c).
 */
export function runTest(runDir: string, itemId: string, opts: RunTestOptions): RunTestResult {
  const now = opts.now ?? Date.now;
  const scope = opts.scope;
  const testFiles = opts.testFiles;
  const hasTemplate = Array.isArray(scope.itemTest) && scope.itemTest.length > 0;

  let targeted: boolean;
  let fellBack = false;
  let ranZeroTests = false;
  let buildFailed = false;
  let actualCmd: string[];
  let outcome: RunOutcome;

  if (hasTemplate) {
    const targetedCmd = substituteItemTest(scope.itemTest as string[], testFiles);
    const first = runWithBuild(scope.buildCommand, targetedCmd, opts.cwd, scope.timeoutMs, now);
    if (first.buildFailed) {
      targeted = true;
      actualCmd = targetedCmd;
      outcome = first.outcome;
      buildFailed = true;
    } else {
      const profile = detectRunner(targetedCmd);
      const combined = first.outcome.stdout + "\n" + first.outcome.stderr;
      if (matchesAny(profile.zeroTestPatterns, combined)) {
        // §2.1 zero-test guard: a targeted run that executed no tests is neither a
        // legal red nor a pass — fall back to the full scope command.
        ranZeroTests = true;
        fellBack = true;
        targeted = false;
        const fb = runFallback(opts, now);
        actualCmd = fb.cmd;
        outcome = fb.outcome;
        buildFailed = fb.buildFailed;
      } else {
        targeted = true;
        actualCmd = targetedCmd;
        outcome = first.outcome;
      }
    }
  } else {
    targeted = false;
    fellBack = true;
    const fb = runFallback(opts, now);
    actualCmd = fb.cmd;
    outcome = fb.outcome;
    buildFailed = fb.buildFailed;
  }

  const relStderr = relativizePaths(outcome.stderr, opts.cwd);
  const relStdout = relativizePaths(outcome.stdout, opts.cwd);
  const combinedText = relStderr + "\n" + relStdout;
  // F5: legality is judged against the SAME bounded excerpt the record carries — the
  // first <=300 chars — not the full captured output.
  const excerpt = boundExcerpt(combinedText);
  const namesTestScopeFile = excerptNamesTestFile(excerpt, testFiles);

  const pid = opts.pid ?? process.pid;
  const writer = writerIdentity(pid, opts.writer);
  const seq = mintEvidenceSeq(runDir, { pid, now });
  const ts = now();
  let record: EvidenceRecord;
  let failureClass: FailureClass | null = null;
  if (outcome.exitCode === 0) {
    record = { seq, ts, kind: "green", itemId, command: actualCmd, exitCode: 0, targeted, writer };
  } else {
    failureClass = classifyFailure(
      relStderr,
      relStdout,
      outcome.exitCode,
      opts.fileScope,
      detectRunner(actualCmd).rules,
    );
    record = {
      seq,
      ts,
      kind: "red",
      itemId,
      command: actualCmd,
      exitCode: outcome.exitCode,
      failureExcerpt: excerpt,
      failureClass,
      targeted,
      writer,
    };
  }

  const legalRed =
    failureClass !== null &&
    isLegalClass(failureClass) &&
    (targeted || namesTestScopeFile);

  appendEvidence(runDir, record, opts.journal, itemId, opts.runId, {
    exitCode: outcome.exitCode,
    targeted,
    ...(failureClass !== null ? { failureClass } : {}),
  });

  return { record, targeted, fellBack, ranZeroTests, buildFailed, namesTestScopeFile, legalRed };
}

// ---------------------------------------------------------------------------
// runVerify
// ---------------------------------------------------------------------------

export interface VerifyScopeSpec {
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
  buildCommand?: string[];
}

export interface VerifyConfig {
  verify: {
    scopes: Record<string, VerifyScopeSpec>;
    behavioralPaths?: string[];
    requiredScopes: Array<{ pattern: string; scopes: string[] }>;
  };
}

export interface VerifyOptions {
  cwd: string;
  excludeTestFiles?: string[];
  journal: Journal;
  stateHome: string;
  workspaceKey: string;
  runId: string;
  // The evidence layer's tree SLUG, defaulting to the shared tree: it composes
  // the per-tree marker filename, so a PATH can never be one.
  tree?: TreeSlug;
  now?: () => number;
  pid?: number;
  // The identity stamped on the appended verify record; defaults to this process's.
  writer?: WriterIdentity;
  // Over-age marker threshold (F6); defaults to 24h. A marker older than this is broken
  // even if its pid is alive (a recycled pid must never wedge a tree's verify forever).
  staleMarkerMs?: number;
}

interface Marker {
  pid: number;
  startMs: number;
}

export type VerifyOutcome =
  | { refused: false; record: VerifyRecord; staleMarkerBroken?: Marker }
  | { refused: true; reason: string; tree: TreeSlug; heldBy: Marker };

// The over-age marker threshold: a verify marker older than this is stale even if its
// pid is still alive (a crashed run whose pid was recycled by an unrelated process).
// Mirrors state.ts's staleLockMs; 24h; injectable via VerifyOptions.staleMarkerMs (F6).
const DEFAULT_STALE_MARKER_MS = 24 * 60 * 60 * 1000;

// The per-tree verify marker's filename, spelled ONCE. Every seam that has to know
// whether a tree is frozen reads it through this module — markerPathOf below to
// compose one, liveVerifyTrees to enumerate them — because two independently-derived
// spellings of one filename is how a freeze silently stops firing on one side only.
const MARKER_PREFIX = "verify-running-";
const MARKER_SUFFIX = ".json";

function markerPathOf(runDir: string, tree: TreeSlug): string {
  // F3 trust boundary: tree ("main" or a worktree item id) composes the marker filename
  // AND is later rmSync'd — a traversing tree ("../../tmp/evil") would let a poisoned key
  // write/delete outside runDir. Reject anything that is not a conservative slug.
  assertSafeId(tree, "tree");
  return path.join(runDir, `${MARKER_PREFIX}${tree}${MARKER_SUFFIX}`);
}

export interface LiveMarkerOptions {
  now?: () => number;
  // The same over-age bound runVerify takes (VerifyOptions.staleMarkerMs, F6), so the
  // two seams can never disagree about how old a marker may be.
  staleMarkerMs?: number;
}

/**
 * The LIVE per-tree verify markers in `runDir`, as the evidence layer's own TREE
 * SLUGS ("main" for the shared tree, "<itemId>" for a worktree), sorted.
 *
 * The §3.5 freeze is one fact read at two seams — the wave driver's admission check
 * and the edit gate's verifyInFlightTree — and neither of them owns this filename.
 * A missing or unreadable run directory holds no markers rather than raising: a
 * freeze that cannot be observed is absent, not fatal. A file whose slug is not a
 * conservative slug is not a marker this module could ever have written, so it is
 * ignored rather than reported as a frozen tree.
 *
 * LIVE means what runVerify's own marker gate means by it and nothing broader: the
 * marker parses, its pid is alive, and it is not over-age. A marker runVerify would
 * BREAK is not a freeze — reporting it would let a crashed verify's leftover hold
 * every write-capable member of its tree forever. The rule is not restated here; the
 * same readMarker/pidAlive/DEFAULT_STALE_MARKER_MS the gate reads are reused, because
 * two derivations of one fact is exactly what this module exists to prevent.
 *
 * READ-ONLY: a broken marker is omitted, never deleted. Breaking one is runVerify's
 * move under §4.3, which does it deliberately and reports the anomaly on its outcome.
 */
export function liveVerifyTrees(runDir: string, opts: LiveMarkerOptions = {}): TreeSlug[] {
  let names: string[];
  try {
    names = readdirSync(runDir);
  } catch {
    return [];
  }
  const now = opts.now ?? Date.now;
  const staleMarkerMs = opts.staleMarkerMs ?? DEFAULT_STALE_MARKER_MS;
  const trees: TreeSlug[] = [];
  for (const name of names) {
    if (!name.startsWith(MARKER_PREFIX) || !name.endsWith(MARKER_SUFFIX)) continue;
    const tree = name.slice(MARKER_PREFIX.length, name.length - MARKER_SUFFIX.length);
    if (tree.length === 0) continue;
    let slug: TreeSlug;
    try {
      assertSafeId(tree, "tree");
      slug = treeSlug(tree);
    } catch {
      continue;
    }
    const marker = readMarker(path.join(runDir, name));
    if (marker === null) continue;
    if (!pidAlive(marker.pid)) continue;
    if (now() - marker.startMs > staleMarkerMs) continue;
    trees.push(slug);
  }
  return trees.sort();
}

function readMarker(markerPath: string): Marker | null {
  if (!existsSync(markerPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(markerPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isRecordObj(parsed) && typeof parsed.pid === "number" && typeof parsed.startMs === "number") {
    return { pid: parsed.pid, startMs: parsed.startMs };
  }
  return null;
}

// Alive iff signal 0 does not report ESRCH; EPERM (exists, not ours) counts alive.
function pidAlive(checkPid: number): boolean {
  try {
    process.kill(checkPid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// The scopes selected for the touched path(s): every requiredScopes entry whose glob
// pattern matches ANY of them contributes its scope names (deduped). A caller may pass
// one representative path or the item's whole path set — an item spanning two path
// families owes the UNION of what §2.1 requires of each, and no single element of a
// model-authored array can speak for the rest.
function selectScopes(config: VerifyConfig, scopePattern: string | string[]): string[] {
  const paths = typeof scopePattern === "string" ? [scopePattern] : scopePattern;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const req of config.verify.requiredScopes) {
    if (!paths.some((p) => globMatch(req.pattern, p))) continue;
    for (const s of req.scopes) {
      if (!seen.has(s)) {
        seen.add(s);
        names.push(s);
      }
    }
  }
  return names;
}

function runScopes(
  config: VerifyConfig,
  scopePattern: string | string[],
  cwd: string,
  now: () => number,
): Record<string, { green: boolean; exitCode: number; durationMs: number }> {
  const scopes: Record<string, { green: boolean; exitCode: number; durationMs: number }> = {};
  for (const name of selectScopes(config, scopePattern)) {
    const spec = config.verify.scopes[name];
    if (spec === undefined) continue;
    const run = runWithBuild(spec.buildCommand, spec.command, cwd, spec.timeoutMs, now);
    scopes[name] = {
      green: run.outcome.exitCode === 0,
      exitCode: run.outcome.exitCode,
      durationMs: run.outcome.durationMs,
    };
  }
  return scopes;
}

/**
 * Run a full verify and append the §2.6 verify record.
 *
 * Order: refuse on a LIVE same-tree marker (leaving it intact); break a stale
 * (dead-pid) marker and surface the anomaly on the outcome; heal any crashed run's
 * orphaned quarantine; quarantine this run's foreign red set OUT of the repo;
 * start-stamp (before any scope ran); record HEAD/branch; write the per-tree marker;
 * run each required scope (build-before-test, timeout kills); then, on completion —
 * including on a timeout — remove the marker and restore the quarantine.
 *
 * `scopePattern` is the touched path the required scopes are selected against, or the
 * item's whole path set when its paths select different scopes and the run owes their
 * union.
 */
export function runVerify(
  runDir: string,
  itemId: string,
  config: VerifyConfig,
  scopePattern: string | string[],
  opts: VerifyOptions,
): VerifyOutcome {
  const now = opts.now ?? Date.now;
  const pid = opts.pid ?? process.pid;
  const tree = opts.tree ?? MAIN_TREE;
  const cwd = opts.cwd;
  const exclude = opts.excludeTestFiles ?? [];
  const staleMarkerMs = opts.staleMarkerMs ?? DEFAULT_STALE_MARKER_MS;
  const markerPath = markerPathOf(runDir, tree);

  // Marker gate: a live holder for this tree means another verify is in flight —
  // refuse, run nothing, and never steal the holder's marker (§4.3). A marker is only
  // honored when its pid is alive AND it is not over-age: a recycled pid on an ancient
  // marker (F6) is broken like a dead one, so a crashed run can never wedge a tree.
  let staleMarkerBroken: Marker | undefined;
  const existing = readMarker(markerPath);
  if (existing !== null) {
    const overAge = now() - existing.startMs > staleMarkerMs;
    if (pidAlive(existing.pid) && !overAge) {
      return {
        refused: true,
        reason: `a live verify holds tree "${tree}" (pid ${existing.pid})`,
        tree,
        heldBy: existing,
      };
    }
    // A dead-pid OR over-age marker is a killed/abandoned run's leftover: break it and
    // proceed, surfacing the broken marker as an anomaly on the outcome (§7.4 evidence
    // vocab stays red/green/verify — the anomaly rides the outcome, not a journal event).
    rmSync(markerPath, { force: true });
    staleMarkerBroken = { pid: existing.pid, startMs: existing.startMs };
  }

  // Heal any crashed run's orphaned quarantine before this run establishes its own.
  // Replay only touches NON-live owners and swallows per-entry healing errors, so it
  // never throws out of runVerify (F4).
  replayPendingRestores({ stateHome: opts.stateHome, workspaceKey: opts.workspaceKey });

  // The quarantine is created INSIDE the try/finally (F1): a mid-quarantine failure is
  // rolled back by quarantineFiles itself, and any failure AFTER the move is healed by
  // the finally's restore — never a raw throw with the foreign red set stranded.
  let handle: QuarantineHandle | null = null;
  try {
    // Quarantine the foreign red set OUT of the repo (before the start-stamp). The
    // manifest is stamped with THIS run's pid so a concurrent replay treats it as a
    // live owner and leaves it alone (F4).
    if (exclude.length > 0) {
      handle = quarantineFiles({
        repoRoot: cwd,
        files: exclude,
        stateHome: opts.stateHome,
        workspaceKey: opts.workspaceKey,
        runId: opts.runId,
        pid,
      });
    }

    // Start-stamp: taken after quarantine, before the first scope runs (§2.6).
    const startedMs = now();
    const head = headSha(cwd) ?? "";
    const branch = currentBranch(cwd) ?? "";

    const marker: Marker = { pid, startMs: startedMs };
    writeFileSync(markerPath, JSON.stringify(marker));

    let scopes: Record<string, { green: boolean; exitCode: number; durationMs: number }>;
    try {
      scopes = runScopes(config, scopePattern, cwd, now);
    } finally {
      // Completion cleanup — the marker is removed even when a scope times out.
      rmSync(markerPath, { force: true });
    }

    const green = Object.values(scopes).every((s) => s.green);
    const record: VerifyRecord = {
      seq: mintEvidenceSeq(runDir, { pid, now }),
      ts: now(),
      writer: writerIdentity(pid, opts.writer),
      kind: "verify",
      itemId,
      startedMs,
      head,
      branch,
      tree,
      excluded: exclude,
      green,
      scopes,
    };
    appendEvidence(runDir, record, opts.journal, itemId, opts.runId, { green, tree });

    const outcome: VerifyOutcome = { refused: false, record };
    if (staleMarkerBroken !== undefined) outcome.staleMarkerBroken = staleMarkerBroken;
    return outcome;
  } finally {
    // Restore the quarantined foreign red set on completion.
    if (handle !== null) restoreQuarantine(handle);
  }
}
