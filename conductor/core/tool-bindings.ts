// conductor/core/tool-bindings.ts — C-044: the tool→handler binding table.
//
// ONE data table declaring, for every §3.4 conductor tool, which adapter/tools.ts
// handler serves it and how the handler's input is assembled:
//   - the tool's DECLARED args (plugin/index.ts) carry what the model supplies;
//   - `infrastructure` names the input fields the composition root supplies from
//     its own context (store, runId, config, journal, fanout, treeState,
//     stateHome, workspaceKey, packs, ...);
//   - `fixed` names the input fields the root pins to a constant. The one such
//     value today is `kind: "derived"` on conductor_decide — §2.7 defines
//     `"human"` as "was asked", and a decision recorded through a tool call was
//     not asked of a human, so the root fixes it (the path that carries a
//     human's answer is conductor_answer).
//
// The composition root (Task 13.1) CONSUMES this table when it binds handlers to
// the plugin's tool map, and conductor/tests/tool-binding.test.ts enforces, for
// every bound tool, that the handler's REQUIRED input fields are exactly the
// declared args ∪ infrastructure ∪ fixed. The table is written once here rather
// than derived twice — the same single-source construction G6 gives the FSM
// vocabularies.
//
// Optional handler inputs (`sessionID?`, `now?`, `executors?`, `humanTerritory?`)
// are NOT listed: the root passes its session/clock context wherever an input
// accepts it, and optionality means no binding decision hangs on them. The table
// carries only the fields a handler REQUIRES.
//
// A `null` entry is a tool whose handler does not exist yet (9.5b: publish,
// report; 9.5c: inline_claim, override, setup, forget_stale). The guard test
// asserts null-ness against the adapter source, so the moment such a handler is
// exported the guard goes red until its binding is declared here — a new handler
// is born under the guard, never retrofitted into it.
//
// Pure data (G3): no imports, no I/O, no clock.

export interface ToolBinding {
  // The exported adapter/tools.ts handler function serving this tool.
  handler: string;
  // The handler's input interface in adapter/tools.ts.
  input: string;
  // Required input fields the composition root supplies from its own context.
  infrastructure: readonly string[];
  // Required input fields the root pins to a constant value.
  fixed: Readonly<Record<string, string>>;
}

const NO_FIXED: Readonly<Record<string, string>> = {};

export const TOOL_BINDINGS: Readonly<Record<string, ToolBinding | null>> = {
  conductor_classify: {
    handler: "handleClassify",
    input: "ClassifyInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_decompose: {
    handler: "handleDecompose",
    input: "DecomposeInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_plan: {
    handler: "handlePlan",
    input: "PlanInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_plan_review: {
    handler: "handlePlanReview",
    input: "PlanReviewInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_dispatch_wave: {
    handler: "handleDispatchWave",
    input: "DispatchWaveInput",
    infrastructure: [
      "store",
      "fanout",
      "treeState",
      "runId",
      "config",
      "journal",
      "stateHome",
      "workspaceKey",
      "packs",
    ],
    fixed: NO_FIXED,
  },
  conductor_submit_test: {
    handler: "handleSubmitTest",
    input: "SubmitTestInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_vet_test: {
    handler: "handleVetTest",
    input: "VetTestInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_mark_green: {
    handler: "handleMarkGreen",
    input: "MarkGreenInput",
    infrastructure: ["store", "fanout", "runId", "config", "journal", "stateHome", "workspaceKey"],
    fixed: NO_FIXED,
  },
  conductor_validate: {
    handler: "handleValidate",
    input: "ValidateInput",
    infrastructure: [
      "store",
      "fanout",
      "runId",
      "config",
      "journal",
      "stateHome",
      "workspaceKey",
      "packs",
    ],
    fixed: NO_FIXED,
  },
  conductor_item_review: {
    handler: "handleItemReview",
    input: "ItemReviewInput",
    infrastructure: [
      "store",
      "fanout",
      "runId",
      "config",
      "journal",
      "stateHome",
      "workspaceKey",
      "packs",
    ],
    fixed: NO_FIXED,
  },
  conductor_publish: null,
  conductor_report: null,
  conductor_surface: {
    handler: "handleSurface",
    input: "SurfaceInput",
    // askedBy is the caller identity {role, sessionID} the root reads from its
    // session registry — context, not a model-supplied argument.
    infrastructure: ["store", "runId", "journal", "askedBy"],
    fixed: NO_FIXED,
  },
  conductor_answer: {
    handler: "handleAnswer",
    input: "AnswerInput",
    infrastructure: ["store", "runId", "journal"],
    fixed: NO_FIXED,
  },
  conductor_defer: {
    handler: "handleDefer",
    input: "DeferInput",
    infrastructure: ["store", "runId", "journal"],
    fixed: NO_FIXED,
  },
  conductor_decide: {
    handler: "handleDecide",
    input: "DecideInput",
    infrastructure: ["store", "runId", "journal"],
    // C-044 ruling: a decision recorded through a tool call was not asked of a
    // human (§2.7 "human ⇒ was asked"), so kind is always "derived" here.
    fixed: { kind: "derived" },
  },
  conductor_queue_amend: {
    handler: "handleQueueAmend",
    input: "QueueAmendInput",
    infrastructure: ["store", "runId", "config", "journal"],
    fixed: NO_FIXED,
  },
  conductor_inline_claim: null,
  conductor_override: null,
  conductor_status: {
    handler: "handleStatus",
    input: "StatusInput",
    infrastructure: ["store", "runId", "journal"],
    fixed: NO_FIXED,
  },
  conductor_setup: null,
  conductor_forget_stale: null,
};
