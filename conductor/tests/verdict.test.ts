// Task 1.3 red tests — lives at conductor/tests/verdict.test.ts.
// Subject: conductor/core/verdict.ts (must not exist when this goes red; the
// failure is Cannot find module '../core/verdict.ts' — the missing-subject
// shape, a legal red per §2.6.1).
//
// Spec: plan Task 1.3 (lines 2115-2116): findingSurvives(verdicts[], k) ->
// boolean — a finding survives iff upholds >= ceil(k/2); a TIE UPHOLDS (a
// finding two skeptics split on is worth a fix round; §2.1 skepticsPerFinding,
// line 565). Verdict shape is §2.10's skeptic VERDICT
// ({findingId, upheld, reasoning}, lines 930-932).
// Assertion: 1.3-verdict.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findingSurvives } from "../core/verdict.ts";

/** Minimal §2.10 VERDICT fixture — what every skeptic session returns. */
interface VerdictFixture {
  findingId: string;
  upheld: boolean;
  reasoning: string;
}

const verdict = (upheld: boolean, i: number): VerdictFixture => ({
  findingId: "F1",
  upheld,
  reasoning: upheld
    ? `skeptic ${i}: the claim holds; the guard on line 42 does not cover this case`
    : `skeptic ${i}: the claim mis-reads the guard on line 42; the case is handled`,
});

const verdicts = (...upholds: boolean[]): VerdictFixture[] => upholds.map((u, i) => verdict(u, i));

interface SurvivalRow {
  name: string;
  upholds: boolean[];
  k: number;
  survives: boolean;
}

const rows: SurvivalRow[] = [
  // k=2 (the default skepticsPerFinding): threshold ceil(2/2) = 1.
  { name: "k=2: 0 upholds (overturn, overturn) => finding DIES", upholds: [false, false], k: 2, survives: false },
  { name: "k=2: 1 uphold (uphold, overturn) is a TIE => finding SURVIVES (a split finding earns a fix round)", upholds: [true, false], k: 2, survives: true },
  { name: "k=2: 1 uphold in the other order (overturn, uphold) => still survives (order-independent)", upholds: [false, true], k: 2, survives: true },
  { name: "k=2: 2 upholds => survives", upholds: [true, true], k: 2, survives: true },
  // k=3: threshold ceil(3/2) = 2 — a strict majority.
  { name: "k=3: 2 of 3 upholds (majority) => survives", upholds: [true, false, true], k: 3, survives: true },
  { name: "k=3: 1 of 3 upholds (minority, threshold is ceil(3/2)=2) => dies", upholds: [false, true, false], k: 3, survives: false },
  { name: "k=3: unanimous upholds => survives", upholds: [true, true, true], k: 3, survives: true },
  { name: "k=3: unanimous overturns => dies", upholds: [false, false, false], k: 3, survives: false },
  // Formula boundaries beyond the two configured shapes.
  { name: "k=1: the single skeptic upholding => survives (ceil(1/2)=1)", upholds: [true], k: 1, survives: true },
  { name: "k=1: the single skeptic overturning => dies", upholds: [false], k: 1, survives: false },
  { name: "k=4: an even split (2 of 4) is a tie => survives (ceil(4/2)=2)", upholds: [true, false, true, false], k: 4, survives: true },
  { name: "k=4: 1 of 4 upholds => dies", upholds: [false, false, true, false], k: 4, survives: false },
];

for (const row of rows) {
  test(`[1.3-verdict] ${row.name}`, () => {
    assert.equal(
      findingSurvives(verdicts(...row.upholds), row.k),
      row.survives,
      `findingSurvives for: ${row.name}`,
    );
  });
}
