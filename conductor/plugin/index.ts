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

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { tool } from "@opencode-ai/plugin";
import type { Plugin, PluginInput, ToolDefinition } from "@opencode-ai/plugin";

import { handleChatMessage } from "../adapter/chat-message.ts";
import type { SessionRegistry } from "../adapter/chat-message.ts";
import {
  activeInlineClaimScope,
  createContinuationState,
  handlePluginEvent,
  resolveSessionTree,
} from "../adapter/continuation.ts";
import type { ContinuationClient } from "../adapter/continuation.ts";
import { DEFAULT_CONFIG, loadConfig } from "../adapter/config-io.ts";
import { liveVerifyTrees } from "../adapter/evidence.ts";
import { createFanout } from "../adapter/fanout.ts";
import type {
  Fanout,
  FanoutClient,
  SessionRegistry as FanoutRegistry,
} from "../adapter/fanout.ts";
import { loadPacks } from "../adapter/inject.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { createFailoverState } from "../adapter/router-client.ts";
import type { FailoverState } from "../adapter/router-client.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import {
  classifyTool,
  CONDUCTOR_TOOL_NAMES,
  gateBeforeToolCall,
  handleAnswer,
  handleClassify,
  handleDecide,
  handleDecompose,
  handleDefer,
  handleDispatchWave,
  handleInlineClaim,
  handleItemReview,
  handleMarkGreen,
  handleOverride,
  handlePlan,
  handlePlanReview,
  handlePublish,
  handleQueueAmend,
  handleReport,
  handleSetup,
  handleStatus,
  handleSubmitTest,
  handleSurface,
  handleValidate,
  handleVetTest,
  readQueueJson,
  verifyInFlightTreeFor,
} from "../adapter/tools.ts";
import type {
  Corr,
  DecideInput,
  OverrideGrant,
  QueueAmendInput,
  RegistryEntry,
  SetupInput,
  StatusResult,
  WaveTreeState,
} from "../adapter/tools.ts";
import { AMEND_OP_KINDS, parseAmendOps } from "../core/queue-amend.ts";
import type { Config, LogLevel } from "../core/types.ts";

// The harness version stamped into the §3.8 liveness beacon openWorkspace writes,
// so a `conductor doctor` reading alive.json can tell which harness left it.
const CONDUCTOR_VERSION = "0.1.0";

// The §6.4 doctrine pack directory, which ships beside this plugin. Resolved from
// this module's own location rather than from a cwd: opencode loads the plugin
// from wherever the repo lives, and a cwd-relative doctrine path would load nine
// packs in a test and none in production.
const DOCTRINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "doctrine");

// §12's session env (scripts/conductor_wiring.py:612-620): serve.py exports the
// router's listen origin, the upstream llama-server's origin and the served model
// id into the session the plugin runs in. Env is the channel because opencode
// rejects unrecognized config keys and core Config has no router block, so nothing
// else in the committed TS can learn where the router is listening.
const ENV_ROUTER_URL = "LLAMA_HARNESS_ROUTER_URL";
const ENV_UPSTREAM_URL = "LLAMA_HARNESS_URL";
const ENV_MODEL_ID = "LLAMA_HARNESS_MODEL";

// The §6.4 doctrine directory an operator can point somewhere else — the same
// session-env channel as the three above, and read at CALL time rather than frozen
// at module load, so a directory that changes between two tool calls is honoured
// by the second. DOCTRINE_DIR stays the default, so a workspace that never sets it
// loads the shipped packs exactly as it does today; an override that is missing a
// required pack fails CLOSED through loadPacks, which is the half the composition
// root could not bind while the directory was a module-relative const.
const ENV_DOCTRINE_DIR = "LLAMA_HARNESS_DOCTRINE_DIR";

// Where the §6.4 packs are read from for THIS call: the override when the session
// carries one, else the directory that ships beside this plugin.
function doctrineDirOf(): string {
  const override = process.env[ENV_DOCTRINE_DIR];
  return override !== undefined && override.length > 0 ? override : DOCTRINE_DIR;
}

// The §2.2 defaults the same two scripts fall back to (conductor_wiring.py
// DEFAULT_LISTEN_PORT=8088, fetch_models.py DEFAULT_HOST/DEFAULT_PORT). They are
// used ONLY when the session was not started by serve.py, so a setup run outside a
// harness session probes where the harness would have put things rather than
// nowhere at all.
const DEFAULT_ORIGIN_HOST = "127.0.0.1";
const DEFAULT_ROUTER_PORT = 8088;
const DEFAULT_UPSTREAM_PORT = 8080;
const ROUTER_PROBE_TIMEOUT_MS = 4_000;

// How often the §3.5 freeze view re-reads the run directory while a write-capable
// job is being held. Short enough that a cleared marker releases the held job
// promptly; the timer exists only while something is actually waiting on it.
const MARKER_POLL_MS = 40;

// Parse an `http://host:port` origin into the {host, port} pair the §4.4 router
// client takes. An absent or unparseable value falls back to the §2.2 default —
// a malformed env var must not make the tool unable to run at all.
function originOf(value: string | undefined, fallbackPort: number): { host: string; port: number } {
  if (value !== undefined && value.length > 0) {
    try {
      const url = new URL(value);
      const port = url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
      if (url.hostname.length > 0 && Number.isFinite(port) && port > 0) {
        return { host: url.hostname, port };
      }
    } catch {
      // fall through to the default below
    }
  }
  return { host: DEFAULT_ORIGIN_HOST, port: fallbackPort };
}

// The arguments a tool call arrived with, as a plain record. opencode hands the
// zod-parsed object; a direct caller may hand anything.
function argsOf(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

// The calling session id from the opencode ToolContext, "" when the caller did not
// supply one (which leaves the call unregistered, the safe default).
function sessionIdOf(context: unknown): string {
  if (context === null || typeof context !== "object") return "";
  const id = (context as { sessionID?: unknown }).sessionID;
  return typeof id === "string" ? id : "";
}

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
  // The evidence layer and the fan-out engine take the full adapter/journal.ts
  // Journal (log + flushSync), and adapter/tools.ts forwards flushSync only when
  // the sink it was handed carries one. Without it a verify's records would sit
  // buffered while the very tool that wrote them returned.
  flushSync: () => void;
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

// conductor_status is legal before any run exists, and the absent run is REPORTED
// rather than invented — the two run-identifying fields are null and every other
// field is the empty reading of itself. That case is DERIVED from the handler's own
// declared result rather than typed out a second time: the bound tool hands its
// value back as a JSON string, so this annotation is the only thing that ever
// compares the runless return to StatusResult. A field added there is a compile
// error here, which is what keeps one tool from carrying two shapes.
type RunlessStatus = Omit<StatusResult, "runId" | "state"> & { runId: null; state: null };

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

// §2.4's queue entry, declared as the whole entry core's Queue schema requires: an
// `add`/`update` op carries one of these, and a partial declaration would tell a
// model to send an entry validateQueue then refuses. The field VOCABULARIES stay
// core's — ladderRung is checked against §2.7's ladder there, not paraphrased here.
const queueEntry = S.object({
  id: S.string().describe("the item id"),
  title: S.string().describe("what the item does"),
  rationale: S.string().describe("why the item exists"),
  fileScope: S.array(S.string()).describe("the paths this item may edit"),
  testScope: S.array(S.string()).describe("the test paths this item owns"),
  acceptance: S.array(S.string()).describe("the observable acceptance rows"),
  behavioral: S.boolean().describe("true when the item changes observable behaviour"),
  dependsOn: S.array(S.string()).describe("item ids this item depends on"),
  ponytail: S.object({
    necessary: S.string(),
    reuse: S.string(),
    ladderRung: S.string().describe("the §2.7 ladder rung this item sits on"),
  }).describe("the §2.4 necessity/reuse/ladder record"),
});

// §2.4's amendment op, in the shape core/queue-amend.ts's QueueAmendOp union
// requires: `remove` names an id, `add` and `update` carry the whole queue entry.
// Declared as a bare string array, this argument told a model to send text that
// amends nothing at all — the same C-047 defect conductor_decide's scored options
// carried. The model supplies the structure because the composition root may not
// invent it; core's parseAmendOps is what narrows what arrives to the union.
const amendOps = S.array(
  S.object({
    op: S.enum([...AMEND_OP_KINDS]).describe(`one of ${AMEND_OP_KINDS.join("/")}`),
    id: S.string().optional().describe("the queue item id to remove (remove only)"),
    item: queueEntry.optional().describe("the whole §2.4 queue entry to add or update"),
  }),
);

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
    // A COPY, never the caller's object. adapter/chat-message.ts registers one
    // module-level `{role:"orchestrator"}` constant for every session it ever
    // sees, so storing it directly would alias every session's entry to one
    // object — and the moment anything records a PER-SESSION fact on an entry
    // (the resolved tree, an item assignment) that fact would leak to every
    // other session in the process. Copying at the boundary makes each entry
    // this map's own, which is what lets resolveSessionTree record onto it.
    register: (sessionID, entry) => {
      registry.set(sessionID, { ...entry });
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
    flushSync: () => {
      // Nothing to flush before a run exists: the stderr sink writes each record
      // as it is made.
      const bound = runJournal;
      if (bound !== null) bound.flushSync();
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

  // §3.7/§3.5's in-memory half, minted ONCE per plugin process: the debounce
  // clock, the one-in-flight latch, the last futility signature, the adjudicated
  // permission ids and the NEEDS_CONTEXT surface queue. It is the sibling of the
  // session registry above and lives exactly as long.
  const continuation = createContinuationState();

  // The out-of-repo §4.2/§2.6 state coordinates. XDG first, then the home volume;
  // the workspace key is a stable digest of the resolved root, so two checkouts of
  // the same project never share a worktree or a quarantine directory (and the
  // digest is a conservative slug, which state.ts assertSafeId requires).
  function stateCoordinates(root: string): { stateHome: string; workspaceKey: string } {
    const xdg = process.env.XDG_STATE_HOME;
    const stateHome = xdg !== undefined && xdg.length > 0 ? xdg : path.join(homedir(), ".local", "state");
    return { stateHome, workspaceKey: createHash("sha256").update(root).digest("hex").slice(0, 16) };
  }

  // §3.5: reconstruct the orchestrator's registry entry from PERSISTED state
  // rather than inventing one. adapter/chat-message.ts writes this entry when a
  // prompt arrives; a plugin instance that inherited a live run (a restart, an
  // event before the first prompt) has no entry yet, and the run itself records
  // whose session it belongs to. The tree is resolved through the ONE derivation
  // both gate seams read (SG-9).
  function seedOrchestratorEntry(ws: Workspace): void {
    let run: Awaited<ReturnType<StateStore["currentRun"]>> = null;
    try {
      run = ws.store.currentRun();
    } catch {
      return;
    }
    if (run === null) return;
    if (!registry.has(run.sessionID)) registry.set(run.sessionID, { role: "orchestrator" });
    resolveSessionTree(ws.store, registry.get(run.sessionID));
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
        ops: amendOps.describe("the §2.4 amendment operations to apply, in order"),
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
      args: {
        reconfigure: S.boolean().optional().describe("re-run setup on an already-configured repo"),
        // §3.4's args table lists `reconfigure` alone, but §2.1:622's two
        // undefaultable answers (and §3.9:1500's no-git choice) have to REACH the
        // handler: a call without them returns the asks and writes nothing, and a
        // call carrying them writes. Tool arguments are not one of the LAW closed
        // vocabularies — no §2 schema, state field or journal event is touched —
        // so this is a recorded plan deviation, raised at the Phase 12 gate.
        answers: S.object({
          gitMode: S.string().optional().describe("§2.1:622 question 1 — the repo's git mode; never defaulted"),
          behavioralPaths: S.array(S.string())
            .optional()
            .describe("§2.1:622 question 2 — the confirmed (or corrected) behavioralPaths"),
          initRepo: S.boolean()
            .optional()
            .describe("§3.9:1500 — true initializes a repo here, false runs in no-git mode"),
        })
          .optional()
          .describe("the human's answers to setup's interactive asks (§6.2:1875)"),
      },
    },
    conductor_forget_stale: {
      description: "Remove a resolved stale-red entry (§2.11) by path.",
      args: { path: S.string().describe("the stale-red entry path to forget") },
    },
  };

  // =========================================================================
  // The handler binding (§3.4). Everything below turns a tool CALL into the one
  // committed adapter/tools.ts handler that serves it, and nothing else: the
  // plugin performs no state transition, runs no verify and writes no ledger of
  // its own. core/tool-bindings.ts is the data table this implements.
  // =========================================================================

  // §3.6's one-shot grant map — root-owned state, the sibling of the session
  // registry above. handleOverride mints a grant into it; the gate hook below
  // spends it. Two maps would leave a granted override unspendable.
  const overrideGrants = new Map<string, OverrideGrant>();

  // §4.4's per-session failover latch. Minted ONCE per plugin process, exactly
  // like the continuation state: it IS the session's latch, and a fresh one per
  // call would forget that the router already failed.
  const failoverState: FailoverState = createFailoverState();

  // §6.4/§3.8: the doctrine packs, loaded ONCE PER DIRECTORY through the committed
  // loader and FAIL-CLOSED. loadPacks names the offending pack in its own message;
  // the failure is reported at error level on the §7.1 sink and re-thrown, so the
  // tools refuse rather than dispatching sub-sessions carrying no doctrine — which
  // is the silent-degradation shape §3.8 exists to forbid.
  //
  // The memo is keyed by the RESOLVED directory rather than by "have we loaded
  // anything yet": the directory is read at call time (doctrineDirOf), so a memo
  // that ignored it would serve one session's packs to a session pointed somewhere
  // else — and would make the failure of a broken override depend on call order.
  let packs: Record<string, string> | null = null;
  let packsDir: string | null = null;
  function ensurePacks(hook: string, sessionID: string): Record<string, string> {
    const doctrineDir = doctrineDirOf();
    if (packs !== null && packsDir === doctrineDir) return packs;
    try {
      packs = loadPacks(doctrineDir);
      packsDir = doctrineDir;
      return packs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      packs = null;
      packsDir = null;
      journal.log(
        "error",
        "state",
        "hook.failed",
        { hook, root: doctrineDir, error: message },
        { sessionID },
      );
      throw err instanceof Error ? err : new Error(message);
    }
  }

  // The §3.5 freeze view, backed by the REAL per-tree verify markers. isFrozen
  // answers from the marker set adapter/evidence.ts enumerates; onClear notices a
  // marker LEAVING that set, which is what releases a write-capable job the
  // fan-out engine is holding. A constant `false` here would make freeze
  // admission dead on the driver side exactly as a hardcoded verifyInFlightTree
  // does on the gate side — the same defect twice (CR-SG-3).
  //
  // The two seams speak different tree types (C-037 ruling 5): the marker's name
  // is a SLUG ("main" | "<itemId>") while a fan-out job's tree is the PATH the
  // edit gate compares by string equality. verifyInFlightTreeFor is the committed
  // translation, and both the frozen test and the clear notification run through
  // it so a worktree freeze cannot fire on one side only.
  interface PluginTreeState extends WaveTreeState {
    stop: () => void;
  }

  function createTreeState(store: StateStore, runId: string): PluginTreeState {
    const runDir = runDirOf(store.root, runId);
    const listeners = new Set<(tree: string) => void>();
    let timer: ReturnType<typeof setInterval> | null = null;

    const snapshot = (): Set<string> =>
      runId.length === 0 ? new Set<string>() : new Set(liveVerifyTrees(runDir));

    // `live` is owned by the poll alone. isFrozen deliberately does NOT refresh
    // it: a marker whose disappearance were absorbed by an admission check would
    // never be announced, and the held job it was holding would wait forever.
    let live = snapshot();

    const pathOf = (slug: string): string | null => {
      try {
        return verifyInFlightTreeFor(store, runId, slug);
      } catch {
        return null;
      }
    };

    const namesOf = (slug: string): string[] => {
      const translated = pathOf(slug);
      return translated === null || translated === slug ? [slug] : [slug, translated];
    };

    const announce = (tree: string): void => {
      for (const listener of [...listeners]) listener(tree);
    };

    const poll = (): void => {
      const next = snapshot();
      const cleared: string[] = [];
      for (const slug of live) if (!next.has(slug)) cleared.push(slug);
      live = next;
      for (const slug of cleared) for (const name of namesOf(slug)) announce(name);
    };

    const stopTimer = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    return {
      isFrozen: (tree: string): boolean => {
        for (const slug of snapshot()) {
          if (slug === tree || pathOf(slug) === tree) return true;
        }
        return false;
      },
      onClear: (listener: (tree: string) => void): (() => void) => {
        listeners.add(listener);
        if (timer === null) {
          timer = setInterval(poll, MARKER_POLL_MS);
          // A watcher must never be the reason a process stays alive.
          if (typeof timer.unref === "function") timer.unref();
        }
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) stopTimer();
        };
      },
      // The DRIVER's own release: a stage that finished has done whatever it was
      // going to do to its tree, so the view is told without waiting for a poll.
      notifyClear: (tree: string): void => {
        live = snapshot();
        announce(tree);
      },
      stop: (): void => {
        listeners.clear();
        stopTimer();
      },
    };
  }

  // =========================================================================
  // THE §3.5 GATE SNAPSHOT. The three facts core/gates-edit.ts judges an edit
  // against that only the composition root can know — the calling session's two
  // §2.4 item scopes, and the tree a verify has frozen. Each is derived PER CALL
  // from live state, beside the gitMode / branchPolicy / inlineClaimScope
  // derivations the same seam already carried.
  // =========================================================================

  interface GateScopes {
    fileScope: string[];
    testScope: string[];
  }

  // FAIL CLOSED. A session with no registry entry, no itemId, no live run, or an
  // item whose queue entry will not load derives NO scope — and no scope denies
  // every edit, which is the safe direction. The permissive alternative is the
  // exact mutation the phase-13 gate ran (both scopes widened to ["**"]) with the
  // whole build staying green, because nothing in production could reach the arms.
  const NO_GATE_SCOPE: GateScopes = { fileScope: [], testScope: [] };

  // The scopes the calling session is judged by: its §3.5 registry entry names an
  // item, and that item's PERSISTED §2.4 fileScope / testScope are the scope. Read
  // off the SAME entry the hook resolves the tree onto (never a second copy), or
  // the gate would scope a path against one item and normalize it against
  // another's tree.
  function gateScopesFor(ws: Workspace | null, sessionID: string): GateScopes {
    if (ws === null) return NO_GATE_SCOPE;
    const itemId = registry.get(sessionID)?.itemId;
    if (itemId === undefined || itemId.length === 0) return NO_GATE_SCOPE;
    try {
      const run = ws.store.currentRun();
      if (run === null) return NO_GATE_SCOPE;
      // queue.json is where §2.4 persists the two scopes — the runtime item file
      // carries the FSM position and the worktree, not the scope — and it is read
      // through the handlers' OWN committed reader, so the gate and every stage
      // tool validate that file against one schema rather than two.
      const queue = readQueueJson(runDirOf(ws.store.root, run.runId), "the edit gate");
      const entry = queue.items.find((candidate) => candidate.id === itemId);
      if (entry === undefined) return NO_GATE_SCOPE;
      return { fileScope: [...entry.fileScope], testScope: [...entry.testScope] };
    } catch {
      return NO_GATE_SCOPE;
    }
  }

  // Trailing slashes and nothing else: core/gates-edit.ts:196-198 compares the
  // frozen tree to the session's tree by string equality after stripping exactly
  // those, so the SELECTION below tolerates exactly what that comparison does.
  // gates-edit stays the authority on the decision; this only chooses WHICH live
  // marker's tree is put in front of it.
  function sameTree(a: string, b: string): boolean {
    const strip = (value: string): string => {
      let end = value.length;
      while (end > 0 && value[end - 1] === "/") end -= 1;
      return value.slice(0, end);
    };
    return strip(a) === strip(b);
  }

  // The tree a LIVE verify has frozen, in the terms core/gates-edit.ts:196-198
  // reads it: a PATH, compared to the calling session's own tree. Two committed
  // translations stand between the marker file and that comparison and neither is
  // re-derived here — adapter/evidence.ts liveVerifyTrees applies the verify
  // path's OWN liveness rule (a dead pid or an over-age marker is not live, so a
  // crashed run can never wedge a tree), and adapter/tools.ts verifyInFlightTreeFor
  // is the C-037 ruling-5 slug->path translation whose own doc comment names this
  // seam as its obligation.
  //
  // It is a TREE COMPARISON, not a global "something is verifying" flag: a session
  // editing in a DIFFERENT tree while a marker is live elsewhere stays allowed. So
  // this hands over the live tree that IS this session's, and null when none is.
  function freezeTreeFor(
    ws: Workspace | null,
    sessionID: string,
    sessionTree: string,
  ): string | null {
    if (ws === null || sessionTree.length === 0) return null;
    let runId: string;
    try {
      const run = ws.store.currentRun();
      if (run === null) return null;
      runId = run.runId;
    } catch {
      return null;
    }
    for (const slug of liveVerifyTrees(runDirOf(ws.store.root, runId))) {
      let treePath: string | null;
      try {
        treePath = verifyInFlightTreeFor(ws.store, runId, slug);
      } catch {
        // A live marker whose slug will not translate cannot be ruled OUT of this
        // session's tree, so it freezes it: fail closed, the direction §3.5's
        // strict reading takes everywhere else.
        return sessionTree;
      }
      // null is the committed answer for an item with no worktree — "no path can
      // be frozen for it" — not a failure, so it rules that marker OUT.
      if (treePath === null) continue;
      if (sameTree(treePath, sessionTree)) return treePath;
    }
    return null;
  }

  // THE dependency bundle. adapter/tools.ts:7304-7311 says in its own words why
  // the handler inputs are uniform — "so the composition root can call every
  // handler alike" — so this is assembled ONCE per invocation and SPREAD into
  // every handler input. Adding a field every handler takes is an edit to this
  // one construction site, not to twenty-one call sites.
  interface ToolDeps {
    store: StateStore;
    fanout: Fanout;
    treeState: WaveTreeState;
    runId: string;
    config: Config;
    journal: RebindableJournal;
    stateHome: string;
    workspaceKey: string;
    packs: Record<string, string>;
    overrideGrants: Map<string, OverrideGrant>;
    sessionID: string;
  }

  interface Assembled {
    deps: ToolDeps;
    entry: RegistryEntry | undefined;
    release: () => void;
  }

  function refuse(message: string): Error {
    return new Error(message);
  }

  // CR-SG-1: a stage tool needs a live run, and store.currentRun() can legitimately
  // return null (a fresh repo, an archived run). The refusal names the tool and the
  // legal next action; it never fabricates a run id, never creates a run as a side
  // effect of a stage tool, and never lets a null reach a handler as an empty string.
  function noRunRefusal(name: string): Error {
    return refuse(
      `${name}: there is no live conductor run in this workspace, so there is no run state for ` +
        "this tool to advance. A run is created when the orchestrator receives a prompt (§3.2) — " +
        "send one to start work, or call conductor_status to see what this workspace already " +
        `holds. ${name} creates no run of its own and has written nothing.`,
    );
  }

  function assemble(name: string, sessionID: string, needsRun: boolean): Assembled {
    const hook = `tool:${name}`;
    const ws = ensureWorkspace(sessionID, hook);
    if (ws === null) {
      throw refuse(
        `${name}: this workspace could not be opened, so conductor can neither read nor write ` +
          "any of its state; the open failure was reported at error level on the §7.1 sink with " +
          "its root and errno. Fix the workspace (or its permissions) and call the tool again.",
      );
    }

    // The registry entry the gate hook reads is the one this call must read too —
    // never a second copy (SG-9).
    seedOrchestratorEntry(ws);
    resolveSessionTree(ws.store, registry.get(sessionID));

    let run: Awaited<ReturnType<StateStore["currentRun"]>> = null;
    try {
      run = ws.store.currentRun();
    } catch {
      run = null;
    }
    // A tool that finds a live run must bind the journal to it, or its own records
    // land on the §7.1 stderr sink instead of that run's journal.jsonl.
    if (run !== null && liveRunId !== run.runId) bindRunJournal(ws.root, ws.config, run.runId);
    if (run === null && needsRun) throw noRunRefusal(name);

    const runId = run === null ? "" : run.runId;
    const loadedPacks = ensurePacks(hook, sessionID);
    const coords = stateCoordinates(ws.root);
    const treeState = createTreeState(ws.store, runId);
    // The REAL engine over the opencode SDK client, built with the plugin's ONE
    // registry so the sub-sessions it dispatches are visible to the gate hook that
    // must honour them — the same cast the event hook below uses for the same client.
    const fanout = createFanout(
      input.client as unknown as FanoutClient,
      ws.config,
      journal,
      registry as unknown as FanoutRegistry,
      treeState,
      runId,
    );

    return {
      deps: {
        store: ws.store,
        fanout,
        treeState,
        runId,
        config: ws.config,
        journal,
        stateHome: coords.stateHome,
        workspaceKey: coords.workspaceKey,
        packs: loadedPacks,
        overrideGrants,
        sessionID,
      },
      entry: registry.get(sessionID),
      release: () => {
        treeState.stop();
      },
    };
  }

  // CR-SG-2: the declared args are the model's to supply, and the composition root
  // may not invent one. Required-ness comes from the SAME zod shapes the tool map
  // registers (schema.isOptional()), so a spec and its enforcement cannot drift.
  function requireDeclaredArgs(name: string, args: Record<string, unknown>): void {
    const shape = (specs[name]?.args ?? {}) as Record<string, unknown>;
    const missing: string[] = [];
    for (const [field, schema] of Object.entries(shape)) {
      const isOptional = (schema as { isOptional?: unknown }).isOptional;
      if (typeof isOptional === "function" && (isOptional as () => boolean).call(schema)) continue;
      const value = args[field];
      if (value === undefined || value === null) missing.push(field);
    }
    if (missing.length === 0) return;
    const named = missing.map((field) => `"${field}"`).join(", ");
    throw refuse(
      `${name}: required argument${missing.length > 1 ? "s" : ""} ${named} ` +
        `${missing.length > 1 ? "were" : "was"} not supplied. Conductor's composition root never ` +
        "invents a value its caller was supposed to give it (C-047: a fabricated argument makes a " +
        `tool that cannot succeed), so this call is refused rather than run against a default — ` +
        `re-issue ${name} with ${named} set.`,
    );
  }

  // A declared argument read at its declared type. A value of the WRONG type is
  // refused for the same reason a missing one is: substituting "" or [] would hand
  // the handler a value the caller never gave it, which is the fabrication CR-SG-2
  // forbids — and an empty string reaching a stage handler as an itemId is exactly
  // the "null propagating into a handler" shape the no-run row names.
  function wrongType(name: string, field: string, expected: string, value: unknown): Error {
    return refuse(
      `${name}: argument "${field}" must be ${expected}, but the call supplied ` +
        `${value === undefined ? "nothing" : JSON.stringify(value)}. Conductor refuses rather ` +
        `than coercing it to an empty value the caller never gave — re-issue ${name} with ` +
        `"${field}" as ${expected}.`,
    );
  }

  function stringArg(name: string, args: Record<string, unknown>, field: string): string {
    const value = args[field];
    if (typeof value !== "string") throw wrongType(name, field, "a string", value);
    return value;
  }

  function stringsArg(name: string, args: Record<string, unknown>, field: string): string[] {
    const value = args[field];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw wrongType(name, field, "an array of strings", value);
    }
    return value as string[];
  }

  // conductor_queue_amend's `ops` is the one argument that is not already the type
  // its handler's field is: what arrives is whatever the model sent, and
  // QueueAmendInput.ops is core's closed add/update/remove union. The narrowing is
  // core/queue-amend.ts parseAmendOps' — the committed, separately tested widener
  // that owns the vocabulary — so the root CALLS it and refuses with its verdict,
  // which already names the offending position. Casting instead would let a
  // malformed op through as though it were a union member, which is the one thing
  // the composition root may never do.
  function amendOpsArg(args: Record<string, unknown>): QueueAmendInput["ops"] {
    const value = args.ops;
    if (!Array.isArray(value)) {
      throw wrongType("conductor_queue_amend", "ops", "an array of §2.4 amendment ops", value);
    }
    // parseAmendOps reads one JSON object per element, which is also the form a
    // model that stringifies its structure sends. An op that arrived as a value is
    // rendered back to that text; nothing about it is added or dropped on the way.
    const asJson = value.map((entry) =>
      typeof entry === "string" ? entry : (JSON.stringify(entry) ?? "null"),
    );
    const parsed = parseAmendOps(asJson);
    if (!parsed.ok) throw refuse(`conductor_queue_amend: ${parsed.why}`);
    return parsed.ops;
  }

  // The tools that are legal with no live run: §2.11's stale-red registry precedes
  // every run, and conductor_status is read-only and legal in every state.
  const RUNLESS_TOOLS: readonly string[] = ["conductor_status", "conductor_forget_stale"];

  // One entry per §3.4 name. Every body reaches the COMMITTED handler and spreads
  // the ONE bundle into it; what each adds is only what the model supplied.
  type BoundTool = (args: Record<string, unknown>, assembled: Assembled) => Promise<unknown>;

  const bound: Record<string, BoundTool> = {
    conductor_classify: async (_args, { deps }) => handleClassify({ ...deps }),
    conductor_decompose: async (_args, { deps }) => handleDecompose({ ...deps }),
    conductor_plan: async (_args, { deps }) => handlePlan({ ...deps }),
    conductor_plan_review: async (_args, { deps }) => handlePlanReview({ ...deps }),
    conductor_dispatch_wave: async (_args, { deps }) => handleDispatchWave({ ...deps }),
    conductor_submit_test: async (args, { deps }) =>
      handleSubmitTest({ ...deps, itemId: stringArg("conductor_submit_test", args, "itemId") }),
    conductor_vet_test: async (args, { deps }) =>
      handleVetTest({ ...deps, itemId: stringArg("conductor_vet_test", args, "itemId") }),
    conductor_mark_green: async (args, { deps }) =>
      handleMarkGreen({ ...deps, itemId: stringArg("conductor_mark_green", args, "itemId") }),
    conductor_validate: async (args, { deps }) =>
      handleValidate({ ...deps, itemId: stringArg("conductor_validate", args, "itemId") }),
    conductor_item_review: async (args, { deps }) =>
      handleItemReview({ ...deps, itemId: stringArg("conductor_item_review", args, "itemId") }),
    conductor_publish: async (args, { deps }) =>
      handlePublish({ ...deps, itemId: stringArg("conductor_publish", args, "itemId") }),
    conductor_report: async (_args, { deps }) => handleReport({ ...deps }),
    conductor_surface: async (args, { deps, entry }) =>
      handleSurface({
        ...deps,
        question: stringArg("conductor_surface", args, "question"),
        blocksItems: stringsArg("conductor_surface", args, "blocksItems"),
        // Caller identity, not a model-supplied argument: the §3.5 registry is
        // what says which role this session speaks as.
        askedBy: { role: entry?.role ?? "orchestrator", sessionID: deps.sessionID },
        ...(typeof args.humanTerritory === "boolean"
          ? { humanTerritory: args.humanTerritory }
          : {}),
      }),
    conductor_answer: async (args, { deps }) =>
      handleAnswer({
        ...deps,
        questionId: stringArg("conductor_answer", args, "questionId"),
        answer: stringArg("conductor_answer", args, "answer"),
      }),
    conductor_defer: async (args, { deps }) =>
      handleDefer({
        ...deps,
        itemId: stringArg("conductor_defer", args, "itemId"),
        reason: stringArg("conductor_defer", args, "reason"),
      }),
    conductor_decide: async (args, { deps }) =>
      handleDecide({
        ...deps,
        question: stringArg("conductor_decide", args, "question"),
        options: args.options as DecideInput["options"],
        choice: stringArg("conductor_decide", args, "choice"),
        why: stringArg("conductor_decide", args, "why"),
        appliedWhere: stringArg("conductor_decide", args, "appliedWhere"),
        // C-044: §2.7 reserves "human" for a decision that was ASKED of a human,
        // and a decision recorded through a tool call was not (the path that
        // carries a human's answer is conductor_answer).
        kind: "derived",
      }),
    conductor_queue_amend: async (args, { deps }) =>
      handleQueueAmend({
        ...deps,
        ops: amendOpsArg(args),
        question: stringArg("conductor_queue_amend", args, "question"),
        options: args.options as DecideInput["options"],
        choice: stringArg("conductor_queue_amend", args, "choice"),
        why: stringArg("conductor_queue_amend", args, "why"),
        appliedWhere: stringArg("conductor_queue_amend", args, "appliedWhere"),
      }),
    conductor_inline_claim: async (args, { deps }) =>
      handleInlineClaim({
        ...deps,
        itemId: stringArg("conductor_inline_claim", args, "itemId"),
        reason: stringArg("conductor_inline_claim", args, "reason"),
        options: args.options as DecideInput["options"],
        choice: stringArg("conductor_inline_claim", args, "choice"),
      }),
    conductor_override: async (args, { deps, entry }) => {
      // §3.6's budget is spent BY an item's session, and which item that is comes
      // from the registry — the root reads it, it does not ask the model for it.
      const itemId = entry?.itemId;
      if (itemId === undefined || itemId.length === 0) {
        throw refuse(
          "conductor_override: this session carries no conductor item assignment, so there is no " +
            "item whose §2.1 override budget could be spent and no item to taint. The override " +
            "hatch is spent by the session working the item it applies to (§3.6).",
        );
      }
      return handleOverride({
        ...deps,
        itemId,
        gate: stringArg("conductor_override", args, "gate"),
        reason: stringArg("conductor_override", args, "reason"),
        grantedAction: stringArg("conductor_override", args, "grantedAction"),
      });
    },
    conductor_status: async (_args, { deps }) => {
      // Legal in every state, including before any run exists. The absence of a
      // run is reported, never invented: there is no runId to hand the handler.
      if (deps.runId.length === 0) {
        const runless: RunlessStatus = {
          runId: null,
          state: null,
          classification: null,
          items: [],
          openQuestions: [],
        };
        return runless;
      }
      return handleStatus({ ...deps });
    },
    // The ONE name with no handleX handler. Bound to the committed store method
    // and to nothing else — the registry's read-modify-write is state.ts's.
    conductor_forget_stale: async (args, { deps }) => {
      const entryPath = stringArg("conductor_forget_stale", args, "path");
      return { forgot: entryPath, registry: deps.store.removeStaleRed(entryPath) };
    },
  };

  // conductor_setup is the ONE tool that takes no store, no runId and no fan-out
  // (adapter/tools.ts:8141-8156): §2.3's OpenOptions needs the very Config setup is
  // producing, so the first-run path cannot go through openWorkspace at all. Its
  // input is built from the RESOLVED workspace root and the §12 session env, never
  // from placeholders, and it runs in a repo with no .conductor/ whatsoever.
  async function runSetup(args: Record<string, unknown>): Promise<unknown> {
    let root = input.directory;
    try {
      root = realpathSync(input.directory);
    } catch {
      // An unresolvable directory is still the caller's directory; setup's own
      // detection is what reports what is (and is not) there.
    }
    const setupInput: SetupInput = {
      root,
      journal,
      router: {
        listen: originOf(process.env[ENV_ROUTER_URL], DEFAULT_ROUTER_PORT),
        probeTimeoutMs: ROUTER_PROBE_TIMEOUT_MS,
      },
      upstream: originOf(process.env[ENV_UPSTREAM_URL], DEFAULT_UPSTREAM_PORT),
      failoverState,
      ...(typeof args.reconfigure === "boolean" ? { reconfigure: args.reconfigure } : {}),
      ...(args.answers === undefined || args.answers === null
        ? {}
        : { answers: args.answers as SetupInput["answers"] }),
      ...(typeof process.env[ENV_MODEL_ID] === "string"
        ? { modelId: process.env[ENV_MODEL_ID] }
        : {}),
    };
    // Setup's own legality refusals (§3.4: an already-configured repo without
    // reconfigure, a live run) reach the caller the way every other tool's refusal
    // does — by THROWING, which is what opencode reads back to the model. A refusal
    // RETURNED as data reads as a successful call whose result happens to say no.
    return handleSetup(setupInput);
  }

  // The ONE body every registered tool executes. Argument legality first (a
  // refusal, never a default), then the bundle, then the committed handler.
  async function runTool(name: string, rawArgs: unknown, context: unknown): Promise<string> {
    const args = argsOf(rawArgs);
    const sessionID = sessionIdOf(context);
    requireDeclaredArgs(name, args);
    if (name === "conductor_setup") return JSON.stringify(await runSetup(args));

    const run = bound[name];
    if (run === undefined) {
      throw refuse(
        `${name} is registered in the §3.4 inventory but no handler binding is declared for it; ` +
          "conductor refuses the call rather than pretending the stage ran.",
      );
    }
    const assembled = assemble(name, sessionID, !RUNLESS_TOOLS.includes(name));
    try {
      return JSON.stringify(await run(args, assembled));
    } finally {
      assembled.release();
    }
  }

  // Build the `tool` map FROM the inventory so its keys are exactly
  // CONDUCTOR_TOOL_NAMES — a renamed or forgotten tool cannot slip through.
  const toolMap: Record<string, ToolDefinition> = {};
  for (const name of CONDUCTOR_TOOL_NAMES) {
    const spec = specs[name] ?? { description: `Conductor tool ${name}.`, args: {} };
    toolMap[name] = tool({
      description: spec.description,
      args: spec.args,
      execute: async (rawArgs: unknown, context: unknown): Promise<string> =>
        runTool(name, rawArgs, context),
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

      // §3.6: the SAME claim derivation the ask-gate reads. Hardcoding null here
      // denied a claimed orchestrator edit at this seam BEFORE the permission ask
      // was ever raised, which made the ask-gate's allow path dead code and
      // conductor_inline_claim inoperative end to end. The tree is resolved
      // through the same one helper, so neither seam can judge a path against a
      // different tree than the other.
      let inlineClaimScope: string[] | null = null;
      let sessionTree = "";
      if (ws !== null) {
        sessionTree = resolveSessionTree(ws.store, registry.get(hook.sessionID));
        try {
          const run = ws.store.currentRun();
          if (run !== null) inlineClaimScope = activeInlineClaimScope(ws.store, run.runId);
        } catch {
          inlineClaimScope = null; // fail closed: no claim derived, no edit allowed
        }
      }

      // §3.5's other two derivations, from the SAME registry entry the tree above
      // was resolved onto: the item's persisted §2.4 scopes, and the tree a live
      // verify marker has frozen. Both fail closed — no entry, no item, no run
      // derives no scope, which denies.
      const scopes = gateScopesFor(ws, hook.sessionID);
      const verifyFreezeTree = freezeTreeFor(ws, hook.sessionID, sessionTree);

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
        fileScope: scopes.fileScope,
        testScope: scopes.testScope,
        verifyInFlightTree: verifyFreezeTree,
        inlineClaimScope,
        // §3.6: the ONE grant map conductor_override mints into. A second map
        // here would leave every granted override unspendable.
        overrideGrants,
        journal,
        corr,
      });
    },

    // Thin bus hook: the §3.7 idle engine and the §3.5(b)/§3.6 ask-gate both hang
    // off the `permission.asked` / `session.idle` BUS events (adapter/wire-notes.md:32
    // — the typed `permission.ask` PLUGIN hook is never dispatched at 1.18.15), so
    // this body parses nothing and decides nothing: it hands the whole event to the
    // ONE adapter router, exactly as tool.execute.before delegates to
    // gateBeforeToolCall. The router never throws (G5).
    event: async (hook) => {
      const properties =
        hook.event !== null && typeof hook.event === "object" && "properties" in hook.event
          ? ((hook.event as { properties?: unknown }).properties as Record<string, unknown> | undefined)
          : undefined;
      const sessionID = typeof properties?.sessionID === "string" ? properties.sessionID : "";
      const ws = ensureWorkspace(sessionID, "event");
      if (ws === null) return; // the open failure was already reported, loudly
      seedOrchestratorEntry(ws);
      const coords = stateCoordinates(ws.root);
      await handlePluginEvent({
        event: { type: hook.event.type, properties },
        store: ws.store,
        state: continuation,
        registry,
        client: input.client as unknown as ContinuationClient,
        config: ws.config,
        journal,
        stateHome: coords.stateHome,
        workspaceKey: coords.workspaceKey,
        now: Date.now,
      });
    },
  };
};
