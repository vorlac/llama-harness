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
// A `null` entry is a tool whose handler does not exist yet (setup,
// forget_stale). The guard test
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
  conductor_publish: {
    handler: "handlePublish",
    input: "PublishInput",
    infrastructure: [
      "store",
      // Taken for a uniform handler shape and deliberately unused: a publish
      // dispatches nothing. The §3.3 message is built by a pure template
      // precisely because a commit message is a record, not a judgment.
      "fanout",
      "runId",
      "config",
      "journal",
      "stateHome",
      "workspaceKey",
      // `messageBuilder` and `now` are OPTIONAL seams, so they are not listed:
      // this list names the fields the root MUST supply. An optional seam the
      // handler defaults for itself is not one of them, and claiming it here
      // would assert a requirement the input does not carry.
    ],
    fixed: NO_FIXED,
  },
  conductor_report: {
    handler: "handleReport",
    input: "ReportInput",
    infrastructure: [
      "store",
      "runId",
      "config",
      "journal",
      "stateHome",
      "workspaceKey",
      // `metrics` (Task 7.2's fetchMetricsSummary) and `now` are OPTIONAL seams
      // and are omitted for the same reason as publish's messageBuilder.
      // `fanout` is an OPTIONAL seam too (unlike publish's): handleOverride's
      // over-budget refusal drives this same writer for the §2.9 stop-report
      // and has no fan-out engine in hand, so the input cannot require one.
      // The root still passes its fanout here, as everywhere an input accepts it.
    ],
    fixed: NO_FIXED,
  },
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
  conductor_inline_claim: {
    handler: "handleInlineClaim",
    input: "InlineClaimInput",
    // The claim is a §2.7 DERIVED decision (dispatching was the other option),
    // so the model supplies the scored options and the choice exactly as it
    // does for conductor_decide — the root can fabricate neither.
    infrastructure: ["store", "runId", "journal"],
    fixed: NO_FIXED,
  },
  conductor_override: {
    handler: "handleOverride",
    input: "OverrideInput",
    infrastructure: [
      "store",
      "runId",
      "config",
      "journal",
      // The overriding session's identity and its assigned item come from the
      // root's session registry (§3.5) — context, not model-supplied arguments.
      "sessionID",
      "itemId",
      // The §3.6 one-shot grant map is root-owned state, the sibling of the
      // session registry: handleOverride writes into it and gateBeforeToolCall
      // consumes from it.
      "overrideGrants",
      "stateHome",
      "workspaceKey",
      // `metrics` and `now` are OPTIONAL seams, omitted as on conductor_report.
    ],
    fixed: NO_FIXED,
  },
  conductor_status: {
    handler: "handleStatus",
    input: "StatusInput",
    infrastructure: ["store", "runId", "journal"],
    fixed: NO_FIXED,
  },
  conductor_setup: null,
  conductor_forget_stale: null,
};
