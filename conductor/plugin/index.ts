// conductor/plugin/index.ts — Task 5.3 (hook bodies; plan lines 2375-2391, §3.5).
// The opencode plugin FACTORY and NOTHING else: the 1.18.15 loader iterates every
// export of a plugin module and throws `TypeError("Plugin export is not a
// function")` when one is not a plugin function — skipping the WHOLE plugin and
// leaving the session ungated (Task 0.2 wire-notes). So this module exports
// exactly `ConductorPlugin`; the shared tool inventory lives in the sibling
// adapter/tools.ts.
//
// The returned hooks are (1) `tool`: the map built from CONDUCTOR_TOOL_NAMES, each
// value a `tool({...})` definition, and (2) `tool.execute.before`: a THIN body
// that parses the opencode input and delegates to the ONE adapter function
// gateBeforeToolCall — which returns to allow and THROWS to deny (opencode reads
// the thrown message back to the model as the refusal reason, Task 0.2 wire-notes).
//
// Construction-safety: the factory only builds closures and zod schemas — no
// blocking I/O and no live opencode service is touched at construction — so the
// tool registration is unit-testable with a synthetic PluginInput and no running
// opencode (gate-wiring.test.ts constructs it and inspects the registered names).
//
// G1/§5.1 `tool()` resolution: §1.4's dual-runtime guard treats
// `@opencode-ai/plugin` as a dev dependency, but §5.1 needs the runtime `tool()`
// helper to register custom tools. The installed package resolves this: its `.`
// export re-exports `./tool.js`, whose runtime value `tool` is `(input) => input`
// with `tool.schema` = zod (verified in node_modules and already relied on by the
// Task 0.2 recorder-plugin fixture). opencode loads this plugin under its own
// runtime and resolves the bare specifier from conductor/node_modules; Node
// type-stripping resolves the same path for the test. So the VALUE import below is
// the sanctioned runtime use of the package; the `Plugin`/`PluginInput` names are
// type-only (erased).

import { tool } from "@opencode-ai/plugin";
import type { Plugin, PluginInput, ToolDefinition } from "@opencode-ai/plugin";

import { classifyTool, CONDUCTOR_TOOL_NAMES, gateBeforeToolCall } from "../adapter/tools.ts";
import type { Corr, GateJournal, RegistryEntry } from "../adapter/tools.ts";

// One-line descriptions + arg schemas for the §3.4 inventory. Keyed by tool name;
// the map is BUILT from CONDUCTOR_TOOL_NAMES below, so a name missing here falls
// back to an argument-free definition rather than dropping the tool (which would
// fail the inventory assertion). `S` is the package's bundled zod (`tool.schema`).
const S = tool.schema;

// The zod raw-shape type the runtime `tool()` accepts for `args`, derived from the
// package's own signature so every zod schema kind (string, array, optional, …)
// is admissible without importing zod's type surface directly.
type ArgShape = Parameters<typeof tool>[0]["args"];

interface ToolSpec {
  description: string;
  args: ArgShape;
}

// §2.7's scored option, declared ONCE and shared by every tool that records a
// decision. Every tool-recorded decision is `kind:"derived"` (§2.7 reserves
// "human" for a decision that was ASKED of the human, which arrives through
// conductor_answer), and core requireTwoOptions rejects a derived record with
// fewer than two options or with any option lacking a score.
//
// Declaring this as a bare string array — as both conductor_decide and
// conductor_queue_amend did — made those tools UNABLE TO SUCCEED AT ALL: a
// string carries no score, the composition root may not fabricate one, so every
// call would have been refused by requireTwoOptions. The model supplies the
// score because the model is the one making the judgement (C-047).
const scoredOptions = S.array(
  S.object({
    name: S.string().describe("the option considered"),
    score: S.object({
      capability: S.number(),
      testability: S.number(),
      movingParts: S.number(),
      validationEarliness: S.number(),
      singleSource: S.number(),
    })
      .optional()
      .describe("the §2.7 ladder-5 score; REQUIRED on a derived decision, omitted only for human questions"),
  }),
);

// A registered conductor tool whose handler is bound in later phases (§3.4:
// handlers check gates-phase legality, re-derive evidence, and write state). Until
// a run binds the handler layer to this session, invoking the tool is a real
// error rather than a silent no-op.
function handlerNotBound(name: string): () => Promise<string> {
  return async (): Promise<string> => {
    throw new Error(
      `conductor tool "${name}" was invoked but no run handler is bound to this session — ` +
        "conductor advances state only through its per-run handler layer (§3.4)",
    );
  };
}

export const ConductorPlugin: Plugin = async (input: PluginInput) => {
  // Per-instance context. The registry is populated by the fan-out engine (when
  // it creates a sub-session) and the chat.message hook (for the orchestrator) in
  // later phases; until an entry exists a session is treated as unregistered, so
  // the registry gate denies its writes — the safe default for this wiring phase.
  const registry = new Map<string, RegistryEntry>();
  const runId = input.project.id;

  // Construction-safe journal sink. Later phases replace this with the JSONL file
  // journal (adapter/journal.ts) bound to the run directory; until then, security
  // decisions still surface out-of-band on stderr (§7.4) rather than vanishing.
  const journal: GateJournal = {
    log: (level, component, event, data, corr) => {
      console.error(JSON.stringify({ level, component, event, data, corr }));
    },
  };

  const specs: Record<string, ToolSpec> = {
    conductor_classify: {
      description: "Classify the run's intake (classifier + skeptic check) and advance INTAKE.",
      args: {},
    },
    conductor_decompose: {
      description: "Decompose classified work into the validated item queue (DAG, scopes, sizes).",
      args: {},
    },
    conductor_plan: {
      description: "Write plan.md and extract decision records; advance to PLANNED.",
      args: {},
    },
    conductor_plan_review: {
      description: "Run the plan-review fan-out with verdicts and the revision loop.",
      args: {},
    },
    conductor_dispatch_wave: {
      description: "Compute the next wave and drive each member's item pipeline concurrently.",
      args: {},
    },
    conductor_submit_test: {
      description: "Run the item's test and assert a legal red (behavioral); PENDING to RED.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_vet_test: {
      description: "Run the test-critic fan-out and record verdicts; RED to TEST_VETTED.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_mark_green: {
      description: "Confirm the item's test passes; advance to GREEN.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_validate: {
      description: "Run the quarantined, start/HEAD-stamped full verify; GREEN to VALIDATED.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_item_review: {
      description: "Run the reviewer+skeptic fan-out with the fix loop; VALIDATED to REVIEWED.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_publish: {
      description: "Branch/stage/format/freshness-check/commit the item (§3.3); REVIEWED to PUBLISHED.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_report: {
      description: "Run a fresh full verify, write report.md, and stop the run done.",
      args: {},
    },
    conductor_surface: {
      description: "Surface a blocking question, mark named items blocked, and continue the rest.",
      args: {
        question: S.string().describe("the question to surface to the human"),
        blocksItems: S.array(S.string()).describe("item ids this question blocks"),
        humanTerritory: S.boolean().optional().describe("true when the question is human-territory"),
      },
    },
    conductor_answer: {
      description: "Record a human answer and clear blocked on every item that named the question.",
      args: {
        questionId: S.string().describe("the surfaced question's id"),
        answer: S.string().describe("the human's answer"),
      },
    },
    conductor_defer: {
      description: "Defer an item with a reason and decision record (a valid final disposition).",
      args: {
        itemId: S.string().describe("the queue item id"),
        reason: S.string().describe("why the item is deferred"),
      },
    },
    conductor_decide: {
      description: "Append a decision record for a chosen option (§2.7).",
      args: {
        question: S.string().describe("the decision being recorded"),
        options: scoredOptions.describe("the options considered, each with its §2.7 ladder-5 score"),
        choice: S.string().describe("the chosen option"),
        why: S.string().describe("the rationale for the choice"),
        appliedWhere: S.string().describe("where the decision is applied (file, doc, or config site)"),
      },
    },
    conductor_queue_amend: {
      description: "Re-validate and apply queue amendment ops with a decision record.",
      args: {
        ops: S.array(S.string()).describe("the amendment operations to apply"),
        question: S.string().describe("the decision the amendment answers (§2.7)"),
        options: scoredOptions.describe("the options considered, each with its §2.7 ladder-5 score"),
        choice: S.string().describe("the chosen option"),
        why: S.string().describe("the rationale for the choice"),
        appliedWhere: S.string().describe("where the decision is applied (file, doc, or config site)"),
      },
    },
    conductor_inline_claim: {
      description: "Record an inline claim scoping orchestrator edit permission to an item (§3.6).",
      args: {
        itemId: S.string().describe("the item whose fileScope is claimed"),
        reason: S.string().describe("why inline work is cheaper than dispatch"),
        // The claim is a §2.7 DERIVED decision (dispatching was the other
        // option), so it carries scored options exactly as conductor_decide does.
        options: scoredOptions.describe("the options considered, each with its §2.7 ladder-5 score"),
        choice: S.string().describe("the chosen option (working the item inline)"),
      },
    },
    conductor_override: {
      description: "Spend the override budget for a one-shot gate bypass with taint (§3.6).",
      args: {
        gate: S.string().describe("the gate being overridden"),
        reason: S.string().describe("the justification for the override"),
        grantedAction: S.string().describe("the ONE next action this override permits (§2.8 grantedAction)"),
      },
    },
    conductor_status: {
      description: "Print the run/item/question/ledger summary (read-only; legal in every state).",
      args: {},
    },
    conductor_setup: {
      description: "Run first-run setup/reconfigure with the setup proofs (§2.1).",
      args: { reconfigure: S.boolean().optional().describe("re-run setup on an already-configured repo") },
    },
    conductor_forget_stale: {
      description: "Remove a resolved stale-red entry (§2.11) by path.",
      args: { path: S.string().describe("the stale-red entry path to forget") },
    },
  };

  // Build the `tool` map FROM the inventory so its keys are exactly
  // CONDUCTOR_TOOL_NAMES — a renamed or forgotten tool cannot slip through.
  const toolMap: Record<string, ToolDefinition> = {};
  for (const name of CONDUCTOR_TOOL_NAMES) {
    const spec = specs[name] ?? { description: `Conductor tool ${name}.`, args: {} };
    toolMap[name] = tool({
      description: spec.description,
      args: spec.args,
      execute: handlerNotBound(name),
    });
  }

  return {
    tool: toolMap,

    // Thin gate hook: parse the opencode input, then delegate the whole decision
    // to the ONE adapter function. A throw denies; a normal return allows.
    "tool.execute.before": async (hook, output) => {
      const args = (output.args ?? {}) as Record<string, unknown>;
      const command = typeof args.command === "string" ? args.command : undefined;
      const filePathRaw = args.filePath ?? args.path;
      // Only pass an edit path for an actual edit/write tool — a read tool that
      // happens to carry a `filePath` (e.g. read) must not be judged by the edit
      // gate; bash write shapes are derived from `command` inside the adapter.
      const editPath =
        classifyTool(hook.tool) === "write" && typeof filePathRaw === "string"
          ? filePathRaw
          : undefined;

      const corr: Corr = { runId, sessionID: hook.sessionID };
      gateBeforeToolCall({
        sessionID: hook.sessionID,
        toolName: hook.tool,
        args,
        command,
        editPath,
        registry,
        gitMode: "commit",
        runActive: true,
        branchPolicy: "pin",
        fileScope: [],
        testScope: [],
        verifyInFlightTree: null,
        inlineClaimScope: null,
        journal,
        corr,
      });
    },
  };
};
