// conductor/plugin/index.ts — Task 5.3 (hook bodies; plan lines 2375-2391, §3.5).
// The opencode plugin FACTORY and NOTHING else: the 1.18.15 loader iterates every
// export of a plugin module and throws `TypeError("Plugin export is not a
// function")` when one is not a plugin function — skipping the WHOLE plugin and
// leaving the session ungated (Task 0.2 wire-notes). So this module exports
// exactly `ConductorPlugin`; the shared tool inventory lives in the sibling
// adapter/tools.ts.
//
// The returned hooks are (1) `tool`: the map built from CONDUCTOR_TOOL_NAMES, each
// value a `tool({...})` definition, (2) `tool.execute.before`: a THIN body
// that parses the opencode input and delegates to the ONE adapter function
// gateBeforeToolCall — which returns to allow and THROWS to deny (opencode reads
// the thrown message back to the model as the refusal reason, Task 0.2 wire-notes)
// — and (3) `chat.message`: the equally thin body that delegates to the ONE
// adapter function handleChatMessage, which creates the §3.2 run and writes the
// arriving session's §3.5 orchestrator registry entry (task-let 5.4a).
//
// Construction-safety: the factory only builds closures and zod schemas — no
// blocking I/O and no live opencode service is touched at construction — so the
// tool registration is unit-testable with a synthetic PluginInput and no running
// opencode (gate-wiring.test.ts constructs it and inspects the registered names).
// The workspace is therefore opened LAZILY, on first hook use, against the
// REALPATH of input.directory (§0.2 wire-notes pins canonicalization as a DRIFT:
// opencode canonicalizes session directories, and a non-canonical root makes the
// scope gates silently mis-match). An open that fails is LOUD on the §7.1 stderr
// sink and leaves the gate hook DENYING — a plugin that fails open, or that
// throws at construction and is skipped whole, is the §3.8 silent-ungate case.
//
// THE TWO-PHASE JOURNAL. createJournal is bound to a RUN DIRECTORY; the run
// directory is made by store.createRun(); the store needs a journal to open. That
// cycle is real, and the resolution is ONE journal object whose SINK is
// rebindable: before any run exists it writes through the §7.1 stderr sink, and
// the moment a run directory exists it rebinds to the createJournal-backed JSONL
// sink for that dir. Records written before the rebind are NOT replayed into the
// file — they were correctly stderr-only workspace events, and filing them under
// a run they did not belong to would break replay's source-order guarantee.
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

import { realpathSync } from "node:fs";
import * as path from "node:path";

import { tool } from "@opencode-ai/plugin";
import type { Plugin, PluginInput, ToolDefinition } from "@opencode-ai/plugin";

import { handleChatMessage } from "../adapter/chat-message.ts";
import type { SessionRegistry } from "../adapter/chat-message.ts";
import { DEFAULT_CONFIG, loadConfig } from "../adapter/config-io.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { classifyTool, CONDUCTOR_TOOL_NAMES, gateBeforeToolCall } from "../adapter/tools.ts";
import type { Corr, RegistryEntry } from "../adapter/tools.ts";
import type { Config, LogLevel } from "../core/types.ts";

// The harness version stamped into the §3.8 liveness beacon openWorkspace writes,
// so a `conductor doctor` reading alive.json can tell which harness left it.
const CONDUCTOR_VERSION = "0.1.0";

// The correlation triple as the WORKSPACE-level sinks model it: runId is optional
// because the lock, the beacon and a failed hook all precede any run. Narrower
// than adapter/tools.ts Corr (which requires runId), which is what lets the ONE
// journal below satisfy the gate sink, the state sink and the chat.message sink
// at once — a parameter accepted more widely is accepted everywhere.
interface HookCorr {
  runId?: string;
  itemId?: string;
  sessionID?: string;
}

// The one journal the whole plugin writes through. `level` is `string` rather
// than LogLevel for the same reason: adapter/state.ts's StateJournal declares it
// that way, and the widest parameter is the assignable one.
interface RebindableJournal {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: HookCorr,
  ) => void;
}

// The lazily-opened workspace: everything a hook needs that costs filesystem I/O
// to obtain. `repoConfigured` is the §3.2 flag core/gates-phase.ts legalTools
// takes; the phase gate that consumes it is bound with the tool handlers.
interface Workspace {
  root: string;
  config: Config;
  repoConfigured: boolean;
  store: StateStore;
}

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
  // ONE registry, two consumers. adapter/tools.ts gateBeforeToolCall reads a
  // Map<string, RegistryEntry>; adapter/chat-message.ts handleChatMessage writes
  // through a SessionRegistry interface (register/get). A bare Map does not
  // satisfy the latter, and two maps would leave the orchestrator entry the
  // chat.message hook writes invisible to the gate that must honour it — so the
  // plugin holds ONE map and hands the hook a thin view OVER THAT SAME MAP. The
  // fan-out engine writes the sub-session entries through the map directly. Until
  // an entry exists a session is unregistered and the registry gate denies its
  // writes, which is the safe default.
  const registry = new Map<string, RegistryEntry>();
  const registryView: SessionRegistry = {
    register: (sessionID, entry) => {
      registry.set(sessionID, entry);
    },
    get: (sessionID) => registry.get(sessionID),
  };

  // Phase one of the journal: the §7.1 stderr sink. One console.error per record,
  // carrying one JSON object, UNFILTERED — it is the only sink that exists before
  // a run does, so a console level filter here would LOSE a record outright
  // rather than downgrade it (§7.4).
  function stderrSink(
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: HookCorr,
  ): void {
    console.error(JSON.stringify({ level, component, event, data, corr }));
  }

  // Phase two: the JSONL journal for the live run's directory, bound the moment
  // one exists. Null until then.
  let runJournal: Journal | null = null;
  let liveRunId: string | null = null;

  const journal: RebindableJournal = {
    log: (level, component, event, data, corr) => {
      const bound = runJournal;
      if (bound === null) {
        stderrSink(level, component, event, data, corr);
        return;
      }
      // The forwarding seam: the caller already chose the component/event, and
      // every one of those callers names them literally (the §7.4 source audit in
      // conductor/tests/journal-vocab.test.ts allowlists this one site for that
      // reason). The file journal requires a runId on every record; the bound run
      // is the one a record without its own correlation belongs to.
      bound.log(level as LogLevel, component, event, data, {
        runId: corr.runId ?? liveRunId ?? input.project.id,
        ...(corr.itemId === undefined ? {} : { itemId: corr.itemId }),
        ...(corr.sessionID === undefined ? {} : { sessionID: corr.sessionID }),
      });
    },
  };

  // <root>/.conductor/runs/<runId> — the §1.2 layout, the same one state.ts writes.
  function runDirOf(root: string, id: string): string {
    return path.join(root, ".conductor", "runs", id);
  }

  // Point the journal at a run's own journal.jsonl. Pre-rebind records are NOT
  // replayed into it: they belong to the workspace, not to this run.
  function bindRunJournal(root: string, config: Config, id: string): void {
    liveRunId = id;
    runJournal = createJournal(runDirOf(root, id), config, process.env);
  }

  // The LAZY open (§0.2 / §3.8). Called by every hook, memoized on success. A
  // failure is reported at error level on the stderr sink — naming the root and
  // the errno, so the cause is in the record rather than merely the fact — and
  // returns null, which leaves the caller to carry on with the strictest defaults
  // rather than to disappear. Retried on the next hook use: a root that was
  // unreadable once may be readable later, and a permanently dead workspace
  // simply keeps saying so.
  let workspace: Workspace | null = null;
  function ensureWorkspace(sessionID: string, hook: string): Workspace | null {
    if (workspace !== null) return workspace;
    let root = input.directory;
    try {
      root = realpathSync(input.directory);
      const loaded = loadConfig(root);
      const store = openWorkspace({
        root,
        config: loaded.config,
        journal,
        version: CONDUCTOR_VERSION,
        sessionID,
      });
      workspace = {
        root,
        config: loaded.config,
        repoConfigured: loaded.repoConfigured,
        store,
      };
      return workspace;
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      journal.log(
        "error",
        "state",
        "hook.failed",
        {
          hook,
          root,
          code: errno.code ?? "",
          error: err instanceof Error ? err.message : String(err),
        },
        { sessionID },
      );
      return null;
    }
  }

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

    // Thin lifecycle hook: assemble the prompt, then delegate the whole decision
    // to the ONE adapter function. It returns void to opencode, so every effect
    // is durable — the run on disk, the registry entry, the journal record.
    "chat.message": async (hook, output) => {
      const sessionID = hook.sessionID;
      const ws = ensureWorkspace(sessionID, "chat.message");
      if (ws === null) return; // the open failure was already reported, loudly

      // The prompt is the `text` of every text part, in arrival order. A part of
      // any other kind (a file attachment, an agent marker) contributes nothing:
      // the builder selects by part TYPE, never by position.
      const texts: string[] = [];
      for (const part of output.parts) {
        if (part.type === "text") texts.push(part.text);
      }
      const prompt = texts.join("\n");

      try {
        const result = handleChatMessage({
          store: ws.store,
          registry: registryView,
          sessionID,
          prompt,
          journal,
        });
        // Rebind the journal to whichever run this prompt belongs to — the one
        // just created, or a live one this plugin instance inherited from an
        // earlier session. Records already written stay where they were written.
        if (liveRunId !== result.runId) {
          bindRunJournal(ws.root, ws.config, result.runId);
        }
        if (result.action === "created") {
          // The resolved workspace root is journaled here because it is the ONE
          // place it is observable: a symlinked root writes identical bytes
          // either way, so nothing else could show that §0.2's realpath rule was
          // honoured rather than merely intended.
          journal.log(
            "info",
            "state",
            "run.created",
            { runId: result.runId, root: ws.root },
            { runId: result.runId, sessionID },
          );
        }
      } catch (err) {
        // G5 fail-soft: conductor failing must not take the user's opencode
        // session down with it. Journaled ONCE, at error, under a §7.4 name, and
        // swallowed — this record is the only trace the failure leaves.
        journal.log(
          "error",
          "state",
          "hook.failed",
          {
            hook: "chat.message",
            root: ws.root,
            error: err instanceof Error ? err.message : String(err),
          },
          { sessionID },
        );
      }
    },

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

      // The gate must adjudicate even when the workspace could not be opened —
      // an absent gate is the §3.8 silent-ungate, the most dangerous failure
      // shape in this integration. Falling back to DEFAULT_CONFIG rather than to
      // the old hardcoded "commit" keeps the failure in the restrictive
      // direction: an unopenable workspace cannot be committed to.
      const ws = ensureWorkspace(hook.sessionID, "tool.execute.before");
      const config = ws?.config ?? DEFAULT_CONFIG;

      const corr: Corr = { runId: liveRunId ?? input.project.id, sessionID: hook.sessionID };
      gateBeforeToolCall({
        sessionID: hook.sessionID,
        toolName: hook.tool,
        args,
        command,
        editPath,
        registry,
        // The git policy is the repo's own (§2.1), not an assumption: a config
        // read and then ignored is the same downgrade as a config not read.
        gitMode: config.git.mode,
        runActive: true,
        branchPolicy: config.git.branchPolicy,
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
