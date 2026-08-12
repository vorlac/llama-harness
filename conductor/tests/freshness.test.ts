// Task 1.3 red tests — lives at conductor/tests/freshness.test.ts.
// Subject: conductor/core/freshness.ts (must not exist when this goes red; the
// failure is Cannot find module '../core/freshness.ts' — the missing-subject
// shape, a legal red per §2.6.1).
//
// Spec: plan §2.6 freshness rule (both conditions, lines 838-850), §2.6.1
// failure classes (closed vocabulary + resolution rule, lines 817-836), §3.9
// no-git mode drops the HEAD term (lines 1496-1506), Task 1.3 interfaces
// (lines 2100-2128).
// Assertions: 1.3-fresh-api, 1.3-fresh-boundary, 1.3-fresh-deletion,
// 1.3-fresh-head, 1.3-fresh-nogit, 1.3-classify-table.

import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyFreshFor, classifyFailure } from "../core/freshness.ts";

// ---------------------------------------------------------------------------
// verifyFreshFor(record, {stagedMtimes, indexMtimeMs, hasStagedDeletion,
//                         currentHead, noGit}) -> {fresh, why}
//
// Fresh iff BOTH (§2.6):
//   1. startedMs >= max(worktree mtimes of staged behavioral files that exist,
//      index mtime when any staged behavioral entry is a deletion/rename)
//      — equality counts FRESH (startedMs === ref is fresh);
//   2. record.head === currentHead — skipped entirely when noGit (§3.9).
// ---------------------------------------------------------------------------

/** Minimal §2.6 verify-record fixture: only the freshness-relevant fields. */
interface VerifyRecordFixture {
  startedMs: number;
  head: string;
}

interface FreshnessInputsFixture {
  stagedMtimes: number[];
  indexMtimeMs: number;
  hasStagedDeletion: boolean;
  currentHead: string;
  noGit: boolean;
}

interface FreshRow {
  name: string;
  record: VerifyRecordFixture;
  inputs: FreshnessInputsFixture;
  fresh: boolean;
}

const HEAD = "3f9a1c7";
const OTHER_HEAD = "b4dd00d"; // the branch the tree switched to (§2.6 condition 2)

const freshRows: FreshRow[] = [
  {
    name: "[1.3-fresh-boundary] startedMs === max staged mtime counts FRESH (boundary equality)",
    record: { startedMs: 2000, head: HEAD },
    inputs: { stagedMtimes: [1000, 2000], indexMtimeMs: 500, hasStagedDeletion: false, currentHead: HEAD, noGit: false },
    fresh: true,
  },
  {
    name: "[1.3-fresh-boundary] startedMs one ms after max staged mtime is fresh",
    record: { startedMs: 2001, head: HEAD },
    inputs: { stagedMtimes: [1000, 2000], indexMtimeMs: 500, hasStagedDeletion: false, currentHead: HEAD, noGit: false },
    fresh: true,
  },
  {
    name: "[1.3-fresh-boundary] startedMs one ms before max staged mtime is stale (an edit after the run started was never verified)",
    record: { startedMs: 1999, head: HEAD },
    inputs: { stagedMtimes: [1000, 2000], indexMtimeMs: 500, hasStagedDeletion: false, currentHead: HEAD, noGit: false },
    fresh: false,
  },
  {
    name: "[1.3-fresh-deletion] staged deletion pulls the index mtime into the max: startedMs < indexMtimeMs is stale even though every file mtime passes",
    record: { startedMs: 1500, head: HEAD },
    inputs: { stagedMtimes: [1000], indexMtimeMs: 1600, hasStagedDeletion: true, currentHead: HEAD, noGit: false },
    fresh: false,
  },
  {
    name: "[1.3-fresh-deletion] staged deletion with startedMs === indexMtimeMs counts fresh (equality boundary on the index term)",
    record: { startedMs: 1600, head: HEAD },
    inputs: { stagedMtimes: [1000], indexMtimeMs: 1600, hasStagedDeletion: true, currentHead: HEAD, noGit: false },
    fresh: true,
  },
  {
    name: "[1.3-fresh-deletion] no staged deletion: the index mtime term does NOT apply (a later index mtime alone cannot stale the record)",
    record: { startedMs: 1500, head: HEAD },
    inputs: { stagedMtimes: [1000], indexMtimeMs: 99999, hasStagedDeletion: false, currentHead: HEAD, noGit: false },
    fresh: true,
  },
  {
    name: "[1.3-fresh-deletion] pure deletion/rename (no surviving staged file mtimes): the index term alone decides, and it passes",
    record: { startedMs: 1700, head: HEAD },
    inputs: { stagedMtimes: [], indexMtimeMs: 1600, hasStagedDeletion: true, currentHead: HEAD, noGit: false },
    fresh: true,
  },
  {
    name: "[1.3-fresh-head] HEAD mismatch fails freshness while EVERY mtime term passes (the branch-switch case, §2.6 condition 2)",
    record: { startedMs: 5000, head: HEAD },
    inputs: { stagedMtimes: [1000, 2000], indexMtimeMs: 1600, hasStagedDeletion: true, currentHead: OTHER_HEAD, noGit: false },
    fresh: false,
  },
  {
    name: "[1.3-fresh-api] both conditions must hold: stale mtime AND HEAD mismatch together are stale",
    record: { startedMs: 1999, head: HEAD },
    inputs: { stagedMtimes: [2000], indexMtimeMs: 500, hasStagedDeletion: false, currentHead: OTHER_HEAD, noGit: false },
    fresh: false,
  },
  {
    name: "[1.3-fresh-nogit] noGit skips the HEAD term: the branch-switch inputs count fresh when noGit (§3.9)",
    record: { startedMs: 5000, head: HEAD },
    inputs: { stagedMtimes: [1000, 2000], indexMtimeMs: 1600, hasStagedDeletion: true, currentHead: OTHER_HEAD, noGit: true },
    fresh: true,
  },
  {
    name: "[1.3-fresh-nogit] noGit does NOT skip the mtime terms: a stale mtime still fails under noGit",
    record: { startedMs: 1999, head: HEAD },
    inputs: { stagedMtimes: [2000], indexMtimeMs: 500, hasStagedDeletion: false, currentHead: OTHER_HEAD, noGit: true },
    fresh: false,
  },
];

for (const row of freshRows) {
  test(row.name, () => {
    const res = verifyFreshFor(row.record, row.inputs);
    assert.equal(res.fresh, row.fresh, `fresh verdict for: ${row.name}`);
    // [1.3-fresh-api] the return shape is {fresh, why} on every path, and a
    // stale verdict must carry a populated reason.
    assert.equal(typeof res.why, "string", `why must be a string for: ${row.name}`);
    if (!row.fresh) {
      assert.ok(res.why.length > 0, `a stale verdict must explain itself (empty why) for: ${row.name}`);
    }
  });
}

// ---------------------------------------------------------------------------
// classifyFailure(stderr, stdout, exitCode, itemFileScope, runnerRules)
//   -> "assertion" | "missing-subject" | "error"        (§2.6.1, closed)
//
// Resolution rule (§2.6.1): missing-subject requires the unresolved
// module/symbol to resolve INSIDE this item's declared fileScope; an
// unresolved import pointing outside it (lodash, another item's module) is
// still error. Per-runner extraction rules are DATA (Task 6.1), passed in as
// runnerRules — the function stays a pure truth table.
// ---------------------------------------------------------------------------

/**
 * Per-runner resolution rules, as data (regex sources, not functions):
 *  - unresolvedPatterns: capture group 1 extracts the unresolved specifier;
 *  - assertionPatterns: recognize a genuine assertion failure;
 *  - dotsAsSeparators: python-style module dots are path separators for the
 *    fileScope membership check ("slugger.core" -> "slugger/core").
 * Relative specifiers drop their leading "./" / "../" segments before glob
 * matching ("../src/slugify.ts" -> "src/slugify.ts"); bare specifiers
 * ("lodash", "requests") are matched as-is and so land outside any src scope.
 */
interface RunnerRulesFixture {
  runner: string;
  unresolvedPatterns: string[];
  assertionPatterns: string[];
  dotsAsSeparators?: boolean;
}

const nodeRules: RunnerRulesFixture = {
  runner: "node",
  unresolvedPatterns: [String.raw`Cannot find module '([^']+)'`],
  assertionPatterns: [String.raw`AssertionError`],
};

const pytestRules: RunnerRulesFixture = {
  runner: "pytest",
  unresolvedPatterns: [String.raw`ModuleNotFoundError: No module named '([^']+)'`],
  assertionPatterns: [String.raw`AssertionError`, String.raw`(?:^|\n)E\s+assert `],
  dotsAsSeparators: true,
};

const goRules: RunnerRulesFixture = {
  runner: "go",
  unresolvedPatterns: [String.raw`(?:^|\n)([^\s:]+\.go):\d+:\d+: undefined:`],
  assertionPatterns: [String.raw`--- FAIL:`],
};

const NODE_MISSING_SUBJECT_STDERR = [
  "node:internal/modules/esm/resolve:283",
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../src/slugify.ts' imported from /work/tests/slugify.test.ts",
  "    at finalizeResolution (node:internal/modules/esm/resolve:283:11)",
].join("\n");

interface ClassifyRow {
  name: string;
  stderr: string;
  stdout: string;
  exitCode: number;
  fileScope: string[];
  rules: RunnerRulesFixture;
  expected: "assertion" | "missing-subject" | "error";
}

const classifyRows: ClassifyRow[] = [
  {
    name: "node Cannot find module '../src/slugify.ts' with src/** IN fileScope => missing-subject (greenfield first red is legal)",
    stderr: NODE_MISSING_SUBJECT_STDERR,
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "missing-subject",
  },
  {
    name: "node Cannot find module '../src/slugify.ts' NOT in fileScope => error (a test broken by unrelated breakage proves nothing)",
    stderr: NODE_MISSING_SUBJECT_STDERR,
    stdout: "",
    exitCode: 1,
    fileScope: ["lib/**"],
    rules: nodeRules,
    expected: "error",
  },
  {
    name: "node Cannot find module 'lodash' => error (a dependency is never the subject, even with src/** in scope)",
    stderr: [
      "node:internal/modules/esm/resolve:846",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'lodash' imported from /work/tests/slugify.test.ts",
    ].join("\n"),
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "error",
  },
  {
    name: "node SyntaxError in the test file => error (the test never evaluated the behavior)",
    stderr: [
      "/work/tests/slugify.test.ts:3",
      "const slug = slugify(;",
      "                     ^",
      "",
      "SyntaxError: Unexpected token ';'",
      "    at compileSourceTextModule (node:internal/modules/esm/utils:346:16)",
    ].join("\n"),
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "error",
  },
  {
    name: "node plain assertion failure => assertion (the test ran and the behavior was wrong)",
    stderr: [
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
      "",
      "'slug-if-y' !== 'slugify'",
      "",
      "    at TestContext.<anonymous> (/work/tests/slugify.test.ts:9:10)",
    ].join("\n"),
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "assertion",
  },
  {
    name: "pytest ModuleNotFoundError for the item's package (slugger.core, slugger/** in scope) => missing-subject",
    stderr: "",
    stdout: [
      "==================================== ERRORS ====================================",
      "______________________ ERROR collecting tests/test_slugger.py _________________",
      "ImportError while importing test module '/work/tests/test_slugger.py'.",
      "tests/test_slugger.py:2: in <module>",
      "    from slugger.core import slugify",
      "E   ModuleNotFoundError: No module named 'slugger.core'",
      "=========================== short test summary info ============================",
      "ERROR tests/test_slugger.py",
      "!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!",
    ].join("\n"),
    exitCode: 2,
    fileScope: ["slugger/**"],
    rules: pytestRules,
    expected: "missing-subject",
  },
  {
    name: "pytest ModuleNotFoundError for a third-party package (requests) => error (outside the item's fileScope)",
    stderr: "",
    stdout: [
      "==================================== ERRORS ====================================",
      "______________________ ERROR collecting tests/test_slugger.py _________________",
      "E   ModuleNotFoundError: No module named 'requests'",
      "=========================== short test summary info ============================",
      "ERROR tests/test_slugger.py",
    ].join("\n"),
    exitCode: 2,
    fileScope: ["slugger/**"],
    rules: pytestRules,
    expected: "error",
  },
  {
    name: "go build failure naming the item's package (slugify/slugify_test.go undefined symbol, slugify/** in scope) => missing-subject",
    stderr: [
      "# example.com/demo/slugify [example.com/demo/slugify.test]",
      "slugify/slugify_test.go:7:12: undefined: Slugify",
      "FAIL\texample.com/demo/slugify [build failed]",
      "FAIL",
    ].join("\n"),
    stdout: "",
    exitCode: 2,
    fileScope: ["slugify/**"],
    rules: goRules,
    expected: "missing-subject",
  },
  {
    name: "[F-1] node Cannot find module '../src/../secrets/leak.ts' with src/** in scope => error (interior .. escapes the fileScope: the specifier resolves to secrets/leak.ts, OUTSIDE src/**)",
    stderr: "Cannot find module '../src/../secrets/leak.ts'",
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "error",
  },
  {
    name: "[F-1] node Cannot find module 'src/../lib/x.ts' with src/** in scope => error (interior .. collapses to lib/x.ts, OUTSIDE src/**)",
    stderr: "Cannot find module 'src/../lib/x.ts'",
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "error",
  },
  {
    name: "[F-1 control] node Cannot find module '../src/slugify.ts' with src/** in scope => missing-subject (a plain leading ../ still resolves inside scope — must stay green)",
    stderr: "Cannot find module '../src/slugify.ts'",
    stdout: "",
    exitCode: 1,
    fileScope: ["src/**"],
    rules: nodeRules,
    expected: "missing-subject",
  },
];

for (const row of classifyRows) {
  test(`[1.3-classify-table] ${row.name}`, () => {
    const got = classifyFailure(row.stderr, row.stdout, row.exitCode, row.fileScope, row.rules);
    assert.equal(got, row.expected, `classifyFailure verdict for: ${row.name}`);
  });
}

// ---------------------------------------------------------------------------
// [F4] non-finite timestamps must FAIL SAFE (stale). A NaN/undefined startedMs,
// any NaN staged mtime, or a NaN index mtime when the index term applies makes
// the numeric `startedMs < Math.max(...)` comparison false — which would read a
// stale record as FRESH. verifyFreshFor must reject any non-finite timestamp up
// front. §2.6 is a proof of freshness, so an unknowable timestamp is stale.
// ---------------------------------------------------------------------------
interface NonFiniteRow {
  name: string;
  record: VerifyRecordFixture;
  inputs: FreshnessInputsFixture;
}

const nonFiniteRows: NonFiniteRow[] = [
  {
    name: "[1.3-fresh-finite] a NaN staged mtime reads STALE (Math.max(...NaN) can never prove freshness)",
    record: { startedMs: 1000, head: "h" },
    inputs: { stagedMtimes: [5000, NaN], indexMtimeMs: 0, hasStagedDeletion: false, currentHead: "h", noGit: true },
  },
  {
    name: "[1.3-fresh-finite] a NaN startedMs reads STALE (an unknown start instant cannot dominate any edit)",
    record: { startedMs: NaN, head: "h" },
    inputs: { stagedMtimes: [5000], indexMtimeMs: 0, hasStagedDeletion: false, currentHead: "h", noGit: true },
  },
  {
    name: "[1.3-fresh-finite] a NaN index mtime under a staged deletion reads STALE (the index term applies and is unknowable)",
    record: { startedMs: 9000, head: "h" },
    inputs: { stagedMtimes: [1000], indexMtimeMs: NaN, hasStagedDeletion: true, currentHead: "h", noGit: true },
  },
];

for (const row of nonFiniteRows) {
  test(row.name, () => {
    const res = verifyFreshFor(row.record, row.inputs);
    assert.equal(res.fresh, false, `non-finite timestamp must read stale: ${row.name}`);
    assert.equal(typeof res.why, "string", `why must be a string for: ${row.name}`);
    assert.ok(res.why.length > 0, `a stale verdict must explain itself for: ${row.name}`);
  });
}
