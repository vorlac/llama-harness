// Task 3.2 red tests — lives at conductor/tests/gates-phase.test.ts.
// Subject: conductor/core/gates-phase.ts (must not exist when this goes red; the
// failure is Cannot find module '../core/gates-phase.ts' — the missing-subject
// shape, a legal red per §2.6.1).
//
// Spec: plan §3.2 run stages (lines 1064-1159), §3.4 the conductor_* tool
// inventory — the exact tool names (lines 1303-1333), §4.2 the wave scheduler /
// recommended order (DAG depth, then item id — lines 1544-1618), and Task 3.2's
// enumerated case list (lines 2234-2260).
// Assertions (docs/build/specs/task-3.2.assertions.json): 3.2-api,
// 3.2-status-everywhere, 3.2-always-tools, 3.2-intake, 3.2-dispatch,
// 3.2-two-item-wave, 3.2-item-stage, 3.2-blocked, 3.2-nonbehavioral,
// 3.2-trivial, 3.2-unconfigured, 3.2-terminal.
//
// legalTools is THE single source the phase-order gate, the injection, and the
// continuation engine all consume (one derivation, three consumers — they can
// never disagree):
//
//   legalTools(run, items, questions, repoConfigured)
//     -> { legal: Map<toolName, argsHint>, recommended: {tool, args} | null, why }
//
//   argsHint (the Map value): { itemIds?: string[] } — for a per-item stage tool
//   the ids it may target right now; meta tools (status/decide/surface/defer/
//   answer/setup) carry no itemIds. `recommended.args` is the concrete arg object
//   the tool takes per §3.4: {itemId} for per-item tools, {} for the argless ones.

import { test } from "node:test";
import assert from "node:assert/strict";

import { legalTools } from "../core/gates-phase.ts";

// ---------------------------------------------------------------------------
// Minimal structural fixtures: only the fields legalTools may consume, in the
// *Like style of core/stops.ts. The full §2.3 Run / §2.5 Item / §2.11
// QuestionRecord assign to these structurally.
// ---------------------------------------------------------------------------

interface RunLike {
  state: string;
  stop: { kind: string } | null;
  // The recorded kind. A live run carries one from creation (the intake
  // placeholder), so its presence says nothing about whether the classifier ran.
  classification: { kind: string } | null;
  // The receipt that does say so — how legalTools tells UNCLASSIFIED INTAKE from
  // an INTAKE already classified `work` (§3.4).
  classified: boolean;
}

interface ItemLike {
  id: string;
  state: string;
  behavioral: boolean;
  dependsOn: string[];
  fileScope: string[];
  blocked: { reason: string } | null;
  deferred: { reason: string } | null;
}

interface QuestionLike {
  id: string;
  answeredIso: string | null;
}

// ---------------------------------------------------------------------------
// The §3.4 conductor_* inventory (the EXACT names — tests hardcode them).
// ---------------------------------------------------------------------------

const T = {
  classify: "conductor_classify",
  decompose: "conductor_decompose",
  plan: "conductor_plan",
  planReview: "conductor_plan_review",
  dispatchWave: "conductor_dispatch_wave",
  submitTest: "conductor_submit_test",
  vetTest: "conductor_vet_test",
  markGreen: "conductor_mark_green",
  validate: "conductor_validate",
  itemReview: "conductor_item_review",
  publish: "conductor_publish",
  report: "conductor_report",
  surface: "conductor_surface",
  answer: "conductor_answer",
  defer: "conductor_defer",
  decide: "conductor_decide",
  queueAmend: "conductor_queue_amend",
  inlineClaim: "conductor_inline_claim",
  override: "conductor_override",
  status: "conductor_status",
  setup: "conductor_setup",
  forgetStale: "conductor_forget_stale",
} as const;

// The per-item stage tools (§3.4 rows that carry {itemId}). A blocked/absent
// item must contribute none of these.
const PER_ITEM_TOOLS: readonly string[] = [
  T.submitTest,
  T.vetTest,
  T.markGreen,
  T.validate,
  T.itemReview,
  T.publish,
];

// The §3.1 run FSM (plan lines 1032-1043) split by §2.3 terminality.
const NON_TERMINAL_STATES: readonly string[] = [
  "INTAKE",
  "DECOMPOSED",
  "PLANNED",
  "PLAN_REVIEWED",
  "EXECUTING",
];
const TERMINAL_STATES: readonly string[] = ["REPORTED", "TRIVIAL_DONE", "ANSWERED"];

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

const run = (over: Partial<RunLike> = {}): RunLike => ({
  state: "EXECUTING",
  stop: null,
  classification: { kind: "work" },
  // The receipt, not the classification, is what says the classifier has spoken.
  // A run anywhere past INTAKE has one by construction.
  classified: true,
  ...over,
});

const item = (over: Partial<ItemLike> = {}): ItemLike => ({
  id: "I1",
  state: "PENDING",
  behavioral: true,
  dependsOn: [],
  fileScope: ["src/i1.ts"],
  blocked: null,
  deferred: null,
  ...over,
});

const keys = (result: { legal: Map<string, unknown> }): string[] =>
  [...result.legal.keys()].sort();

// ===========================================================================
// [3.2-api] the return shape — the single source's contract.
// ===========================================================================

test("[3.2-api] legalTools returns {legal: Map<toolName, argsHint>, recommended: {tool,args}|null, why}", () => {
  const result = legalTools(run(), [item()], [], true);

  assert.ok(result.legal instanceof Map, "legal is a Map keyed by tool name");
  assert.equal(typeof result.why, "string", "why is a string");
  assert.ok(result.why.length > 0, "why is a non-empty rationale");

  if (result.recommended !== null) {
    assert.equal(typeof result.recommended.tool, "string", "recommended.tool is a tool name");
    assert.equal(typeof result.recommended.args, "object", "recommended.args is an object");
    assert.notEqual(result.recommended.args, null, "recommended.args is a non-null object");
  }
});

// ===========================================================================
// [3.2-status-everywhere] conductor_status legal in EVERY state incl. terminal.
// ===========================================================================

test("[3.2-status-everywhere] conductor_status is legal in every run state, terminal included", () => {
  for (const state of [...NON_TERMINAL_STATES, ...TERMINAL_STATES]) {
    const result = legalTools(run({ state }), [item()], [], true);
    assert.ok(result.legal.has(T.status), `conductor_status legal in state ${state}`);
  }
  // Terminal-by-stop (a non-terminal STATE with a recorded stop, §2.3) too.
  const stopped = legalTools(run({ state: "EXECUTING", stop: { kind: "noop" } }), [item()], [], true);
  assert.ok(stopped.legal.has(T.status), "conductor_status legal in an EXECUTING run with a recorded stop");
});

// ===========================================================================
// [3.2-always-tools] decide/surface/defer in every non-terminal state;
// conductor_answer whenever an open question exists.
// ===========================================================================

test("[3.2-always-tools] conductor_decide/surface/defer are legal in every non-terminal state", () => {
  for (const state of NON_TERMINAL_STATES) {
    const result = legalTools(run({ state }), [item()], [], true);
    assert.ok(result.legal.has(T.decide), `conductor_decide legal in ${state}`);
    assert.ok(result.legal.has(T.surface), `conductor_surface legal in ${state}`);
    assert.ok(result.legal.has(T.defer), `conductor_defer legal in ${state}`);
  }
});

test("[3.2-always-tools] conductor_answer is legal exactly when an open question exists (non-terminal run)", () => {
  const openQ: QuestionLike[] = [{ id: "Q1", answeredIso: null }];
  const answeredQ: QuestionLike[] = [{ id: "Q1", answeredIso: "2026-08-12T00:00:00Z" }];

  const withOpen = legalTools(run(), [item()], openQ, true);
  assert.ok(withOpen.legal.has(T.answer), "conductor_answer legal while a question is open");

  const noOpen = legalTools(run(), [item()], answeredQ, true);
  assert.equal(noOpen.legal.has(T.answer), false, "conductor_answer NOT legal once every question is answered");

  const none = legalTools(run(), [item()], [], true);
  assert.equal(none.legal.has(T.answer), false, "conductor_answer NOT legal with no questions at all");
});

// ===========================================================================
// [3.2-intake] UNCLASSIFIED INTAKE => only conductor_classify (stage tool);
// INTAKE classified `work` => conductor_decompose recommended.
// ===========================================================================

test("[3.2-intake] UNCLASSIFIED INTAKE offers conductor_classify as the sole stage tool and recommends it", () => {
  const result = legalTools(
    run({ state: "INTAKE", classification: null, classified: false }),
    [],
    [],
    true,
  );

  assert.ok(result.legal.has(T.classify), "conductor_classify is legal in unclassified INTAKE");
  assert.notEqual(result.recommended, null, "an unclassified INTAKE recommends its next tool");
  assert.equal(result.recommended?.tool, T.classify, "conductor_classify is the recommended next tool");

  // No later pipeline tool is legal until classification is recorded.
  assert.equal(result.legal.has(T.decompose), false, "conductor_decompose NOT yet legal (unclassified)");
  assert.equal(result.legal.has(T.plan), false, "conductor_plan NOT yet legal (unclassified)");
  assert.equal(result.legal.has(T.dispatchWave), false, "conductor_dispatch_wave NOT yet legal (unclassified)");
});

// The intake placeholder. adapter/chat-message.ts writes a schema-valid
// classification the moment a run is created, so `classification === null` is a
// shape the live system never produces and the receipt for "the classifier has
// spoken" is run.classified. Measured in the 13.2 live smoke: every run reached
// conductor_decompose with classification "work" and check.agreed false, and
// conductor_classify was never offered, never recommended and never ran — the
// trivial and question routes with it.
test("[smoke-F12] INTAKE carrying the intake placeholder (classified false) offers conductor_classify and recommends it", () => {
  const result = legalTools(
    run({ state: "INTAKE", classification: { kind: "work" }, classified: false }),
    [],
    [],
    true,
  );

  assert.ok(result.legal.has(T.classify), "conductor_classify is legal while the placeholder stands");
  assert.equal(result.recommended?.tool, T.classify, "and it is the recommended next tool");
  assert.equal(result.legal.has(T.decompose), false, "conductor_decompose is NOT yet legal");
});

test("[smoke-F12] INTAKE once the classifier has spoken (classified true, kind 'work') recommends conductor_decompose", () => {
  const result = legalTools(
    run({ state: "INTAKE", classification: { kind: "work" }, classified: true }),
    [],
    [],
    true,
  );

  assert.equal(result.recommended?.tool, T.decompose, "the recorded work classification advances to decompose");
  assert.equal(result.legal.has(T.classify), false, "conductor_classify is not re-offered once it has run");
});

test("[3.2-intake] INTAKE with classification.kind === 'work' recommends conductor_decompose", () => {
  const result = legalTools(run({ state: "INTAKE", classification: { kind: "work" } }), [], [], true);

  assert.notEqual(result.recommended, null, "a classified-work INTAKE recommends its next tool");
  assert.equal(result.recommended?.tool, T.decompose, "conductor_decompose is the recommended next tool");
  assert.deepEqual(result.recommended?.args, {}, "conductor_decompose takes no args (§3.4)");
  assert.ok(result.legal.has(T.decompose), "conductor_decompose is legal");
  // Once classified, decompose is the ONLY pipeline-advancing tool (§3.2): the
  // already-performed classify is no longer offered.
  assert.equal(result.legal.has(T.classify), false, "conductor_classify no longer legal once classified");
});

// ===========================================================================
// [3.2-dispatch] PLAN_REVIEWED => conductor_dispatch_wave recommended
// (which performs PLAN_REVIEWED->EXECUTING on its first call).
// ===========================================================================

test("[3.2-dispatch] PLAN_REVIEWED recommends conductor_dispatch_wave", () => {
  const items = [item({ id: "I1", state: "PENDING" }), item({ id: "I2", state: "PENDING", fileScope: ["src/i2.ts"] })];
  const result = legalTools(run({ state: "PLAN_REVIEWED" }), items, [], true);

  assert.notEqual(result.recommended, null, "PLAN_REVIEWED recommends its next tool");
  assert.equal(result.recommended?.tool, T.dispatchWave, "conductor_dispatch_wave is recommended");
  assert.deepEqual(result.recommended?.args, {}, "conductor_dispatch_wave takes no args (§3.4)");
  assert.ok(result.legal.has(T.dispatchWave), "conductor_dispatch_wave is legal in PLAN_REVIEWED");
});

// ===========================================================================
// [3.2-two-item-wave] a two-item wave yields a legal SET containing BOTH items'
// next tools and EXACTLY ONE recommended — deterministic under item reordering.
// (The §3.1 rule: this is the test that would have caught "the one legal next
// tool" being false.)
// ===========================================================================

test("[3.2-two-item-wave] two concurrent items expose both next tools, one recommended, stable under reordering", () => {
  // I1: behavioral PENDING  -> next stage tool conductor_submit_test.
  // I2: behavioral TEST_VETTED -> next stage tool conductor_mark_green.
  // Both depth 0 (no deps) and fileScope-disjoint => both in the wave.
  const i1 = item({ id: "I1", state: "PENDING", behavioral: true, fileScope: ["src/a.ts"] });
  const i2 = item({ id: "I2", state: "TEST_VETTED", behavioral: true, fileScope: ["src/b.ts"] });

  const forward = legalTools(run({ state: "EXECUTING" }), [i1, i2], [], true);
  const reversed = legalTools(run({ state: "EXECUTING" }), [i2, i1], [], true);

  // The SET contains BOTH items' distinct next tools — not "one legal next tool".
  assert.ok(forward.legal.has(T.submitTest), "I1's next tool conductor_submit_test is in the legal set");
  assert.ok(forward.legal.has(T.markGreen), "I2's next tool conductor_mark_green is in the legal set");
  assert.deepEqual(forward.legal.get(T.submitTest)?.itemIds, ["I1"], "conductor_submit_test targets I1");
  assert.deepEqual(forward.legal.get(T.markGreen)?.itemIds, ["I2"], "conductor_mark_green targets I2");

  // Exactly ONE recommended — the §4.2 wave-order first item (both depth 0, so
  // tie-broken by item id => I1), then that item's next stage tool.
  assert.deepEqual(
    forward.recommended,
    { tool: T.submitTest, args: { itemId: "I1" } },
    "recommended = wave-order-first item (I1) next tool",
  );

  // Deterministic under reordering: SAME recommended tool+args AND same
  // legal-set membership regardless of the items array order.
  assert.deepEqual(reversed.recommended, forward.recommended, "recommended is stable under item reordering");
  assert.deepEqual(keys(reversed), keys(forward), "legal-set membership is stable under item reordering");
});

// ===========================================================================
// [3.2-item-stage] EXECUTING with I1 at TEST_VETTED => conductor_mark_green{I1}
// legal, conductor_publish{I1} illegal.
// ===========================================================================

test("[3.2-item-stage] an item at TEST_VETTED legalizes conductor_mark_green, not conductor_publish", () => {
  const result = legalTools(run({ state: "EXECUTING" }), [item({ id: "I1", state: "TEST_VETTED" })], [], true);

  assert.ok(result.legal.has(T.markGreen), "conductor_mark_green legal at TEST_VETTED");
  assert.deepEqual(result.legal.get(T.markGreen)?.itemIds, ["I1"], "conductor_mark_green targets I1");
  assert.equal(result.legal.has(T.publish), false, "conductor_publish illegal at TEST_VETTED (it is REVIEWED->PUBLISHED)");
});

// ===========================================================================
// [3.2-blocked] a blocked item contributes NO tools to the legal set.
// ===========================================================================

test("[3.2-blocked] a blocked item contributes no per-item stage tools", () => {
  // Would normally (behavioral PENDING) offer conductor_submit_test — but blocked.
  const blockedItem = item({ id: "I1", state: "PENDING", blocked: { reason: "awaiting human decision" } });
  const result = legalTools(run({ state: "EXECUTING" }), [blockedItem], [], true);

  for (const tool of PER_ITEM_TOOLS) {
    assert.equal(result.legal.has(tool), false, `${tool} NOT legal — the only item is blocked`);
  }
});

// ===========================================================================
// [3.2-nonbehavioral] a non-behavioral PENDING item offers conductor_mark_green,
// NOT conductor_submit_test (§3.4: non-behavioral has no test to submit).
// ===========================================================================

test("[3.2-nonbehavioral] a non-behavioral PENDING item offers conductor_mark_green, not conductor_submit_test", () => {
  const result = legalTools(
    run({ state: "EXECUTING" }),
    [item({ id: "N1", state: "PENDING", behavioral: false })],
    [],
    true,
  );

  assert.ok(result.legal.has(T.markGreen), "conductor_mark_green legal for a non-behavioral PENDING item");
  assert.deepEqual(result.legal.get(T.markGreen)?.itemIds, ["N1"], "conductor_mark_green targets N1");
  assert.equal(result.legal.has(T.submitTest), false, "conductor_submit_test illegal for a non-behavioral item");
});

// ===========================================================================
// [3.2-trivial] EXECUTING flagged trivial legalizes the item's stage tool while
// the item is unsettled — but conductor_report is NOT legal until EVERY item is
// settled (§3.2 line 1142; the report precondition is all-settled for trivial
// AND work runs alike — a trivial run may not report over unfinished work,
// C-018).
// ===========================================================================

test("[3.2-trivial] a trivial EXECUTING run with an unsettled item legalizes its stage tool but NOT conductor_report", () => {
  const result = legalTools(
    run({ state: "EXECUTING", classification: { kind: "trivial" } }),
    [item({ id: "T1", state: "PENDING", behavioral: true })],
    [],
    true,
  );

  // The trivial item's stage tool is legal and recommended...
  assert.ok(result.legal.has(T.submitTest), "the trivial item's stage tool conductor_submit_test is legal");
  assert.deepEqual(result.legal.get(T.submitTest)?.itemIds, ["T1"], "conductor_submit_test targets T1");
  assert.deepEqual(
    result.recommended,
    { tool: T.submitTest, args: { itemId: "T1" } },
    "the trivial item's next stage tool is recommended while it is unsettled",
  );
  // ...but conductor_report is NOT legal while the sole item is still PENDING:
  // the work is not done, so the report-lite close is not yet due (§3.2).
  assert.equal(
    result.legal.has(T.report),
    false,
    "conductor_report is NOT legal in a trivial run while an item is unsettled",
  );
});

// ===========================================================================
// [3.2-trivial-report-settled] once the trivial run's sole item is PUBLISHED,
// every item is settled => conductor_report IS legal (the report-lite terminal
// path, EXECUTING->TRIVIAL_DONE, now that the work is done).
// ===========================================================================

test("[3.2-trivial-report-settled] a trivial EXECUTING run whose sole item is PUBLISHED legalizes conductor_report", () => {
  const result = legalTools(
    run({ state: "EXECUTING", classification: { kind: "trivial" } }),
    [item({ id: "T1", state: "PUBLISHED", behavioral: true })],
    [],
    true,
  );

  // The published item exposes no stage tool, and with every item settled the
  // report-lite close becomes legal — and is the recommendation.
  assert.ok(result.legal.has(T.report), "conductor_report IS legal once every item is settled");
  assert.deepEqual(
    result.recommended,
    { tool: T.report, args: {} },
    "conductor_report is recommended once every item is settled",
  );
});

// ===========================================================================
// [3.2-unconfigured] repoConfigured false => ONLY conductor_setup and
// conductor_status (nothing else, in any state).
// ===========================================================================

test("[3.2-unconfigured] an unconfigured repo legalizes only conductor_setup and conductor_status", () => {
  const result = legalTools(run({ state: "EXECUTING" }), [item()], [{ id: "Q1", answeredIso: null }], false);

  assert.deepEqual(keys(result), [T.setup, T.status].sort(), "the legal set is exactly {setup, status}");
  assert.equal(result.recommended?.tool, T.setup, "conductor_setup is recommended while the repo is unconfigured");
});

// ===========================================================================
// [3.2-terminal] isTerminal run => conductor_status (+conductor_answer when a
// question is open) and NOTHING else.
// ===========================================================================

test("[3.2-terminal] a terminal run with no open questions legalizes only conductor_status", () => {
  const terminalRuns: RunLike[] = [
    run({ state: "REPORTED" }),
    run({ state: "TRIVIAL_DONE" }),
    run({ state: "ANSWERED" }),
    run({ state: "EXECUTING", stop: { kind: "noop" } }),
  ];
  for (const terminal of terminalRuns) {
    const result = legalTools(terminal, [item({ state: "PUBLISHED" })], [], true);
    assert.deepEqual(keys(result), [T.status], `only conductor_status is legal in a terminal run (${terminal.state})`);
    assert.equal(result.recommended, null, `a terminal run recommends nothing (${terminal.state})`);
  }
});

test("[3.2-terminal] a terminal run with an open question legalizes conductor_status and conductor_answer, nothing else", () => {
  const result = legalTools(run({ state: "REPORTED" }), [item({ state: "PUBLISHED" })], [{ id: "Q1", answeredIso: null }], true);

  assert.deepEqual(keys(result), [T.answer, T.status].sort(), "the legal set is exactly {answer, status}");
  // The non-terminal meta tools do NOT leak into a terminal run.
  assert.equal(result.legal.has(T.decide), false, "conductor_decide NOT legal in a terminal run");
  assert.equal(result.legal.has(T.surface), false, "conductor_surface NOT legal in a terminal run");
  assert.equal(result.legal.has(T.defer), false, "conductor_defer NOT legal in a terminal run");
  assert.equal(result.recommended, null, "a terminal run recommends nothing (answer is the human's resume path, not a recommendation)");
});
