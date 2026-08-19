// conductor/tools/audit-mutation-suite.ts — GAP-018 / MACRO-019: a STANDING
// mutation suite over the AUDIT layer, as a SEPARATE on-demand tool.
//
// WHY THIS EXISTS. Mutation testing was the build's most productive instrument —
// it found or confirmed defects in fifteen-plus corrections — but it was adopted
// ad hoc and never institutionalized, and the one layer it never systematically
// reached is the audit/gate layer, which is exactly where the surviving mutations
// concentrated (MACRO-019). A gate check that no mutation ever challenged is
// indistinguishable from a decorative one: it ships green because a test proves
// the happy path, never because anything proved the check can FAIL. This tool
// closes that by applying a corpus of known mutations to the audit layer and
// asserting each is CAUGHT — a mutation that SURVIVES names a decorative check.
//
// WHAT IT IS NOT. It is NOT a gate leg. scripts/test-conductor.sh is the canonical
// gate and is off-limits; wiring a per-mutation source-rewrite loop into every
// gate run would make the gate mutate the tree it is meant to read. This tool is
// run ON DEMAND (its CLI leg below), while conductor/tests/audit-mutation-suite.test.ts
// keeps the RUNNER honest inside the ordinary suite: it proves, against fixtures
// with an injected test-runner, that the runner tells CAUGHT from SURVIVES (so it
// cannot silently pass), and that every corpus find-string still resolves to
// exactly one site in its target file — a rotted mutation (ISSUE-090: a recorded
// proof whose target moved) is caught at gate time, not the next time someone runs
// this by hand.
//
// THE DURABLE FORM (IDEA-STRUCT-7). Each mutation is a machine-applicable patch —
// a file, a unique find-string, its replacement — plus the test glob that must go
// red and the expected outcome. Nothing here narrates a past proof; the patch IS
// the proof, re-runnable and self-checking.
//
//   node conductor/tools/audit-mutation-suite.ts [--only ID[,ID...]]
//
// It edits real source files transiently and ALWAYS restores them (a per-mutation
// finally); it writes nothing outside the files it mutates-and-restores, starts no
// server and opens no socket. A nonzero exit means at least one mutation's outcome
// did not match its expectation — a decorative check, a miscalibrated runner, or a
// rotted patch.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Whether the test glob went red (nonzero) or green under the gate. "error" is a
// third outcome the runner itself produces when it cannot even apply the patch.
export type MutationVerdict = "caught" | "survives" | "error";

// A machine-applicable mutation over one audit-layer file.
//   expect "caught"   — the audit under test MUST turn this red; a green is a
//                       decorative check.
//   expect "survives" — a NEGATIVE control: a change no test on `test` covers, so
//                       a green here proves the runner can report a survivor at all
//                       (it is not rubber-stamping every mutation as caught).
export interface Mutation {
  id: string;
  file: string; // repo-relative
  find: string; // must occur EXACTLY once in the file
  replace: string;
  test: string; // glob handed to scripts/test-conductor.sh
  expect: "caught" | "survives";
  why: string;
}

export interface MutationOutcome {
  id: string;
  file: string;
  test: string;
  expected: "caught" | "survives";
  actual: MutationVerdict;
  ok: boolean; // actual === expected
  applied: boolean;
  error: string | null;
}

// A test driver: given a glob, say whether it went red. Injected so the runner is
// unit-testable without spawning the real gate.
export type TestRunner = (glob: string) => { red: boolean };

// File read/write, injected so the runner is unit-testable over an in-memory tree.
export interface FileIO {
  read(abs: string): string;
  write(abs: string, text: string): void;
}

export const REAL_IO: FileIO = {
  read: (abs) => readFileSync(abs, "utf8"),
  write: (abs, text) => writeFileSync(abs, text),
};

// Non-overlapping occurrences of `needle` in `haystack`. A unique site is what
// makes a patch deterministic: zero means the mutation rotted, two-plus means it
// is ambiguous and could hit the wrong line.
export function occurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Apply ONE mutation, run its test through the injected runner, and ALWAYS restore
// the file — the restore is in a finally so a throwing runner cannot leave the tree
// mutated. The find-string must resolve to exactly one site or the mutation is not
// applied at all (reported as an error, never a silent skip).
export function runOneMutation(
  repoRoot: string,
  m: Mutation,
  runTest: TestRunner,
  io: FileIO,
): MutationOutcome {
  const base: Omit<MutationOutcome, "actual" | "ok" | "applied" | "error"> = {
    id: m.id,
    file: m.file,
    test: m.test,
    expected: m.expect,
  };
  const abs = path.join(repoRoot, m.file);

  let original: string;
  try {
    original = io.read(abs);
  } catch (error) {
    return { ...base, actual: "error", ok: false, applied: false, error: `cannot read ${m.file}: ${messageOf(error)}` };
  }

  const count = occurrences(original, m.find);
  if (count !== 1) {
    return {
      ...base,
      actual: "error",
      ok: false,
      applied: false,
      error: `find-string occurs ${String(count)}× in ${m.file}, expected exactly 1 — the mutation rotted or is ambiguous (ISSUE-090)`,
    };
  }

  const mutated = original.replace(m.find, m.replace);
  if (mutated === original) {
    return { ...base, actual: "error", ok: false, applied: false, error: `replacement is a no-op in ${m.file}` };
  }

  io.write(abs, mutated);
  let actual: MutationVerdict = "error";
  let threw: string | null = null;
  try {
    actual = runTest(m.test).red ? "caught" : "survives";
  } catch (error) {
    threw = messageOf(error);
  } finally {
    // ALWAYS restore, exactly once, whether the runner returned or threw.
    io.write(abs, original);
  }

  if (threw !== null) {
    return { ...base, actual: "error", ok: false, applied: true, error: `test runner threw: ${threw}` };
  }
  return { ...base, actual, ok: actual === m.expect, applied: true, error: null };
}

// Run a whole corpus, one mutation at a time (never in parallel: two mutations in
// flight would edit the tree from under each other).
export function runCorpus(
  repoRoot: string,
  corpus: readonly Mutation[],
  runTest: TestRunner,
  io: FileIO,
): MutationOutcome[] {
  return corpus.map((m) => runOneMutation(repoRoot, m, runTest, io));
}

// Static well-formedness, no test run: every find-string resolves to exactly one
// site right now. This is the anti-rot check the ordinary suite runs — a patch
// whose target moved is a red in the gate, not a surprise the next hand-run finds.
export function checkCorpusWellFormed(
  repoRoot: string,
  corpus: readonly Mutation[],
  io: FileIO,
): { id: string; file: string; count: number; ok: boolean }[] {
  return corpus.map((m) => {
    let count = -1;
    try {
      count = occurrences(io.read(path.join(repoRoot, m.file)), m.find);
    } catch {
      count = -1;
    }
    return { id: m.id, file: m.file, count, ok: count === 1 };
  });
}

// The seed corpus. Each positive entry is a mutation drawn from the review record
// of a named audit; each must turn its audit red. The one negative control is a
// change no test on its glob covers, present so a run that reports it as a survivor
// proves the runner distinguishes — a runner that called everything "caught" would
// fail the negative control and fail the whole run.
export const CORPUS: readonly Mutation[] = [
  {
    id: "vocab-stopkinds-drift",
    file: "conductor/core/vocab-registry.ts",
    find: `["done", "noop", "blocked", "surfaced", "env", "interrupt"]`,
    replace: `["done", "noop", "blocked", "surfaced", "env", "interrupted"]`,
    test: "conductor/tests/vocab-registry.test.ts",
    expect: "caught",
    why: "drifts the stopKinds PIN off the STOP_KINDS site (ISSUE-113 / C-082) — the parity guard must catch the cross-language mismatch",
  },
  {
    id: "journal-vocab-drop-event",
    file: "conductor/core/journal-events.ts",
    find: `    "run.stop-report",\n`,
    replace: ``,
    test: "conductor/tests/journal-vocab.test.ts",
    expect: "caught",
    why: "removes a live event name from the closed vocabulary — the source-audit / live-drive must catch handleReport's stop-report emitting a name journal-events no longer lists",
  },
  {
    id: "g5-artifact-byte-identical",
    file: "conductor/tools/g5-artifact-check.ts",
    find: `    if (armWith === armWithout) {`,
    replace: `    if (false) {`,
    test: "conductor/tests/g5-artifact.test.ts",
    expect: "caught",
    why: "defeats the byte-identical-arms check — two identical commands must still be rejected as one command run twice (the original G5 tautology)",
  },
  {
    id: "legaltools-drop-publishenabled",
    file: "conductor/core/mechanics.ts",
    find: `legalTools(run, items, [], DESCRIBES_CONFIGURED_REPO, DESCRIBES_FULL_PIPELINE)`,
    replace: `legalTools(run, items, [], DESCRIBES_CONFIGURED_REPO)`,
    test: "conductor/tests/legaltools-callsites.test.ts",
    expect: "caught",
    why: "drops the explicit publishEnabled at a production call site (C-048) — the source audit must catch a call site inheriting the optional default",
  },
  {
    id: "replay-restate-event-literal",
    file: "conductor/tools/replay.ts",
    find: `const EV_DISPATCHED = FANOUT_DISPATCHED;`,
    replace: `const EV_DISPATCHED = "subsession.dispatched";`,
    test: "conductor/tests/replay.test.ts",
    expect: "caught",
    why: "restates a replay event name as a private literal (GAP-034 / ISSUE-131) — the reuse guard must catch the copy that would silently blank a timeline on a core rename",
  },
  {
    id: "report-drop-router-witness",
    file: "conductor/adapter/tools.ts",
    find: `  return "## Metrics\\n\\n" + witness + "\\n\\n" + body + "\\n";`,
    replace: `  return "## Metrics\\n\\n" + body + "\\n";`,
    test: "conductor/tests/tools-9.5b.test.ts",
    expect: "caught",
    why: "removes the GAP-029 router-contact witness from the report — the report tests must catch a run whose metrics section can no longer say whether the router was contacted",
  },
  {
    id: "negative-control-comment-only",
    file: "conductor/core/vocab-registry.ts",
    find: `the flagship cross-language case`,
    replace: `the primary cross-language case`,
    test: "conductor/tests/vocab-registry.test.ts",
    expect: "survives",
    why: "NEGATIVE CONTROL: a comment-only edit no test asserts on — a run that reports this as a survivor proves the runner is not rubber-stamping every mutation as caught",
  },
] as const;

// The real gate driver: run scripts/test-conductor.sh over one glob and read its
// exit code. Red is any nonzero exit (a failing/vacuous/typecheck-broken leg).
function gateRunner(repoRoot: string): TestRunner {
  return (glob) => {
    const result = spawnSync("bash", ["scripts/test-conductor.sh", glob], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return { red: result.status !== 0 };
  };
}

function formatOutcome(o: MutationOutcome): string {
  const verdict = o.ok ? "OK  " : "FAIL";
  const tail = o.error === null ? "" : ` — ${o.error}`;
  return `[${verdict}] ${o.id}: expected ${o.expected}, got ${o.actual}${tail}`;
}

function repoRootFromHere(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

// The on-demand entry. Kept behind an argv[1] suffix guard (not import.meta.main,
// which Node type-stripping does not provide) so importing this module for the
// runner functions fires nothing.
export function main(argv: readonly string[]): number {
  const repoRoot = repoRootFromHere();
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? "").split(",").filter((s) => s.length > 0) : null;
  const corpus = only === null ? CORPUS : CORPUS.filter((m) => only.includes(m.id));

  if (corpus.length === 0) {
    process.stderr.write("audit-mutation-suite: no mutations selected\n");
    return 1;
  }

  process.stdout.write(`audit-mutation-suite: ${String(corpus.length)} mutation(s), each restores its file after one gate run\n`);
  const outcomes = runCorpus(repoRoot, corpus, gateRunner(repoRoot), REAL_IO);
  for (const o of outcomes) process.stdout.write(formatOutcome(o) + "\n");

  const survivors = outcomes.filter((o) => o.expected === "caught" && o.actual === "survives");
  const errors = outcomes.filter((o) => o.actual === "error");
  const miscalibrated = outcomes.filter((o) => o.expected === "survives" && o.actual !== "survives");
  const bad = outcomes.filter((o) => !o.ok);

  if (survivors.length > 0) {
    process.stdout.write(`\nSURVIVORS (decorative checks): ${survivors.map((o) => o.id).join(", ")}\n`);
  }
  if (miscalibrated.length > 0) {
    process.stdout.write(`\nNEGATIVE CONTROL CAUGHT (runner miscalibrated): ${miscalibrated.map((o) => o.id).join(", ")}\n`);
  }
  if (errors.length > 0) {
    process.stdout.write(`\nROTTED/AMBIGUOUS PATCHES: ${errors.map((o) => o.id).join(", ")}\n`);
  }

  process.stdout.write(`\n${bad.length === 0 ? "MUTATION SUITE PASS" : "MUTATION SUITE FAIL"}: ${String(outcomes.length - bad.length)}/${String(outcomes.length)} as expected\n`);
  return bad.length === 0 ? 0 : 1;
}

// argv[1] is the script path under direct `node …/audit-mutation-suite.ts`
// invocation; it is some other entry when this module is merely imported.
const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("audit-mutation-suite.ts");
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
