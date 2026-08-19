// conductor/tests/audit-mutation-suite.test.ts — GAP-018 / MACRO-019: the guard
// that keeps the standing mutation suite's RUNNER honest inside the ordinary gate.
//
// The heavy work — applying the corpus to the real audit layer and proving each
// mutation is caught — is the on-demand tool conductor/tools/audit-mutation-suite.ts,
// NOT a gate leg (it rewrites source files, which the gate must never do). What
// runs HERE is cheap and load-bearing in a different way:
//
//   1. Every corpus find-string still resolves to EXACTLY ONE site in its target
//      file. A patch whose target moved (ISSUE-090: a recorded proof that rotted)
//      becomes a red in this suite, the day it rots — not a surprise the next
//      hand-run discovers.
//   2. The runner distinguishes CAUGHT from SURVIVES and computes `ok` against the
//      declared expectation, proven against fixtures with an injected test-runner
//      and an in-memory tree. A runner that called everything "caught" — the way a
//      decorative check ships green — is itself caught here.
//   3. The runner ALWAYS restores the file it mutates, even when the injected
//      runner throws.
//   4. The corpus actually spans the named audit layers and carries a negative
//      control, so it cannot quietly shrink to one trivial entry.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORPUS,
  REAL_IO,
  occurrences,
  runOneMutation,
  runCorpus,
  checkCorpusWellFormed,
} from "../tools/audit-mutation-suite.ts";
import type { FileIO, Mutation, TestRunner } from "../tools/audit-mutation-suite.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// An in-memory FileIO over a single tracked path, so a fixture mutation never
// touches disk.
function memIO(seed: Record<string, string>): FileIO & { snapshot(): Record<string, string> } {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    read(abs) {
      const v = store.get(abs);
      if (v === undefined) throw new Error(`no such file: ${abs}`);
      return v;
    },
    write(abs, text) {
      store.set(abs, text);
    },
    snapshot() {
      return Object.fromEntries(store.entries());
    },
  };
}

test("[gap018-corpus-well-formed] every corpus find-string resolves to EXACTLY ONE site in its target file (a rotted patch is a red here, not a surprise on the next hand-run)", () => {
  const report = checkCorpusWellFormed(REPO_ROOT, CORPUS, REAL_IO);
  const rotted = report.filter((r) => !r.ok);
  assert.deepEqual(
    rotted.map((r) => `${r.id}: ${r.file} matched ${String(r.count)}× (want exactly 1)`),
    [],
    "a mutation whose find-string no longer resolves to one unique site can never be applied — ISSUE-090's rotted-proof failure mode",
  );
  assert.ok(report.length >= 6, "the corpus must not silently shrink below its seeded breadth");
});

test("[gap018-corpus-spans-audits] the corpus covers the named audit layers and carries a negative control", () => {
  const globs = new Set(CORPUS.map((m) => m.test));
  for (const named of [
    "conductor/tests/vocab-registry.test.ts",
    "conductor/tests/journal-vocab.test.ts",
    "conductor/tests/g5-artifact.test.ts",
    "conductor/tests/legaltools-callsites.test.ts",
    "conductor/tests/replay.test.ts",
    "conductor/tests/tools-9.5b.test.ts",
  ]) {
    assert.ok(globs.has(named), `the corpus must exercise ${named}`);
  }
  const positives = CORPUS.filter((m) => m.expect === "caught");
  const negatives = CORPUS.filter((m) => m.expect === "survives");
  assert.ok(positives.length >= 5, "the corpus needs a representative set of caught-expecting mutations");
  assert.equal(negatives.length >= 1, true, "the corpus needs at least one negative control so a survivor can be observed at all");
});

test("[gap018-runner-distinguishes] runOneMutation reports CAUGHT when the test goes red and SURVIVES when it stays green, and restores the file either way", () => {
  const abs = path.join(REPO_ROOT, "conductor/tools/audit-mutation-suite.ts");
  const original = "const marker = ORIGINAL;\n";

  const caughtMut: Mutation = {
    id: "fx-caught",
    file: "conductor/tools/audit-mutation-suite.ts",
    find: "ORIGINAL",
    replace: "MUTATED",
    test: "fixture:caught",
    expect: "caught",
    why: "fixture",
  };
  const survivesMut: Mutation = { ...caughtMut, id: "fx-survives", test: "fixture:survives", expect: "survives" };

  // The fake gate: red only for the "caught" fixture glob.
  const runner: TestRunner = (glob) => ({ red: glob === "fixture:caught" });

  const ioA = memIO({ [abs]: original });
  const caught = runOneMutation(REPO_ROOT, caughtMut, runner, ioA);
  assert.equal(caught.actual, "caught", "a red test means the mutation was caught");
  assert.equal(caught.ok, true, "expected caught, got caught");
  assert.equal(ioA.snapshot()[abs], original, "the file is restored after the run");

  const ioB = memIO({ [abs]: original });
  const survived = runOneMutation(REPO_ROOT, survivesMut, runner, ioB);
  assert.equal(survived.actual, "survives", "a green test means the mutation survived");
  assert.equal(survived.ok, true, "expected survives, got survives");
  assert.equal(ioB.snapshot()[abs], original, "the file is restored after the run");
});

test("[gap018-runner-cannot-silently-pass] a decorative check (a caught-expecting mutation that SURVIVES) and a miscalibrated negative control (a survives-expecting mutation that is CAUGHT) both come back ok:false", () => {
  const abs = path.join(REPO_ROOT, "conductor/core/journal-events.ts");
  const original = "X\n";

  // A positive mutation whose test stays GREEN — the decorative-check signature.
  const decorative: Mutation = {
    id: "fx-decorative",
    file: "conductor/core/journal-events.ts",
    find: "X",
    replace: "Y",
    test: "always-green",
    expect: "caught",
    why: "fixture",
  };
  // A negative control whose test goes RED — the runner is miscalibrated.
  const miscalibrated: Mutation = { ...decorative, id: "fx-miscal", test: "always-red", expect: "survives" };

  const greenRunner: TestRunner = () => ({ red: false });
  const redRunner: TestRunner = () => ({ red: true });

  const d = runOneMutation(REPO_ROOT, decorative, greenRunner, memIO({ [abs]: original }));
  assert.equal(d.actual, "survives", "the decorative check let the mutation survive");
  assert.equal(d.ok, false, "and the runner FLAGS it (ok:false) rather than silently passing — this is the survivor detection the self-test proves");

  const m = runOneMutation(REPO_ROOT, miscalibrated, redRunner, memIO({ [abs]: original }));
  assert.equal(m.actual, "caught", "the negative control unexpectedly went red");
  assert.equal(m.ok, false, "and the runner FLAGS the miscalibration rather than reporting a clean pass");
});

test("[gap018-runner-restores-on-throw] a runner that throws still leaves the file restored, and the outcome is an error", () => {
  const abs = path.join(REPO_ROOT, "conductor/tools/replay.ts");
  const original = "keep-me\n";
  const mut: Mutation = {
    id: "fx-throw",
    file: "conductor/tools/replay.ts",
    find: "keep-me",
    replace: "clobbered",
    test: "boom",
    expect: "caught",
    why: "fixture",
  };
  const io = memIO({ [abs]: original });
  const boom: TestRunner = () => {
    throw new Error("gate crashed");
  };
  const outcome = runOneMutation(REPO_ROOT, mut, boom, io);
  assert.equal(io.snapshot()[abs], original, "the file is restored even when the runner throws");
  assert.equal(outcome.actual, "error", "a throwing runner yields an error outcome, never a false green");
  assert.equal(outcome.ok, false, "and never counts as ok");
});

test("[gap018-runner-rejects-ambiguous-patch] a find-string that matches zero or many sites is reported as an unapplied error, never a silent skip", () => {
  const abs = path.join(REPO_ROOT, "conductor/core/types.ts");
  const io = memIO({ [abs]: "AA between AA\n" });
  const runner: TestRunner = () => ({ red: true });

  const zero: Mutation = { id: "fx-zero", file: "conductor/core/types.ts", find: "ZZ", replace: "QQ", test: "t", expect: "caught", why: "fx" };
  const many: Mutation = { id: "fx-many", file: "conductor/core/types.ts", find: "AA", replace: "QQ", test: "t", expect: "caught", why: "fx" };

  const z = runOneMutation(REPO_ROOT, zero, runner, io);
  assert.equal(z.applied, false, "a zero-match find is not applied");
  assert.equal(z.ok, false);
  assert.match(z.error ?? "", /occurs 0/, "and says the patch resolved to no site");

  const m = runOneMutation(REPO_ROOT, many, runner, io);
  assert.equal(m.applied, false, "a multi-match find is not applied");
  assert.match(m.error ?? "", /occurs 2/, "and says the patch is ambiguous");
});

test("[gap018-occurrences] the site counter is exact and non-overlapping", () => {
  assert.equal(occurrences("abcabc", "abc"), 2);
  assert.equal(occurrences("aaaa", "aa"), 2, "non-overlapping");
  assert.equal(occurrences("abc", "x"), 0);
  assert.equal(occurrences("abc", ""), 0, "the empty needle is never a match");
});

test("[gap018-runcorpus-one-outcome-per-mutation] runCorpus returns one outcome per mutation in order", () => {
  const abs = path.join(REPO_ROOT, "conductor/tools/audit-mutation-suite.ts");
  const io = memIO({ [abs]: "M\n" });
  const runner: TestRunner = () => ({ red: true });
  const corpus: Mutation[] = [
    { id: "a", file: "conductor/tools/audit-mutation-suite.ts", find: "M", replace: "N", test: "t", expect: "caught", why: "fx" },
    { id: "b", file: "conductor/tools/audit-mutation-suite.ts", find: "M", replace: "O", test: "t", expect: "caught", why: "fx" },
  ];
  const outcomes = runCorpus(REPO_ROOT, corpus, runner, io);
  assert.deepEqual(outcomes.map((o) => o.id), ["a", "b"]);
  assert.equal(io.snapshot()[abs], "M\n", "the file survives the whole corpus run intact");
});
