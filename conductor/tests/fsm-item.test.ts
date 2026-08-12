// Task 3.1 — Item FSM (`core/fsm-item.ts`).
// Normative sources hardcoded here: plan §3.3 (item states + legal transitions +
// evidence gates, lines 1160-1302), §2.5 (item states vs. annotations, 758-796),
// §2.6.1 (failure-class vocabulary, 817-825), and the Task 3.1 enumerated matrix
// (2208-2233). `blocked`/`deferred`/`debugging` are ANNOTATIONS, not states, and a
// blocked item makes no transition at all — one rule orthogonal to the table.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ITEM_STATES, legalItemTransition } from "../core/fsm-item.ts";

// §2.6.1 closed vocabulary.
type FailureClass = "assertion" | "missing-subject" | "error";
// The `blocked` annotation (§2.5) — carries the question that must be answered.
type ItemBlocked = { questionId?: string; reason?: string; stage?: string };
// Minimal item facts the transition consults. Structural on purpose: a param type
// demanding a full §2.5 item.json would reject these fixtures.
type ItemFacts = { behavioral: boolean; blocked?: ItemBlocked | null };
// The evidence/context an item transition claims (§3.3).
type ItemContext = {
  item: ItemFacts;
  testExit?: number;
  failureClass?: FailureClass;
};

// §3.3 vocabulary — exactly these seven FSM positions.
const EXPECTED_ITEM_STATES = [
  "PENDING",
  "RED",
  "TEST_VETTED",
  "GREEN",
  "VALIDATED",
  "REVIEWED",
  "PUBLISHED",
] as const;
type ItemState = (typeof EXPECTED_ITEM_STATES)[number];

// §2.5 — annotations that must NEVER appear in ITEM_STATES.
const ANNOTATIONS_NOT_STATES = ["blocked", "deferred", "debugging"];

// The behavioral:true chain drawn by §3.3.
const BEHAVIORAL_SUCCESSORS: Record<ItemState, ItemState[]> = {
  PENDING: ["RED"],
  RED: ["TEST_VETTED"],
  TEST_VETTED: ["GREEN"],
  GREEN: ["VALIDATED"],
  VALIDATED: ["REVIEWED"],
  REVIEWED: ["PUBLISHED"],
  PUBLISHED: [],
};

// Context that SATISFIES each behavioral legal pair (evidence gates included).
const BEHAVIORAL_LEGAL_CONTEXT: Record<string, ItemContext> = {
  "PENDING->RED": { item: { behavioral: true }, testExit: 1, failureClass: "assertion" },
  "RED->TEST_VETTED": { item: { behavioral: true } },
  "TEST_VETTED->GREEN": { item: { behavioral: true }, testExit: 0 },
  "GREEN->VALIDATED": { item: { behavioral: true } },
  "VALIDATED->REVIEWED": { item: { behavioral: true } },
  "REVIEWED->PUBLISHED": { item: { behavioral: true } },
};

// Evidence that would make a given `from` transition legal absent any block — used to
// prove the `blocked` annotation overrides an OTHERWISE-legal transition.
function otherwiseLegalEvidence(from: ItemState): { testExit?: number; failureClass?: FailureClass } {
  if (from === "PENDING") return { testExit: 1, failureClass: "assertion" };
  if (from === "TEST_VETTED") return { testExit: 0 };
  return {};
}

// ── 3.1-vocab ──────────────────────────────────────────────────────────────────
test("3.1-vocab: ITEM_STATES is exactly the §3.3 vocabulary (7 states, no extras)", () => {
  assert.deepEqual(
    [...ITEM_STATES].sort(),
    [...EXPECTED_ITEM_STATES].sort(),
  );
});
test("3.1-vocab: blocked/deferred/debugging are ANNOTATIONS, not ITEM_STATES members", () => {
  for (const ann of ANNOTATIONS_NOT_STATES) {
    assert.ok(
      !(ITEM_STATES as readonly string[]).includes(ann),
      `${ann} is a §2.5 annotation and must NOT be an ITEM_STATES member`,
    );
  }
});

// ── 3.1-matrix ─────────────────────────────────────────────────────────────────
// Full behavioral:true item matrix. Legal pairs pass with satisfying context; illegal
// pairs are rejected and their `why` names a legal successor of `from`.
for (const from of EXPECTED_ITEM_STATES) {
  for (const to of EXPECTED_ITEM_STATES) {
    const key = `${from}->${to}`;
    const successors = BEHAVIORAL_SUCCESSORS[from];
    if (successors.includes(to)) {
      test(`3.1-matrix: item(behavioral) ${key} is LEGAL under satisfying context`, () => {
        const res = legalItemTransition(from, to, BEHAVIORAL_LEGAL_CONTEXT[key] ?? { item: { behavioral: true } });
        assert.equal(res.ok, true, `expected ${key} legal; why=${res.why}`);
      });
    } else {
      test(`3.1-matrix: item(behavioral) ${key} is ILLEGAL (why names a legal successor)`, () => {
        const res = legalItemTransition(from, to, { item: { behavioral: true }, testExit: 1, failureClass: "assertion" });
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

// ── 3.1-nonbehavioral ──────────────────────────────────────────────────────────
test("3.1-nonbehavioral: PENDING->GREEN legal iff behavioral===false (false => legal, no test owed)", () => {
  const res = legalItemTransition("PENDING", "GREEN", { item: { behavioral: false } });
  assert.equal(res.ok, true, `why=${res.why}`);
});
test("3.1-nonbehavioral: PENDING->GREEN rejected for a behavioral item (why names RED)", () => {
  const res = legalItemTransition("PENDING", "GREEN", { item: { behavioral: true } });
  assert.equal(res.ok, false, "a behavioral item owes a proven RED first");
  assert.ok((res.why ?? "").includes("RED"), `why should route to RED; got: ${res.why}`);
});
test("3.1-nonbehavioral: PENDING->RED rejected for a non-behavioral item (why names GREEN)", () => {
  const res = legalItemTransition("PENDING", "RED", { item: { behavioral: false }, testExit: 1, failureClass: "assertion" });
  assert.equal(res.ok, false, "no red is constructible for a non-behavioral item");
  assert.ok((res.why ?? "").includes("GREEN"), `why should route to GREEN; got: ${res.why}`);
});
// The non-behavioral forward tail is identical to the behavioral tail past GREEN.
for (const [from, to] of [
  ["GREEN", "VALIDATED"],
  ["VALIDATED", "REVIEWED"],
  ["REVIEWED", "PUBLISHED"],
] as const) {
  test(`3.1-nonbehavioral: ${from}->${to} for a non-behavioral item => legal`, () => {
    const res = legalItemTransition(from, to, { item: { behavioral: false } });
    assert.equal(res.ok, true, `why=${res.why}`);
  });
}

// ── 3.1-red-evidence ───────────────────────────────────────────────────────────
// PENDING->RED (behavioral) requires testExit != 0 AND failureClass ∈ {assertion, missing-subject}.
test("3.1-red-evidence: PENDING->RED with exit!=0 & failureClass assertion => legal", () => {
  const res = legalItemTransition("PENDING", "RED", { item: { behavioral: true }, testExit: 1, failureClass: "assertion" });
  assert.equal(res.ok, true, `why=${res.why}`);
});
test("3.1-red-evidence: PENDING->RED with exit!=0 & failureClass missing-subject => legal (ACCEPTED)", () => {
  const res = legalItemTransition("PENDING", "RED", { item: { behavioral: true }, testExit: 1, failureClass: "missing-subject" });
  assert.equal(res.ok, true, `missing-subject is a legal red (§2.6.1); why=${res.why}`);
});
test("3.1-red-evidence: PENDING->RED with failureClass error => rejected", () => {
  const res = legalItemTransition("PENDING", "RED", { item: { behavioral: true }, testExit: 1, failureClass: "error" });
  assert.equal(res.ok, false, "class error is not a legal red (§2.6.1)");
  assert.ok((res.why ?? "").length > 0);
});
test("3.1-red-evidence: PENDING->RED with testExit 0 => rejected (a passing test is not red)", () => {
  const res = legalItemTransition("PENDING", "RED", { item: { behavioral: true }, testExit: 0, failureClass: "assertion" });
  assert.equal(res.ok, false, "exit must be non-zero for a red");
  assert.ok((res.why ?? "").length > 0);
});

// ── 3.1-green-evidence ─────────────────────────────────────────────────────────
// TEST_VETTED->GREEN (behavioral) requires the item test to pass: testExit === 0.
test("3.1-green-evidence: TEST_VETTED->GREEN with testExit 0 => legal", () => {
  const res = legalItemTransition("TEST_VETTED", "GREEN", { item: { behavioral: true }, testExit: 0 });
  assert.equal(res.ok, true, `why=${res.why}`);
});
test("3.1-green-evidence: TEST_VETTED->GREEN with testExit 1 => rejected", () => {
  const res = legalItemTransition("TEST_VETTED", "GREEN", { item: { behavioral: true }, testExit: 1 });
  assert.equal(res.ok, false, "impl is not done by assertion; the test must actually pass");
  assert.ok((res.why ?? "").length > 0);
});

// ── 3.1-blocked ────────────────────────────────────────────────────────────────
// A blocked item rejects EVERY transition — even an otherwise-legal one — with a why
// naming the question that must be answered first. Orthogonal to the table (§3.3).
for (const [from, to] of [
  ["PENDING", "RED"],
  ["RED", "TEST_VETTED"],
  ["TEST_VETTED", "GREEN"],
  ["GREEN", "VALIDATED"],
  ["VALIDATED", "REVIEWED"],
  ["REVIEWED", "PUBLISHED"],
] as const) {
  test(`3.1-blocked: a blocked item rejects ${from}->${to} naming the questionId`, () => {
    const res = legalItemTransition(from, to, {
      item: { behavioral: true, blocked: { questionId: "Q-7", reason: "architecture questioned", stage: from } },
      ...otherwiseLegalEvidence(from),
    });
    assert.equal(res.ok, false, `blocked item must reject the otherwise-legal ${from}->${to}`);
    assert.ok(
      (res.why ?? "").includes("Q-7"),
      `why must name the blocking questionId; got: ${res.why}`,
    );
  });
}
