// Task 3.1 — Run FSM (`core/fsm-run.ts`).
// Normative sources hardcoded here: plan §3.1 (run states + legal transitions,
// lines 1029-1063), §2.3 (run states + terminality, 671-712), and the Task 3.1
// enumerated matrix (2208-2233). Every legal pair is asserted legal; every illegal
// pair is asserted rejected with a `why` that names a legal successor of `from`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { RUN_STATES, legalRunTransition } from "../core/fsm-run.ts";

// The evidence/context a run transition claims (§3.1). Kept structural/minimal on
// purpose: a param type demanding a full §2.3 run.json would reject these fixtures.
type RunContext = {
  classification?: "work" | "trivial" | "question";
  survivingMajors?: number;
  round?: number;
  max?: number;
};

// §3.1 / §2.3 vocabulary — exactly these eight, nothing else.
const EXPECTED_RUN_STATES = [
  "INTAKE",
  "DECOMPOSED",
  "PLANNED",
  "PLAN_REVIEWED",
  "EXECUTING",
  "REPORTED",
  "TRIVIAL_DONE",
  "ANSWERED",
] as const;
type RunState = (typeof EXPECTED_RUN_STATES)[number];

// The legal successor set drawn by §3.1's diagram (forward-only; the majors⇒revise⇒
// re-review loop is internal to the handler and never regresses run state).
const RUN_SUCCESSORS: Record<RunState, RunState[]> = {
  INTAKE: ["DECOMPOSED", "ANSWERED", "EXECUTING"],
  DECOMPOSED: ["PLANNED"],
  PLANNED: ["PLAN_REVIEWED"],
  PLAN_REVIEWED: ["EXECUTING"],
  EXECUTING: ["REPORTED", "TRIVIAL_DONE"],
  REPORTED: [],
  TRIVIAL_DONE: [],
  ANSWERED: [],
};

// Context that SATISFIES each legal pair's requirement.
const RUN_LEGAL_CONTEXT: Record<string, RunContext> = {
  "INTAKE->DECOMPOSED": { classification: "work" },
  "INTAKE->ANSWERED": { classification: "question" },
  "INTAKE->EXECUTING": { classification: "trivial" },
  "DECOMPOSED->PLANNED": {},
  "PLANNED->PLAN_REVIEWED": { survivingMajors: 0 },
  "PLAN_REVIEWED->EXECUTING": { survivingMajors: 0 },
  "EXECUTING->REPORTED": { classification: "work" },
  "EXECUTING->TRIVIAL_DONE": { classification: "trivial" },
};

// A permissive context for illegal-pair probes: whatever gate an in-table pair might
// require is already satisfied here, so a rejection can only be the pair not existing.
const PERMISSIVE: RunContext = {
  classification: "work",
  survivingMajors: 0,
  round: 99,
  max: 0,
};

// ── 3.1-vocab ──────────────────────────────────────────────────────────────────
test("3.1-vocab: RUN_STATES is exactly the §3.1 vocabulary (8 states, no extras)", () => {
  assert.deepEqual(
    [...RUN_STATES].sort(),
    [...EXPECTED_RUN_STATES].sort(),
  );
});

// ── 3.1-matrix ─────────────────────────────────────────────────────────────────
// Full run transition matrix: every (from,to) pair. Legal pairs pass with satisfying
// context; illegal pairs are rejected and their `why` names a legal successor.
for (const from of EXPECTED_RUN_STATES) {
  for (const to of EXPECTED_RUN_STATES) {
    const key = `${from}->${to}`;
    const successors = RUN_SUCCESSORS[from];
    if (successors.includes(to)) {
      test(`3.1-matrix: run ${key} is LEGAL under satisfying context`, () => {
        const res = legalRunTransition(from, to, RUN_LEGAL_CONTEXT[key] ?? {});
        assert.equal(res.ok, true, `expected ${key} legal; why=${res.why}`);
      });
    } else {
      test(`3.1-matrix: run ${key} is ILLEGAL (why names a legal successor)`, () => {
        const res = legalRunTransition(from, to, PERMISSIVE);
        assert.equal(res.ok, false, `expected ${key} illegal`);
        assert.ok(
          typeof res.why === "string" && res.why.length > 0,
          `illegal ${key} must carry a non-empty why`,
        );
        if (successors.length > 0) {
          assert.ok(
            successors.some((s) => (res.why ?? "").includes(s)),
            `why for ${key} must name a legal successor of ${from} (${successors.join("|")}); got: ${res.why}`,
          );
        }
      });
    }
  }
}

// ── 3.1-decomposed ─────────────────────────────────────────────────────────────
test("3.1-decomposed: INTAKE->DECOMPOSED with classification work => legal", () => {
  const res = legalRunTransition("INTAKE", "DECOMPOSED", { classification: "work" });
  assert.equal(res.ok, true, `why=${res.why}`);
});
test("3.1-decomposed: INTAKE->DECOMPOSED with classification trivial => rejected", () => {
  const res = legalRunTransition("INTAKE", "DECOMPOSED", { classification: "trivial" });
  assert.equal(res.ok, false);
  assert.ok((res.why ?? "").length > 0, "rejection must explain the classification requirement");
});
test("3.1-decomposed: INTAKE->DECOMPOSED with classification question => rejected", () => {
  const res = legalRunTransition("INTAKE", "DECOMPOSED", { classification: "question" });
  assert.equal(res.ok, false);
  assert.ok((res.why ?? "").length > 0);
});

// ── 3.1-trivial ────────────────────────────────────────────────────────────────
test("3.1-trivial: INTAKE->EXECUTING with classification trivial => legal", () => {
  const res = legalRunTransition("INTAKE", "EXECUTING", { classification: "trivial" });
  assert.equal(res.ok, true, `why=${res.why}`);
});
test("3.1-trivial: INTAKE->EXECUTING with classification work => rejected (names DECOMPOSED)", () => {
  const res = legalRunTransition("INTAKE", "EXECUTING", { classification: "work" });
  assert.equal(res.ok, false);
  assert.ok((res.why ?? "").includes("DECOMPOSED"), `why should route work runs to DECOMPOSED; got: ${res.why}`);
});
test("3.1-trivial: EXECUTING->TRIVIAL_DONE for a trivial run => legal", () => {
  const res = legalRunTransition("EXECUTING", "TRIVIAL_DONE", { classification: "trivial" });
  assert.equal(res.ok, true, `why=${res.why}`);
});
test("3.1-trivial: EXECUTING->TRIVIAL_DONE for a work run => rejected", () => {
  const res = legalRunTransition("EXECUTING", "TRIVIAL_DONE", { classification: "work" });
  assert.equal(res.ok, false, "TRIVIAL_DONE is trivial-only");
  assert.ok((res.why ?? "").length > 0);
});
test("3.1-trivial: EXECUTING->REPORTED for a trivial run => rejected", () => {
  const res = legalRunTransition("EXECUTING", "REPORTED", { classification: "trivial" });
  assert.equal(res.ok, false, "REPORTED is work-only; trivial runs report-lite to TRIVIAL_DONE");
  assert.ok((res.why ?? "").length > 0);
});
test("3.1-trivial: EXECUTING->REPORTED for a work run => legal", () => {
  const res = legalRunTransition("EXECUTING", "REPORTED", { classification: "work" });
  assert.equal(res.ok, true, `why=${res.why}`);
});

// ── 3.1-plan-reviewed ──────────────────────────────────────────────────────────
// PLANNED->PLAN_REVIEWED and PLAN_REVIEWED->EXECUTING share one context rule:
// {survivingMajors:0} OR {round >= max}.
for (const [from, to] of [
  ["PLANNED", "PLAN_REVIEWED"],
  ["PLAN_REVIEWED", "EXECUTING"],
] as const) {
  test(`3.1-plan-reviewed: ${from}->${to} with survivingMajors 0 => legal`, () => {
    const res = legalRunTransition(from, to, { survivingMajors: 0 });
    assert.equal(res.ok, true, `why=${res.why}`);
  });
  test(`3.1-plan-reviewed: ${from}->${to} with round >= max => legal`, () => {
    const res = legalRunTransition(from, to, { round: 3, max: 3 });
    assert.equal(res.ok, true, `why=${res.why}`);
  });
  test(`3.1-plan-reviewed: ${from}->${to} with surviving majors and round < max => rejected`, () => {
    const res = legalRunTransition(from, to, { survivingMajors: 2, round: 1, max: 3 });
    assert.equal(res.ok, false, "needs a clean round or the round cap");
    assert.ok((res.why ?? "").length > 0);
  });
}
