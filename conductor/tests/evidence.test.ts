// conductor/tests/evidence.test.ts — Task 6.1 red tests for THE evidence writer
// (adapter/evidence.ts, G6): runs test/verify commands, captures red/green,
// classifies the failure via core.classifyFailure, and writes the evidence ledger
// (evidence.jsonl) + journal. Composes the out-of-repo quarantine (adapter/quarantine.ts)
// under runVerify. This is a tier-A, residual-risk mechanism (prompt §8.2): every
// enumerated behavior is pinned with a WITNESS FILE where the plan asks for a proof.
//
// SUBJECTS (must NOT exist when this goes red; the failures are
// `Cannot find module '.../conductor/adapter/evidence.ts'` and `.../quarantine.ts`
// — the missing-subject shape, a legal greenfield red because the unresolved paths
// resolve inside THIS item's fileScope):
//   - conductor/adapter/evidence.ts    (runTest / runVerify / classification / ledger)
//   - conductor/adapter/quarantine.ts  (out-of-repo move-aside + crash-safe manifest)
//
// ADAPTER modules (G14): node:fs / node:child_process / node:path only; may read
// Date.now; no Bun, no shell tag, no `bun:` import — the purity guard scans them.
//
// HERMETIC: every fixture is a throwaway `git init` repo under os.tmpdir() (built with
// a hermetic GIT_ENV), the out-of-repo stateHome is a SEPARATE throwaway dir, and every
// runner command is a real `node -e` / `node --test` subprocess. Never the llama-leash
// repo; never port 8080. All temp dirs (repos AND out-of-repo quarantine roots) are
// removed in after().
//
// Spec read for this test:
//   plan 2396-2441 (Task 6.1) — the runTest/runVerify interfaces + the enumerated
//     test list (2425-2440), read verbatim and NOT thinned.
//   plan 478-635 §2.1 — itemTest template substitutions {files}/{dirs}/{name}, the
//     basename-alternation rule, the zero-test guard, and the illegal-red fallback rule.
//   plan 797-851 §2.6/§2.6.1 — the EvidenceRecord shapes and the closed failure-class
//     vocabulary (assertion / missing-subject / error) + the freshness rule.
//   plan 1544-1635 §4.2/§4.3 — the foreign red set moved OUT of the repo, the crash-safe
//     manifest, and the per-tree verify marker.
//   docs/build/specs/task-6.1.assertions.json — the 11 rows + phaseGate1Bindings.
//
// Assertion id -> test name (see the RETURN report for the full map):
//   6.1-template-name  -> "[6.1-template] substituteItemTest expands {files}, {dirs}, and {name} (basename-alternation)"
//   6.1-classify       -> "[6.1-runner-rules] RUNNER_PROFILES ship tight anchored rules; detectRunner keys off the command (phaseGate 1b)"
//                      -> "[6.1-classify-e2e] real ESM missing-import: IN fileScope => missing-subject, OUTSIDE => error (phaseGate 1c relativization)"
//   6.1-runtest        -> "[6.1-runtest] runTest node -e exit 1/0 -> red/green EvidenceRecord; assertion classified; appends ledger + journal"
//                      -> "[6.1-zero-test] a targeted run that executed no tests is neither red nor pass -> falls back (targeted:false)"
//   6.1-fallback       -> "[6.1-fallback] no template -> targeted:false; illegal-red rule fires when the excerpt names no testScope file"
//   6.1-runverify-order-> "[6.1-runverify] runVerify: start-stamp <= mid-run mtime; HEAD/branch recorded; verify record valid; appends ledger + journal"
//   6.1-witness        -> "[6.1-build-witness] build-fail => the test is provably NOT run (witness file absent); scope red with the build exit"
//   6.1-marker         -> "[6.1-marker] verify marker {pid,startMs} created-during / removed-after; live marker refuses; stale (dead pid) marker is broken with an anomaly"
//   6.1-quarantine-out -> "[6.1-quarantine] excludeTestFiles moved OUT of the repo before the start-stamp; a quarantined red is provably not executed (witness); restored after; mtime survives"
//   6.1-crash-manifest -> "[6.1-heal] a mid-verify kill's orphaned quarantine is healed on the next runVerify (manifest replays pending restores)"
//   6.1-mtime          -> (covered by [6.1-quarantine] + tests/quarantine.test.ts)
//   6.1-ledger         -> (covered by [6.1-runtest] + [6.1-runverify])
// phaseGate1Bindings -> tests:
//   (a) per-kind validation -> "[6.1-per-kind] validateEvidenceRecord rejects a verify record missing startedMs/head/green/scopes (merged schema would accept it)"
//   (b) tight anchored runnerRules -> "[6.1-runner-rules] ..."
//   (c) relativize absolute cwd-prefixed paths BEFORE classifyFailure -> "[6.1-classify-e2e] ..." (real ESM absolute-path fixture)
//   timeout -> "[6.1-timeout] a scope that never exits is KILLED at timeoutMs (its post-timeout witness is never written); scope red"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, devNull } from "node:os";
import * as path from "node:path";

// Subjects under test — absent at red time (the two missing-subject reds).
import {
  runTest,
  runVerify,
  substituteItemTest,
  validateEvidenceRecord,
  detectRunner,
  RUNNER_PROFILES,
  childEnv,
} from "../adapter/evidence.ts";
import type { ScopeSpec, VerifyConfig, VerifyOutcome, RunTestResult } from "../adapter/evidence.ts";

// Composed subjects (already built) whose contracts evidence.ts must honor.
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { classifyFailure, type RunnerRules } from "../core/freshness.ts";
import { MAIN_TREE, validate } from "../core/types.ts";
import { treePath } from "../core/types.ts";
import type { TreePath } from "../core/types.ts";
import type { Config, EvidenceRecord, TreeSlug } from "../core/types.ts";
// Directly exercised in the healing test to plant an orphaned quarantine.
import { quarantineFiles } from "../adapter/quarantine.ts";

// ---------------------------------------------------------------------------
// EXPECTED EXPORT SURFACE the implementer must target (recorded so the run is a
// construction, not a hope). Signatures:
//
//   runTest(runDir, itemId, {
//     scope: ScopeSpec; testFiles: string[]; cwd: string; fileScope: string[];
//     excludeTestFiles?: string[]; journal: Journal;
//     stateHome?: string; workspaceKey?: string; runId?: string; now?: () => number;
//   }): RunTestResult
//     ScopeSpec { name; command: string[]; timeoutMs: number; itemTest?: string[]; buildCommand?: string[] }
//     RunTestResult { record: EvidenceRecord /* kind red|green, appended */;
//        targeted; fellBack; ranZeroTests; buildFailed; namesTestScopeFile; legalRed }
//
//   runVerify(runDir, itemId, config: VerifyConfig, scopePattern: string, {
//     cwd: string; excludeTestFiles?: string[]; journal: Journal;
//     stateHome: string; workspaceKey: string; runId: string;
//     tree?: TreeSlug /* "main" | itemId, default MAIN_TREE */;
//     now?: () => number; pid?: number;
//   }): VerifyOutcome
//     VerifyConfig { verify: { scopes: Record<string, VerifyScopeSpec>;
//        behavioralPaths?: string[]; requiredScopes: Array<{pattern; scopes: string[]}> } }
//     VerifyScopeSpec { command: string[]; timeoutMs: number; itemTest?: string[]; buildCommand?: string[] }
//     VerifyOutcome =
//       | { refused: false; record: verify-kind EvidenceRecord; staleMarkerBroken?: {pid;startMs} }
//       | { refused: true; reason: string; tree: string; heldBy: {pid;startMs} }
//     scopePattern is a representative changed-path matched (globMatch) against
//     requiredScopes[].pattern to select the scopes to run; runVerify order is
//     quarantine -> replay-heal -> start-stamp -> HEAD/branch -> marker -> run.
//
//   substituteItemTest(template: string[], testFiles: string[]): string[]
//   detectRunner(command: string[]): RunnerProfile  ({ runner; rules; zeroTestPatterns })
//   RUNNER_PROFILES: Record<string, RunnerProfile>   (keys: node/pytest/go/ctest)
//   validateEvidenceRecord(rec: unknown): { ok: boolean; errors: string[] }
//       — enforces PER-KIND required fields beyond §2's merged-union schema.
//   Marker file: <runDir>/verify-running-<treeKey>.json  = { pid, startMs }
// ---------------------------------------------------------------------------

// Hermetic git (no global/system config, deterministic committer, no prompts).
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
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

// A committed fixture repo (so runVerify records a real HEAD sha + branch "main").
function committedRepo(): TreePath {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-evi-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

// The <runDir> where evidence.jsonl / journal.jsonl / the verify marker live.
function freshRunDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-evi-run-"));
  tmpDirs.push(dir);
  return dir;
}

// The OUT-OF-REPO state home for the quarantine (§4.2) — a DISTINCT temp dir.
function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-evi-state-"));
  tmpDirs.push(dir);
  return dir;
}

const HEX40 = /^[0-9a-f]{40}$/;
const FIXED_MTIME_S = Date.UTC(2024, 5, 1, 0, 0, 0) / 1000;

// A full, valid §2.1 Config, only used to build the real journal. Assigned to a
// variable so no excess-property check fires.
function fullConfig(): Config {
  const cfg: Config = {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "refuse" },
    workflow: {
      trivialMaxFiles: 2,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 6,
      skepticsPerFinding: 2,
      reviewMaxRounds: 3,
      vetCritics: 3,
      vetMaxRounds: 3,
      testRepairAttempts: 3,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 2,
    },
    parallel: { writes: "off", maxImplementers: 2, maxReaders: 6, subSessionTimeoutMs: 900000 },
    models: { default: "qwen3.6-27b", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 20, maxRunDirBytes: 268435456, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
  return cfg;
}

function makeJournal(runDir: string): Journal {
  // Empty env => dev/test mode (createJournal throws on an unknown event, so an
  // off-vocabulary evidence event would fail loudly here).
  return createJournal(runDir, fullConfig(), {});
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvidenceRecord);
}

function readJournalEvents(runDir: string): Array<{ component: string; event: string }> {
  const file = path.join(runDir, "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { component: string; event: string });
}

// A `node -e` argv whose script writes `content` to `abs` (paths embedded via
// JSON.stringify so they are valid JS string literals, spawned shell:false).
function nodeWriteCmd(abs: string, content: string, exitCode: number): string[] {
  const script =
    `require('fs').writeFileSync(${JSON.stringify(abs)}, ${JSON.stringify(content)});` +
    `process.exit(${exitCode});`;
  return [process.execPath, "-e", script];
}

// A pid that is provably dead: spawnSync waits for the child, so by the time it
// returns the pid has exited and been reaped (process.kill(pid,0) -> ESRCH).
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "0"], { stdio: "ignore" });
  if (typeof r.pid === "number" && r.pid > 1) return r.pid;
  return 2147483646; // fallback: an improbable pid
}

// A minimal VerifyConfig whose single scope "unit" runs `command` (optionally after
// `buildCommand`); requiredScopes "**" matches any scopePattern.
function verifyConfig(command: string[], opts?: { buildCommand?: string[]; timeoutMs?: number }): VerifyConfig {
  const cfg: VerifyConfig = {
    verify: {
      scopes: {
        unit: {
          command,
          timeoutMs: opts?.timeoutMs ?? 600000,
          ...(opts?.buildCommand !== undefined ? { buildCommand: opts.buildCommand } : {}),
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
  };
  return cfg;
}

function verifyScopes(o: VerifyOutcome): Record<string, { green: boolean; exitCode: number; durationMs: number }> {
  assert.equal(o.refused, false, "expected runVerify to run, not refuse");
  if (o.refused) throw new Error("unreachable"); // narrows the union for tsc
  return o.record.scopes;
}

// ===========================================================================
// §2.1 template substitution — pure, no subprocess
// ===========================================================================

test("[6.1-template] substituteItemTest expands {files}, {dirs}, and {name} (basename-alternation)", () => {
  // {files}: the testScope files spliced in as argv entries.
  assert.deepEqual(
    substituteItemTest(["node", "--test", "{files}"], ["tests/a.test.ts", "tests/b.test.ts"]),
    ["node", "--test", "tests/a.test.ts", "tests/b.test.ts"],
    "{files} splices every testScope file as its own argv entry (§2.1, plan 502-503)",
  );

  // {dirs}: the unique parent dirs in ./dir form (go package targeting, plan 503-506).
  assert.deepEqual(
    substituteItemTest(["go", "test", "{dirs}"], ["pkg/a/x_test.go", "pkg/a/y_test.go", "pkg/b/z_test.go"]),
    ["go", "test", "./pkg/a", "./pkg/b"],
    "{dirs} is the UNIQUE parent dirs of the testScope files in ./dir form (§2.1, plan 503-506)",
  );

  // {name}: an alternation regex over BASENAMES with extensions stripped. The
  // enumerated case: tests/parser_test.go => parser_test (plan 2429-2430).
  const single = substituteItemTest(["ctest", "-R", "{name}"], ["tests/parser_test.go"]);
  assert.equal(single.length, 3, "{name} substitutes into a single argv entry");
  assert.equal(single[0], "ctest");
  assert.equal(single[1], "-R");
  const nameArg = single[2];
  assert.match(nameArg, /(^|[^A-Za-z0-9_])parser_test([^A-Za-z0-9_]|$)/, "the {name} arg names parser_test");
  assert.equal(nameArg.includes("/"), false, "{name} strips the directory (tests/) — plan 507-508");
  assert.equal(nameArg.includes(".go"), false, "{name} strips the extension (.go) — plan 507");

  // Multi-file {name}: an alternation over both basenames.
  const multi = substituteItemTest(["ctest", "-R", "{name}"], ["tests/parser_test.go", "tests/lexer_test.go"]);
  const multiArg = multi[2];
  assert.match(multiArg, /parser_test/, "multi-file {name} includes the first basename");
  assert.match(multiArg, /lexer_test/, "multi-file {name} includes the second basename");
  assert.match(multiArg, /\|/, "multi-file {name} is an ALTERNATION regex over the basenames (plan 506-509)");
});

// ===========================================================================
// phaseGate 1b — tight, anchored runner rules keyed off the command
// ===========================================================================

test("[6.1-runner-rules] RUNNER_PROFILES ship tight anchored rules; detectRunner keys off the command (phaseGate 1b)", () => {
  for (const runner of ["node", "pytest", "go", "ctest"]) {
    const profile = RUNNER_PROFILES[runner];
    assert.ok(profile !== undefined, `RUNNER_PROFILES must define the "${runner}" default runner`);
    assert.equal(profile.runner, runner, "profile.runner names the runner");
    assert.ok(profile.rules.unresolvedPatterns.length > 0, `${runner} rules have unresolved-specifier patterns`);
    assert.ok(profile.rules.assertionPatterns.length > 0, `${runner} rules have assertion patterns`);
    assert.ok(profile.zeroTestPatterns.length > 0, `${runner} ships §2.1 zero-test patterns`);
  }

  // detectRunner keys off the command's argv (plan 2408-2410: per-runner rules are DATA).
  assert.equal(detectRunner([process.execPath, "--test", "x"]).runner, "node", "a node --test command -> node rules");
  assert.equal(detectRunner(["node", "--test"]).runner, "node");
  assert.equal(detectRunner(["pytest", "-q"]).runner, "pytest");
  assert.equal(detectRunner(["go", "test", "./..."]).runner, "go");
  assert.equal(detectRunner(["ctest", "-R", "x"]).runner, "ctest");

  // The shipped node rules are tight: fed to core.classifyFailure they bin correctly
  // and do NOT mis-classify an unrelated crash that merely contains a token.
  const nodeRules: RunnerRules = RUNNER_PROFILES.node.rules;
  assert.equal(
    classifyFailure("Cannot find module 'src/parser.ts'\n", "", 1, ["src/**"], nodeRules),
    "missing-subject",
    "an in-scope unresolved module is the greenfield legal red",
  );
  assert.equal(
    classifyFailure("Cannot find module 'lodash'\n", "", 1, ["src/**"], nodeRules),
    "error",
    "a bare dependency is never the subject -> error",
  );
  assert.equal(
    classifyFailure("AssertionError [ERR_ASSERTION]: expected 1 to equal 2\n", "", 1, ["src/**"], nodeRules),
    "assertion",
    "a genuine assertion failure with no unresolved specifier -> assertion",
  );
  assert.equal(
    classifyFailure("Segmentation fault (core dumped)\n", "", 139, ["src/**"], nodeRules),
    "error",
    "an unrelated crash with neither an unresolved specifier nor an assertion token -> error (not mis-binned)",
  );
});

// ===========================================================================
// phaseGate 1a — evidence.ts validates PER-KIND required fields (Finding 4/5)
// ===========================================================================

test("[6.1-per-kind] validateEvidenceRecord rejects a verify record missing startedMs/head/green/scopes (merged schema would accept it)", () => {
  const base = {
    seq: 1,
    ts: 1754560400000,
    kind: "verify" as const,
    itemId: "I1",
    startedMs: 1754560300000,
    head: "3f9a1c7",
    branch: "main",
    tree: MAIN_TREE,
    excluded: [] as string[],
    green: true,
    scopes: { unit: { green: true, exitCode: 0, durationMs: 41876 } },
    // The §2.6 writer stamp: every appended record names the process that wrote it,
    // so a foreign session's line is attributable on its face (ISSUE-026/-027).
    writer: { pid: 4242, startedMs: 1754560000000 },
  };

  // A complete verify record passes evidence.ts's own per-kind validator.
  const okComplete = validateEvidenceRecord(base);
  assert.equal(okComplete.ok, true, `a complete verify record must validate: ${okComplete.errors.join("; ")}`);

  // Drop each per-kind required field in turn -> evidence.ts must REJECT it.
  for (const field of ["startedMs", "head", "green", "scopes"] as const) {
    const partial: Record<string, unknown> = { ...base };
    delete partial[field];

    // The §2 MERGED-UNION schema deliberately requires only the four shared fields,
    // so it ACCEPTS the malformed verify — this is exactly why evidence.ts must add
    // its own per-kind gate (the Finding-4/5 chain).
    const merged = validate("EvidenceRecord", partial);
    assert.equal(
      merged.ok,
      true,
      `precondition: the merged-union schema accepts a verify missing "${field}" (it requires only the shared fields)`,
    );

    const result = validateEvidenceRecord(partial);
    assert.equal(
      result.ok,
      false,
      `evidence.ts MUST reject a verify record missing "${field}" — never silently treat it as fresh (phaseGate 1a)`,
    );
    assert.ok(
      result.errors.some((e: string) => e.includes(field)),
      `the rejection reason must name the missing field "${field}" (got: ${result.errors.join("; ")})`,
    );
  }

  // The red kind is likewise per-kind validated.
  const redOk = {
    seq: 2,
    ts: 1,
    kind: "red" as const,
    itemId: "I1",
    command: ["node", "--test", "tests/x.test.ts"],
    exitCode: 1,
    failureExcerpt: "AssertionError",
    failureClass: "assertion" as const,
    targeted: true,
    writer: { pid: 4242, startedMs: 1754560000000 },
  };
  assert.equal(validateEvidenceRecord(redOk).ok, true, "a complete red record validates");
  const redMissing: Record<string, unknown> = { ...redOk };
  delete redMissing.failureClass;
  const redRes = validateEvidenceRecord(redMissing);
  assert.equal(redRes.ok, false, "a red record missing failureClass is rejected");
  assert.ok(redRes.errors.some((e: string) => e.includes("failureClass")), "the reason names failureClass");
});

// ===========================================================================
// runTest — node -e exit 0/1 shapes -> red/green record; appends ledger + journal
// ===========================================================================

test("[6.1-runtest] runTest node -e exit 1/0 -> red/green EvidenceRecord; assertion classified; appends ledger + journal", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const journal = makeJournal(runDir);

  // exit 1 with an assertion-shaped stderr -> a RED record, class "assertion".
  const redScope: ScopeSpec = {
    name: "unit",
    command: [
      process.execPath,
      "-e",
      "process.stderr.write('AssertionError [ERR_ASSERTION]: expected 1 to equal 2\\n'); process.exit(1);",
    ],
    timeoutMs: 600000,
    itemTest: [process.execPath, "-e", "process.stderr.write('AssertionError [ERR_ASSERTION]: nope\\n'); process.exit(1);"],
  };
  const red: RunTestResult = runTest(runDir, "I1", {
    scope: redScope,
    testFiles: ["tests/x.test.ts"],
    cwd: repo,
    fileScope: ["src/**"],
    journal,
  });
  assert.equal(red.record.kind, "red", "a non-zero exit is a red record");
  if (red.record.kind !== "red") throw new Error("unreachable");
  assert.equal(red.record.exitCode, 1, "the red record carries the child's exit code");
  assert.equal(red.record.failureClass, "assertion", "an assertion-shaped failure classifies as assertion");
  assert.equal(red.record.targeted, true, "a run derived from the itemTest template is targeted");
  assert.ok(red.record.failureExcerpt.length > 0, "the red record captures a failure excerpt");
  assert.ok(red.record.failureExcerpt.length <= 300, "the excerpt is bounded (<=300 chars, §2.6)");

  // exit 0 -> a GREEN record (the targeted test unexpectedly passed).
  const greenScope: ScopeSpec = {
    name: "unit",
    command: [process.execPath, "-e", "process.exit(0)"],
    timeoutMs: 600000,
    itemTest: [process.execPath, "-e", "process.exit(0)"],
  };
  const green = runTest(runDir, "I1", {
    scope: greenScope,
    testFiles: ["tests/x.test.ts"],
    cwd: repo,
    fileScope: ["src/**"],
    journal,
  });
  assert.equal(green.record.kind, "green", "a zero exit is a green record");
  if (green.record.kind !== "green") throw new Error("unreachable");
  assert.equal(green.record.exitCode, 0, "the green record carries exit 0");

  journal.flushSync();

  // Both runs appended to evidence.jsonl (§2.6 ledger), monotonic seq, schema-valid.
  const ledger = readEvidence(runDir);
  assert.equal(ledger.length, 2, "runTest appends exactly one record per call");
  assert.equal(ledger[0].kind, "red");
  assert.equal(ledger[1].kind, "green");
  assert.ok(ledger[1].seq > ledger[0].seq, "evidence seq is monotonic across appends");
  for (const rec of ledger) {
    assert.equal(validateEvidenceRecord(rec).ok, true, "every appended record passes per-kind validation");
  }

  // Both runs journalled under the "evidence" component (plan 2422).
  const events = readJournalEvents(runDir);
  assert.ok(
    events.some((e) => e.component === "evidence" && e.event === "red"),
    "runTest journals an evidence:red event",
  );
  assert.ok(
    events.some((e) => e.component === "evidence" && e.event === "green"),
    "runTest journals an evidence:green event",
  );
});

// ===========================================================================
// §2.1 zero-test guard — a targeted run that executed NO tests falls back
// ===========================================================================

test("[6.1-zero-test] a targeted run that executed no tests is neither red nor pass -> falls back (targeted:false)", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const journal = makeJournal(runDir);

  // The targeted itemTest exits 0 but reports that no tests ran (both a node-real
  // "# tests 0" and the generic "no tests to run" default, so whichever zeroTestPattern
  // the node profile ships, the guard fires — §2.1, plan 510-514).
  const scope: ScopeSpec = {
    name: "unit",
    itemTest: [process.execPath, "-e", "process.stdout.write('# tests 0\\nno tests to run\\n'); process.exit(0);"],
    // The full-scope fallback command yields a legal red naming the item's testScope file.
    command: [
      process.execPath,
      "-e",
      "process.stderr.write('AssertionError in tests/mine.test.ts\\n'); process.exit(1);",
    ],
    timeoutMs: 600000,
  };
  const result = runTest(runDir, "I1", {
    scope,
    testFiles: ["tests/mine.test.ts"],
    cwd: repo,
    fileScope: ["src/**"],
    journal,
  });

  assert.equal(result.ranZeroTests, true, "the zero-test guard fires (the targeted run executed no tests)");
  assert.equal(result.fellBack, true, "a zero-test targeted run FALLS BACK to the full-scope command (§2.1)");
  assert.equal(result.targeted, false, "the fallback record is marked targeted:false (§2.1, plan 2402-2404)");
  assert.equal(result.record.kind, "red", "the full-scope fallback here is a red");
  if (result.record.kind === "red") {
    assert.equal(result.record.targeted, false, "record.targeted mirrors the fallback");
  }
});

// ===========================================================================
// §2.1 fallback illegal-red rule — the excerpt must name a testScope file
// ===========================================================================

test("[6.1-fallback] no template -> targeted:false; illegal-red rule fires when the excerpt names no testScope file", () => {
  const repo = committedRepo();

  // No itemTest -> runTest runs the full scope command and marks targeted:false. The
  // §2.1 rule: a fallback red is LEGAL only if its excerpt names a file in the item's
  // testScope (else a suite failure elsewhere is impersonating this item's red).
  function fallbackRed(excerptStderr: string): RunTestResult {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    const scope: ScopeSpec = {
      name: "unit",
      command: [process.execPath, "-e", `process.stderr.write(${JSON.stringify(excerptStderr)}); process.exit(1);`],
      timeoutMs: 600000,
      // deliberately NO itemTest -> the no-template fallback path
    };
    return runTest(runDir, "I1", {
      scope,
      testFiles: ["tests/mine.test.ts"],
      cwd: repo,
      fileScope: ["src/**"],
      journal,
    });
  }

  const legal = fallbackRed("AssertionError in tests/mine.test.ts\n");
  assert.equal(legal.targeted, false, "no template => targeted:false");
  assert.equal(legal.namesTestScopeFile, true, "the excerpt names the item's testScope file");
  assert.equal(legal.legalRed, true, "a fallback red whose excerpt names a testScope file is LEGAL (§2.1)");

  const illegal = fallbackRed("AssertionError in tests/somebody_elses.test.ts\n");
  assert.equal(illegal.targeted, false, "no template => targeted:false");
  assert.equal(illegal.namesTestScopeFile, false, "the excerpt names NO testScope file");
  assert.equal(
    illegal.legalRed,
    false,
    "the illegal-red rule FIRES: a fallback red naming no testScope file is illegal (§2.1, plan 2431)",
  );
});

// ===========================================================================
// phaseGate 1c — real ESM absolute-path relativization + end-to-end classification
// ===========================================================================

test("[6.1-classify-e2e] real ESM missing-import: IN fileScope => missing-subject, OUTSIDE => error (phaseGate 1c relativization)", () => {
  // Node v26 ESM emits an ABSOLUTE path: `Cannot find module '/abs/.../src/parser.ts'`
  // even when the source specifier was relative. An absolute path never matches a
  // repo-relative fileScope glob, so evidence.ts MUST relativize (strip the cwd) BEFORE
  // core.classifyFailure — otherwise a legal greenfield red misclassifies as "error"
  // and the item dies (verified against real Node v26 here, not a hand-typed string).
  const repo = committedRepo();
  mkdirSync(path.join(repo, "tests"), { recursive: true });

  // A: imports a not-yet-existing module INSIDE fileScope (src/**) -> missing-subject.
  writeFileSync(
    path.join(repo, "tests", "in_scope.test.mjs"),
    `import test from "node:test";\nimport { parse } from "../src/parser.ts";\ntest("t", () => { parse(); });\n`,
  );
  // B: imports a not-yet-existing module OUTSIDE fileScope -> error (illegal).
  writeFileSync(
    path.join(repo, "tests", "out_scope.test.mjs"),
    `import test from "node:test";\nimport { parse } from "../outside/parser.ts";\ntest("t", () => { parse(); });\n`,
  );

  function classifyReal(testRel: string): RunTestResult {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    const cmd = [process.execPath, "--test", testRel];
    const scope: ScopeSpec = { name: "unit", command: cmd, timeoutMs: 600000, itemTest: cmd };
    return runTest(runDir, "I1", {
      scope,
      testFiles: [testRel],
      cwd: repo, // process.cwd() for the child; the absolute prefix evidence.ts must strip
      fileScope: ["src/**"],
      journal,
    });
  }

  const inScope = classifyReal("tests/in_scope.test.mjs");
  assert.equal(inScope.record.kind, "red", "the missing import is a red");
  if (inScope.record.kind === "red") {
    assert.equal(
      inScope.record.failureClass,
      "missing-subject",
      "an IN-fileScope missing module is a legal greenfield red — this ONLY works if evidence.ts relativized the ABSOLUTE Node v26 path (phaseGate 1c)",
    );
  }
  assert.equal(inScope.legalRed, true, "missing-subject in scope is a legal red");

  const outScope = classifyReal("tests/out_scope.test.mjs");
  assert.equal(outScope.record.kind, "red");
  if (outScope.record.kind === "red") {
    assert.equal(
      outScope.record.failureClass,
      "error",
      "the same missing-import shape pointing OUTSIDE fileScope classifies as error (illegal)",
    );
  }
  assert.equal(outScope.legalRed, false, "an out-of-scope import error is not a legal red");
});

// ===========================================================================
// runVerify — order (start-stamp <= mid-run mtime), HEAD/branch, marker, ledger
// ===========================================================================

test("[6.1-runverify] runVerify: start-stamp <= mid-run mtime; HEAD/branch recorded; verify record valid; appends ledger + journal", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const stateHome = freshStateHome();
  const journal = makeJournal(runDir);

  const markerPath = path.join(runDir, "verify-running-main.json");
  const markerSnap = path.join(runDir, "marker-during.json");
  const midRun = path.join(repo, "midrun-witness.txt");

  // The scope command, WHILE running: busy-waits ~40ms (so its writes land strictly
  // after the pre-run start-stamp), writes a mid-run file, and snapshots the live
  // verify marker (proving the marker exists DURING the run). Then exits 0.
  const script =
    `const fs=require('fs');const s=Date.now();while(Date.now()-s<40){}` +
    `fs.writeFileSync(${JSON.stringify(midRun)},'x');` +
    `fs.copyFileSync(${JSON.stringify(markerPath)},${JSON.stringify(markerSnap)});` +
    `process.exit(0);`;
  const cfg = verifyConfig([process.execPath, "-e", script]);

  const beforeMs = Date.now();
  const outcome = runVerify(runDir, "I1", cfg, "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-verify",
    tree: MAIN_TREE,
  });
  journal.flushSync();

  assert.equal(outcome.refused, false, "a fresh runVerify (no live marker) runs");
  if (outcome.refused) throw new Error("unreachable");
  const rec = outcome.record;

  // HEAD/branch recorded (the tree this verify judged, §2.6).
  assert.match(rec.head, HEX40, "the verify record records the 40-hex HEAD sha it judged");
  assert.equal(rec.branch, "main", "the verify record records the branch");
  assert.equal(rec.tree, "main", "tree is the per-tree key");
  assert.equal(rec.green, true, "the exit-0 scope is green");
  assert.equal(rec.scopes.unit.green, true, "the per-scope result is green");
  assert.equal(rec.scopes.unit.exitCode, 0, "the per-scope exit code is captured");
  assert.ok(Number.isFinite(rec.scopes.unit.durationMs), "durationMs is a finite number");

  // start-stamp order: startedMs is taken BEFORE the scope ran, so it is <= a file the
  // scope wrote mid-run, and >= the instant we called runVerify (plan 2412-2413, 2426).
  const midMtimeMs = statSync(midRun).mtimeMs;
  assert.ok(rec.startedMs >= beforeMs, "startedMs is stamped at/after the runVerify call");
  assert.ok(
    rec.startedMs <= midMtimeMs,
    `the start-stamp (${rec.startedMs}) must precede a mid-run write (${midMtimeMs}) — it is taken before the first scope runs`,
  );

  // The verify marker existed DURING the run (snapshot) and is REMOVED after.
  assert.ok(existsSync(markerSnap), "the verify marker existed while the scope ran (snapshot captured)");
  const snap = JSON.parse(readFileSync(markerSnap, "utf8")) as { pid: number; startMs: number };
  assert.equal(snap.pid, process.pid, "the marker records this process's pid (the verifyInFlightTree source)");
  assert.ok(Number.isFinite(snap.startMs), "the marker records a startMs");
  assert.equal(existsSync(markerPath), false, "the marker is REMOVED on completion (plan 2419-2420)");

  // Ledger + journal (plan 2422).
  const ledger = readEvidence(runDir);
  assert.equal(ledger.length, 1, "runVerify appends one verify record");
  assert.equal(ledger[0].kind, "verify");
  assert.equal(validateEvidenceRecord(ledger[0]).ok, true, "the appended verify record passes per-kind validation");
  assert.ok(
    readJournalEvents(runDir).some((e) => e.component === "evidence" && e.event === "verify"),
    "runVerify journals an evidence:verify event",
  );
});

// ===========================================================================
// build-before-test — a build failure means the test provably did NOT run
// ===========================================================================

test("[6.1-build-witness] build-fail => the test is provably NOT run (witness file absent); scope red with the build exit", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const stateHome = freshStateHome();
  const journal = makeJournal(runDir);

  const witness = path.join(repo, "test-ran-witness.txt");
  // buildCommand FAILS; the test command would write the witness if it ever ran.
  const cfg = verifyConfig(nodeWriteCmd(witness, "the test ran", 0), {
    buildCommand: [process.execPath, "-e", "process.stderr.write('build error: cannot compile\\n'); process.exit(2);"],
  });

  const outcome = runVerify(runDir, "I1", cfg, "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-build",
    tree: MAIN_TREE,
  });

  assert.equal(
    existsSync(witness),
    false,
    "the test command must NOT run after a failed build — the witness file it would write is ABSENT (plan 486, 2426)",
  );
  assert.equal(outcome.refused, false, "a build failure still produces a (red) verify record, not a refusal");
  const scopes = verifyScopes(outcome);
  assert.equal(scopes.unit.green, false, "a build failure makes the scope red");
  assert.notEqual(scopes.unit.exitCode, 0, "the scope carries the build command's non-zero exit");
  if (!outcome.refused) assert.equal(outcome.record.green, false, "the whole verify is red when the build fails");
});

// ===========================================================================
// verify marker lifecycle — live refuses, different tree is free, stale is broken
// ===========================================================================

test("[6.1-marker] verify marker created-during / removed-after; live marker refuses; stale (dead pid) marker is broken with an anomaly", () => {
  const repo = committedRepo();
  const stateHome = freshStateHome();

  const greenCmd = [process.execPath, "-e", "process.exit(0)"];

  // (1) LIVE marker for the SAME tree -> the second runVerify REFUSES (§4.3).
  {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    // Plant a live marker (our own pid is alive) for tree "main".
    writeFileSync(
      path.join(runDir, "verify-running-main.json"),
      JSON.stringify({ pid: process.pid, startMs: Date.now() }),
    );
    const outcome = runVerify(runDir, "I1", verifyConfig(greenCmd), "src/x.ts", {
      cwd: repo,
      journal,
      stateHome,
      workspaceKey: "wkey",
      runId: "r-live",
      tree: MAIN_TREE,
    });
    assert.equal(outcome.refused, true, "a second runVerify against a LIVE marker for the same tree REFUSES (plan 2421, §4.3)");
    if (outcome.refused) {
      assert.equal(outcome.tree, "main", "the refusal names the contended tree");
      assert.equal(outcome.heldBy.pid, process.pid, "the refusal reports the live holder's pid");
    }
    assert.equal(readEvidence(runDir).length, 0, "a refused verify does NOT append a verify record (it never ran)");
    assert.ok(
      existsSync(path.join(runDir, "verify-running-main.json")),
      "a refused verify leaves the live holder's marker intact (never steals it)",
    );
  }

  // (2) LIVE marker for a DIFFERENT tree -> not blocked (markers are per-tree).
  {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    writeFileSync(
      path.join(runDir, "verify-running-I2.json"),
      JSON.stringify({ pid: process.pid, startMs: Date.now() }),
    );
    const outcome = runVerify(runDir, "I1", verifyConfig(greenCmd), "src/x.ts", {
      cwd: repo,
      journal,
      stateHome,
      workspaceKey: "wkey",
      runId: "r-other",
      tree: MAIN_TREE,
    });
    assert.equal(outcome.refused, false, "a live marker for a DIFFERENT tree does not block this tree (per-tree markers)");
    assert.equal(readEvidence(runDir).length, 1, "the unblocked verify ran and appended its record");
  }

  // (3) STALE marker (dead pid) -> broken with an anomaly, and the run PROCEEDS.
  {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    const dead = deadPid();
    writeFileSync(
      path.join(runDir, "verify-running-main.json"),
      JSON.stringify({ pid: dead, startMs: Date.now() }),
    );
    const outcome = runVerify(runDir, "I1", verifyConfig(greenCmd), "src/x.ts", {
      cwd: repo,
      journal,
      stateHome,
      workspaceKey: "wkey",
      runId: "r-stale",
      tree: MAIN_TREE,
    });
    assert.equal(outcome.refused, false, "a stale marker (dead pid) is BROKEN and the run proceeds (plan 2427-2428)");
    if (!outcome.refused) {
      assert.ok(outcome.staleMarkerBroken !== undefined, "breaking a stale marker surfaces an anomaly on the outcome");
      assert.equal(outcome.staleMarkerBroken?.pid, dead, "the anomaly names the dead pid whose marker was broken");
    }
    assert.equal(readEvidence(runDir).length, 1, "after healing the stale marker, the verify ran and appended a record");
    assert.equal(
      existsSync(path.join(runDir, "verify-running-main.json")),
      false,
      "the (now completed) run removed the marker",
    );
  }
});

// ===========================================================================
// timeout — a scope that never exits is KILLED at timeoutMs
// ===========================================================================

test("[6.1-timeout] a scope that never exits is KILLED at timeoutMs (its post-timeout witness is never written); scope red", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const stateHome = freshStateHome();
  const journal = makeJournal(runDir);

  const lateWitness = path.join(repo, "late-witness.txt");
  // Schedules a witness write 5s out, but the process would otherwise hang; timeoutMs
  // is 300ms, so evidence.ts must KILL it well before the witness fires.
  const script =
    `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(lateWitness)}, 'late'); }, 5000);` +
    `setInterval(() => {}, 1000);`;
  const cfg = verifyConfig([process.execPath, "-e", script], { timeoutMs: 300 });

  const outcome = runVerify(runDir, "I1", cfg, "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-timeout",
    tree: MAIN_TREE,
  });

  assert.equal(
    existsSync(lateWitness),
    false,
    "the never-exiting scope was KILLED at timeoutMs — its 5s-delayed witness was never written (plan 2414, 2426)",
  );
  const scopes = verifyScopes(outcome);
  assert.equal(scopes.unit.green, false, "a timed-out scope is red");
  assert.equal(
    existsSync(path.join(runDir, "verify-running-main.json")),
    false,
    "the marker is removed even when a scope times out (completion cleanup runs)",
  );
});

// ===========================================================================
// §4.2 quarantine — foreign red moved OUT of the repo, unreachable, restored, mtime kept
// ===========================================================================

test("[6.1-quarantine] excludeTestFiles moved OUT of the repo before the start-stamp; a quarantined red is provably not executed (witness); restored after; mtime survives", () => {
  const repo = committedRepo();
  const stateHome = freshStateHome();

  // A "whole-tree runner": scans <repo>/tests for *.suite.js and require()s each; a
  // collected foreign red writes a witness AND throws (failing the run). Faithful to
  // §4.2's model — being OUTSIDE the walked tree is what makes a moved-aside red
  // unreachable (plan 1590-1596).
  const witness = path.join(repo, "foreign-ran-witness.txt");
  const walker =
    `const fs=require('fs'),path=require('path');const dir=path.join(process.cwd(),'tests');` +
    `let failed=false;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.suite.js'))continue;` +
    `try{require(path.join(dir,f));}catch(e){failed=true;}}process.exit(failed?1:0);`;
  const walkerCmd = [process.execPath, "-e", walker];

  function writeForeign(): void {
    mkdirSync(path.join(repo, "tests"), { recursive: true });
    const abs = path.join(repo, "tests", "foreign.suite.js");
    writeFileSync(abs, `require('fs').writeFileSync(${JSON.stringify(witness)},'ran');throw new Error('foreign red');\n`);
    utimesSync(abs, FIXED_MTIME_S, FIXED_MTIME_S);
  }

  // CONTROL: without quarantine the walker DOES collect the foreign red (proves the
  // "absent" assertion below is not vacuous).
  writeForeign();
  rmSync(witness, { force: true });
  {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    const outcome = runVerify(runDir, "I1", verifyConfig(walkerCmd), "src/x.ts", {
      cwd: repo,
      journal,
      stateHome,
      workspaceKey: "wkey",
      runId: "r-control",
      tree: MAIN_TREE,
    });
    assert.ok(existsSync(witness), "control: the whole-tree walker DOES collect an in-repo foreign red");
    const scopes = verifyScopes(outcome);
    assert.equal(scopes.unit.green, false, "control: the collected foreign red fails the verify");
  }

  // QUARANTINED: the same foreign file is moved OUT of the repo before the start-stamp,
  // so the walker cannot reach it -> no witness, green -> then it is RESTORED.
  rmSync(witness, { force: true });
  writeForeign();
  const foreignAbs = path.join(repo, "tests", "foreign.suite.js");
  {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    const outcome = runVerify(runDir, "I1", verifyConfig(walkerCmd), "src/x.ts", {
      cwd: repo,
      journal,
      stateHome,
      workspaceKey: "wkey",
      runId: "r-quar",
      tree: MAIN_TREE,
      excludeTestFiles: ["tests/foreign.suite.js"],
    });

    assert.equal(
      existsSync(witness),
      false,
      "a QUARANTINED foreign red is provably NOT executed — moved OUT of the walked tree, its witness is absent (plan 2435-2437)",
    );
    const scopes = verifyScopes(outcome);
    assert.equal(scopes.unit.green, true, "with the foreign red quarantined, the verify is green");
    if (!outcome.refused) {
      assert.ok(
        outcome.record.excluded.includes("tests/foreign.suite.js"),
        "the verify record lists the quarantined exclusions in force (§3.2, plan 2418, 812)",
      );
    }

    // Restored to the repo after completion, with mtime intact (rename, not copy).
    assert.ok(existsSync(foreignAbs), "the quarantined file is RESTORED to the repo after the verify completes");
    assert.equal(
      Math.floor(statSync(foreignAbs).mtimeMs / 1000),
      FIXED_MTIME_S,
      "the restored file's mtime SURVIVES the round-trip (rename) so §2.6 freshness is not invalidated (plan 2439-2440)",
    );
  }
});

// ===========================================================================
// §4.2 crash healing — the next runVerify replays a crashed run's pending restores
// ===========================================================================

test("[6.1-heal] a mid-verify kill's orphaned quarantine is healed on the next runVerify (manifest replays pending restores)", () => {
  const repo = committedRepo();
  const stateHome = freshStateHome();

  // Simulate a CRASHED prior run: quarantineFiles moved the foreign red out (writing a
  // manifest) and the process died before restoring — an orphaned quarantine remains.
  mkdirSync(path.join(repo, "tests"), { recursive: true });
  const foreignAbs = path.join(repo, "tests", "foreign.suite.js");
  writeFileSync(foreignAbs, "throw new Error('foreign red');\n");
  utimesSync(foreignAbs, FIXED_MTIME_S, FIXED_MTIME_S);

  // A crashed run's pid is DEAD: replay heals only NON-live owners (F4). Stamp a dead
  // pid so this is a faithful orphan (a live pid would be an in-flight verify whose files
  // must NOT be stolen back mid-run).
  quarantineFiles({
    repoRoot: repo,
    files: ["tests/foreign.suite.js"],
    stateHome,
    workspaceKey: "wkey",
    runId: "r-crashed",
    pid: deadPid(),
  });
  assert.equal(existsSync(foreignAbs), false, "precondition: the crashed run left the foreign red quarantined");

  // The NEXT runVerify heals the orphan at start (replaying pending restores) BEFORE it
  // runs — mirroring the stale-marker healing (plan 2438-2439). This run excludes
  // nothing of its own, so its only quarantine action is the heal.
  const runDir = freshRunDir();
  const journal = makeJournal(runDir);
  const outcome = runVerify(runDir, "I1", verifyConfig([process.execPath, "-e", "process.exit(0)"]), "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-next",
    tree: MAIN_TREE,
  });

  assert.equal(outcome.refused, false, "the healing run proceeds");
  assert.ok(
    existsSync(foreignAbs),
    "the orphaned quarantined file is RESTORED to the repo by the next run's replay (plan 2438-2439)",
  );
  assert.equal(
    readFileSync(foreignAbs, "utf8"),
    "throw new Error('foreign red');\n",
    "the healed file's content is byte-identical",
  );
  assert.equal(
    Math.floor(statSync(foreignAbs).mtimeMs / 1000),
    FIXED_MTIME_S,
    "the healed file's mtime survives (rename) so freshness is not invalidated",
  );
});

// ===========================================================================
// Crash-safety + sandbox hardening (F3, F5, F6, F7, F8)
// ===========================================================================

// --- F5: the illegal-red legality check reads ONLY the bounded excerpt, and
//         matches a testScope file by FULL relative path (not basename) ---------

test("[6.1-illegal-red-excerpt] legality reads ONLY the <=300-char excerpt and matches the FULL testScope path", () => {
  const repo = committedRepo();

  function fallbackRed(stderr: string): RunTestResult {
    const runDir = freshRunDir();
    const journal = makeJournal(runDir);
    const scope: ScopeSpec = {
      name: "unit",
      command: [process.execPath, "-e", `process.stderr.write(${JSON.stringify(stderr)}); process.exit(1);`],
      timeoutMs: 600000,
      // deliberately NO itemTest -> the no-template fallback path (targeted:false)
    };
    return runTest(runDir, "I1", {
      scope,
      testFiles: ["tests/mine.test.ts"],
      cwd: repo,
      fileScope: ["src/**"],
      journal,
    });
  }

  // The item's OWN test PASSED; an UNRELATED suite failed with the assertion at the
  // HEAD of the output, and the item's testScope file is named only DEEP in the tail
  // (past the 300-char excerpt bound). A full-text/basename check would call this a
  // legal red (its name appears somewhere); the correct rule reads ONLY the excerpt,
  // which names no testScope file -> ILLEGAL.
  const head =
    "AssertionError [ERR_ASSERTION]: an UNRELATED suite failed in tests/other_unrelated.test.ts. " +
    "x".repeat(320) +
    " ... tail: tests/mine.test.ts ... ok (passed)\n";
  const deep = fallbackRed(head);
  assert.ok(head.indexOf("tests/mine.test.ts") > 300, "precondition: the item's file is named only PAST the excerpt bound");
  if (deep.record.kind !== "red") throw new Error("expected a red");
  assert.equal(deep.record.failureClass, "assertion", "the head is assertion-shaped -> legal class");
  assert.ok(deep.record.failureExcerpt.length <= 300, "the excerpt is bounded to <=300 chars");
  assert.equal(
    deep.record.failureExcerpt.includes("tests/mine.test.ts"),
    false,
    "the bounded excerpt does NOT name the item's testScope file",
  );
  assert.equal(
    deep.namesTestScopeFile,
    false,
    "namesTestScopeFile is computed from the EXCERPT only — a deep tail mention does not count (F5)",
  );
  assert.equal(
    deep.legalRed,
    false,
    "an unrelated suite failure whose excerpt names no testScope file is an ILLEGAL red (§2.1, plan 2431)",
  );

  // A genuine red whose EXCERPT (the head) DOES name the item's testScope file, by its
  // full relative path, is a LEGAL red.
  const genuine = fallbackRed("AssertionError [ERR_ASSERTION]: expected 1 to equal 2 in tests/mine.test.ts\n");
  assert.equal(genuine.namesTestScopeFile, true, "the excerpt names the item's testScope file by full path");
  assert.equal(genuine.legalRed, true, "a red whose excerpt names a testScope file is LEGAL (F5)");
});

// --- F3: runVerify rejects a sandbox-escaping tree key ------------------------

test("[6.1-marker-tree-safeid] runVerify rejects a traversing tree key (markerPathOf trust boundary)", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const stateHome = freshStateHome();
  const journal = makeJournal(runDir);
  const cfg = verifyConfig([process.execPath, "-e", "process.exit(0)"]);

  assert.throws(
    () =>
      runVerify(runDir, "I1", cfg, "src/x.ts", {
        cwd: repo,
        journal,
        stateHome,
        workspaceKey: "wkey",
        runId: "r-evil",
        // A poisoned slug that got PAST the type — core/types.ts treeSlug would
        // refuse it at construction — so what is asserted here is the evidence
        // layer's OWN runtime guard: assertSafeId, which is not relaxed.
        tree: "../../tmp/evil" as unknown as TreeSlug,
      }),
    /escape|separator|slug/i,
    "a tree key that would climb out of runDir must be rejected before any marker is written",
  );
  // Nothing leaked: no verify record was appended.
  assert.equal(readEvidence(runDir).length, 0, "a rejected verify appends no record");

  // A valid tree ("main") still works.
  const ok = runVerify(runDir, "I1", cfg, "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-ok",
    tree: MAIN_TREE,
  });
  assert.equal(ok.refused, false, "a valid tree key still runs");
});

// --- F6: an OVER-AGE marker is broken even when its (recycled) pid is alive -----

test("[6.1-marker-overage] an over-age verify marker is broken even if its pid is live (recycled-pid wedge)", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const stateHome = freshStateHome();
  const journal = makeJournal(runDir);

  // A marker whose pid is ALIVE (this process) but whose startMs is far in the past:
  // a crashed run whose pid was recycled by an unrelated live process. Checking only
  // pidAlive would refuse forever; the over-age break (mirroring state.ts staleLockMs)
  // must reclaim it.
  const OLD = Date.now() - 25 * 60 * 60 * 1000; // 25h old (> the 24h default)
  writeFileSync(
    path.join(runDir, "verify-running-main.json"),
    JSON.stringify({ pid: process.pid, startMs: OLD }),
  );

  const outcome = runVerify(runDir, "I1", verifyConfig([process.execPath, "-e", "process.exit(0)"]), "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-overage",
    tree: MAIN_TREE,
  });

  assert.equal(outcome.refused, false, "an over-age marker is BROKEN and the verify proceeds (F6)");
  if (!outcome.refused) {
    assert.ok(outcome.staleMarkerBroken !== undefined, "breaking the over-age marker surfaces an anomaly");
    assert.equal(outcome.staleMarkerBroken?.pid, process.pid, "the anomaly names the (live but recycled) pid");
    assert.equal(outcome.staleMarkerBroken?.startMs, OLD, "the anomaly carries the stale startMs");
  }
  assert.equal(readEvidence(runDir).length, 1, "after breaking the over-age marker the verify ran and appended a record");

  // The injectable threshold works too: a small staleMarkerMs breaks a young marker.
  {
    const runDir2 = freshRunDir();
    const journal2 = makeJournal(runDir2);
    writeFileSync(
      path.join(runDir2, "verify-running-main.json"),
      JSON.stringify({ pid: process.pid, startMs: Date.now() - 5000 }),
    );
    const out2 = runVerify(runDir2, "I1", verifyConfig([process.execPath, "-e", "process.exit(0)"]), "src/x.ts", {
      cwd: repo,
      journal: journal2,
      stateHome,
      workspaceKey: "wkey",
      runId: "r-overage2",
      tree: MAIN_TREE,
      staleMarkerMs: 1000,
    });
    assert.equal(out2.refused, false, "opts.staleMarkerMs makes the over-age threshold injectable (F6)");
  }
});

// --- F7: childEnv scrubs the git environment so a child git read is hermetic ----

test("[6.1-childenv-git] childEnv strips GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR and sets GIT_OPTIONAL_LOCKS=0", () => {
  const base: NodeJS.ProcessEnv = {
    GIT_DIR: "/somewhere/.git",
    GIT_WORK_TREE: "/somewhere",
    GIT_INDEX_FILE: "/somewhere/.git/index",
    GIT_COMMON_DIR: "/somewhere/.git",
    NODE_TEST_CONTEXT: "child",
    PATH: "/usr/bin",
  };
  const env = childEnv(base);
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "NODE_TEST_CONTEXT"]) {
    assert.equal(env[key], undefined, `childEnv must unset ${key} (git/test hygiene parity with gitio)`);
  }
  assert.equal(env.GIT_OPTIONAL_LOCKS, "0", "childEnv sets GIT_OPTIONAL_LOCKS=0 so a child git read never writes a lock");
  assert.equal(env.PATH, "/usr/bin", "unrelated env is preserved");
});

// --- F8: the timeout kill uses SIGKILL, so a SIGTERM-trapping child cannot fake green

test("[6.1-timeout-sigkill] a scope that TRAPS SIGTERM and exits 0 is still killed (SIGKILL) and read as red", () => {
  const runDir = freshRunDir();
  const repo = committedRepo();
  const stateHome = freshStateHome();
  const journal = makeJournal(runDir);

  // The child installs a SIGTERM handler that exits 0 (a trappable-signal escape), then
  // hangs. With a trappable SIGTERM kill it would catch the signal, exit 0, and be read
  // GREEN — a false pass. The timeout kill MUST be SIGKILL (uncatchable) so the hang is
  // terminated and the scope is red.
  const script =
    `process.on('SIGTERM', () => { process.exit(0); });` +
    `setInterval(() => {}, 1000);`;
  const cfg = verifyConfig([process.execPath, "-e", script], { timeoutMs: 300 });

  const outcome = runVerify(runDir, "I1", cfg, "src/x.ts", {
    cwd: repo,
    journal,
    stateHome,
    workspaceKey: "wkey",
    runId: "r-sigkill",
    tree: MAIN_TREE,
  });

  const scopes = verifyScopes(outcome);
  assert.equal(
    scopes.unit.green,
    false,
    "a SIGTERM-trapping hang is KILLED with SIGKILL and read as red — it cannot trap its way to a false green (F8)",
  );
});
