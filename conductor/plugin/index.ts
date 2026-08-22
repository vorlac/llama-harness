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

import { composeSessionBanner } from "../core/banner.ts";
import { handleChatMessage } from "../adapter/chat-message.ts";
import type { SessionRegistry, SessionRegistryEntry } from "../adapter/chat-message.ts";
import {
  activeInlineClaimScope,
  createContinuationState,
  handlePluginEvent,
  resolveSessionTree,
  runTestScopes,
} from "../adapter/continuation.ts";
import type { ContinuationClient } from "../adapter/continuation.ts";
import { DEFAULT_CONFIG, loadConfig } from "../adapter/config-io.ts";
import { createMonotonicClock } from "../adapter/clock.ts";
import { liveVerifyTrees } from "../adapter/evidence.ts";
import { createFanout } from "../adapter/fanout.ts";
import type {
  Fanout,
  FanoutClient,
  SessionRegistry as FanoutRegistry,
} from "../adapter/fanout.ts";
import { composeDelivery, loadPacks } from "../adapter/inject.ts";
import type { Delivery, DeliveryState } from "../adapter/inject.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { isRepo } from "../adapter/gitio.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFailoverState } from "../adapter/router-client.ts";
import type { FailoverState } from "../adapter/router-client.ts";
import { isWorkspaceLocked, openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import {
  classifyTool,
  CONDUCTOR_TOOL_NAMES,
  ensureTerminalReport,
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
  requireToolLegal,
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
import type { GateItem, GateQuestion } from "../core/gates-phase.ts";
import { AMEND_OP_KINDS, parseAmendOps } from "../core/queue-amend.ts";
import { callerAllowed } from "../core/tool-legality.ts";
import { NO_TREE } from "../core/types.ts";
import type { Config, Item, LogLevel, TreePath, TreeSlug } from "../core/types.ts";

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
    // §6.4/§3.8 ORDERING, before anything is opened: the doctrine packs load
    // FIRST, so openWorkspace's §3.8 liveness beacon is written only for a
    // workspace whose doctrine can actually be delivered. Written the other way
    // round the beacon appeared, a run was created and edits were gated — work had
    // begun — while the pack failure waited for the first stage tool, which made
    // the ONE observability contract §3.8 offers against conductor's own absence
    // weaker than it reads (ISSUE-004). ensurePacks has already reported the
    // failure at error level on the §7.1 sink and NAMED the pack, so this returns
    // null the same way an unopenable root does: the callers that must adjudicate
    // anyway (the gate hook) fall back to their strictest defaults, and the ones
    // that would start work (chat.message, the stage tools) do not.
    try {
      ensurePacks(hook, sessionID);
    } catch {
      return null;
    }
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
      // GAP-024: every terminal run leaves the §2.9 artifact. A conductor that was
      // killed mid-run wrote neither a stop nor a report, so the run directory it
      // left says nothing about what happened to the work; this sweep writes the
      // artifact naming the run's disposition the moment the workspace is opened
      // again. Fail-soft, and never before the store exists: a sweep that threw
      // here would take down the open it is meant to follow.
      try {
        ensureTerminalReport({ store, journal });
      } catch {
        // The artifact is a courtesy the open does not depend on.
      }
      return workspace;
    } catch (err) {
      // GAP-027 / owner decision D6: a workspace already held by a live conductor
      // is not an incidental open failure. It gets its own ERROR-level record
      // naming the holder — the §7.1 console sink's default level is warn, so this
      // reaches the operator's stderr — rather than being reported as an errno the
      // reader would have to decode. The session still survives (G5 fail-soft): the
      // second conductor simply does no conductor-side work in this workspace.
      if (isWorkspaceLocked(err)) {
        journal.log(
          "error",
          "state",
          "lock.contended",
          {
            hook,
            root,
            holderPid: err.holder.pid,
            holderStartMs: err.holder.startMs,
            ...(err.holder.sessionID === undefined ? {} : { holderSessionID: err.holder.sessionID }),
            error: err.message,
          },
          { sessionID },
        );
        return null;
      }
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
      description:
        "Dispatch the classifier and its skeptic over the run's intake, re-check their verdict against " +
        "the objective bounds, and advance INTAKE.",
      args: {},
    },
    conductor_decompose: {
      description:
        "Dispatch a planner that proposes the item queue (DAG, scopes, sizes); this validates the " +
        "proposal against §2.4 and persists queue.json and the items.",
      args: {},
    },
    conductor_plan: {
      description:
        "Dispatch a planner that authors plan.md and its decision records; this writes them to the run " +
        "directory and advances to PLANNED.",
      args: {},
    },
    conductor_plan_review: {
      description: "Run the plan-review fan-out with verdicts and the revision loop.",
      args: {},
    },
    conductor_dispatch_wave: {
      description:
        "Compute the next wave and drive each member's item pipeline concurrently, dispatching the " +
        "sub-sessions each stage calls for.",
      args: {},
    },
    conductor_submit_test: {
      description:
        "Dispatch a test-writer sub-session that WRITES the item's failing test into its testScope, then " +
        "run that test and assert a legal red (behavioral); PENDING to RED. The orchestrator does not " +
        "author the test — this call does.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_vet_test: {
      description: "Run the test-critic fan-out and record verdicts; RED to TEST_VETTED.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_mark_green: {
      description:
        "Dispatch an implementer sub-session that writes the item's change into its fileScope, then " +
        "confirm the item's test passes; advance to GREEN.",
      args: { itemId: S.string().describe("the queue item id") },
    },
    conductor_validate: {
      description:
        "Run the quarantined, start/HEAD-stamped full verify, dispatching a debug-fix implementer for as " +
        "long as it stays red and the fix budget lasts; GREEN to VALIDATED.",
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
      description:
        "Record an inline claim scoping orchestrator edit permission to an item's fileScope (§3.6). " +
        "Legal on a non-behavioral item, and on a behavioral item from RED onward. A behavioral item " +
        "at PENDING is REFUSED: the red it owes is written into testScope, which a claim never grants " +
        "— call conductor_submit_test there.",
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
          acknowledgeNoTdd: S.boolean()
            .optional()
            .describe(
              "GAP-015 — configure a behavioralPaths list that covers none of this repo's " +
                "detected source anyway; without it setup refuses such a list, because it " +
                "turns RED-before-GREEN off for every item",
            ),
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

  // §3.8 banner state, per plugin process. `bannered` is the once-per-session
  // latch; `pendingStaleReport` holds the §2.11 exclusions handleChatMessage
  // computes at intake until a tool result exists to carry them, because the
  // chat.message hook returns void to opencode and has no channel of its own.
  // `sessionModel` is the RESOLVED model, observed on the request rather than
  // read from config: a run against unintended weights is exactly what the
  // banner has to be able to show.
  const bannered = new Set<string>();
  const pendingStaleReport = new Map<string, string>();
  const sessionModel = new Map<string, string>();

  // §4.4's per-session failover latch. Minted ONCE per plugin process, exactly
  // like the continuation state: it IS the session's latch, and a fresh one per
  // call would forget that the router already failed.
  const failoverState: FailoverState = createFailoverState();

  // GAP-035: ONE monotonic time source per plugin process, handed to every handler
  // through the dependency bundle below. Minted once for the same reason the
  // failover latch is: stamps only order events against each other if they come out
  // of the same source. The §2.6 freshness rule and §3.3's stale-red rule are
  // COMPARISONS between stamps, and a truncated wall-clock read leaves two events
  // inside one millisecond indistinguishable — which decides those verdicts by
  // machine load rather than by what happened (P14).
  const monotonicNow = createMonotonicClock();

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
    const listeners = new Set<(tree: TreePath) => void>();
    let timer: ReturnType<typeof setInterval> | null = null;

    const snapshot = (): Set<TreeSlug> =>
      runId.length === 0 ? new Set<TreeSlug>() : new Set(liveVerifyTrees(runDir));

    // `live` is owned by the poll alone. isFrozen deliberately does NOT refresh
    // it: a marker whose disappearance were absorbed by an admission check would
    // never be announced, and the held job it was holding would wait forever.
    let live = snapshot();

    // The ONE direction this view ever speaks in: a job's tree is a PATH, so a
    // marker's SLUG is translated before it is compared to one or announced as
    // one. A slug that translates to nothing freezes no path and releases none —
    // an item with no worktree has no tree of its own to hold.
    const pathOf = (slug: TreeSlug): TreePath | null => {
      try {
        return verifyInFlightTreeFor(store, runId, slug);
      } catch {
        return null;
      }
    };

    const announce = (tree: TreePath): void => {
      for (const listener of [...listeners]) listener(tree);
    };

    const poll = (): void => {
      const next = snapshot();
      const cleared: TreeSlug[] = [];
      for (const slug of live) if (!next.has(slug)) cleared.push(slug);
      live = next;
      for (const slug of cleared) {
        const treePath = pathOf(slug);
        if (treePath !== null) announce(treePath);
      }
    };

    const stopTimer = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    return {
      isFrozen: (tree: TreePath): boolean => {
        for (const slug of snapshot()) {
          if (pathOf(slug) === tree) return true;
        }
        return false;
      },
      onClear: (listener: (tree: TreePath) => void): (() => void) => {
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
      notifyClear: (tree: TreePath): void => {
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
    try {
      const run = ws.store.currentRun();
      if (run === null) return NO_GATE_SCOPE;
      // A session bound to NO item is the orchestrator seat. It gets no fileScope
      // — §3.6 adjudicates its edits through the inline claim the hook derives
      // beside this — and the run's §2.4 testScopes, which is what lets a G8
      // refusal over a test path name conductor_submit_test instead of offering a
      // claim §2.4 makes incapable of covering one. Fed from the ONE derivation
      // the ask-gate reads, so the two orchestrator seams cannot disagree about
      // which paths belong to a test-writer.
      if (itemId === undefined || itemId.length === 0) {
        return { fileScope: [], testScope: runTestScopes(ws.store, run.runId) };
      }
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
    sessionTree: TreePath,
  ): TreePath | null {
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
      let treePath: TreePath | null;
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

  // =========================================================================
  // §6.4 THE INJECTION LAYER — the three hooks below are the ONLY way doctrine,
  // the live state block, the §4.1 sampling and the §4.4 router tags reach a
  // session. adapter/inject.ts composes them; this is where they are registered.
  // =========================================================================

  // §3.9 publish availability, RE-DERIVED on every delivery, from the same
  // gitio.isRepo(root) predicate the stage gate and the report call at their own
  // call sites. It is a property of the workspace as it stands, not of the process:
  // conductor_setup's `initialize a repo here` answer runs git init from the
  // handler mid-process, and a value cached before it would keep every later state
  // block reporting a run that cannot publish while the gate, reading fresh, keeps
  // offering conductor_publish on the same item. One question, one derivation.
  //
  // The cost is one `git rev-parse` per delivery, on a path that already reads
  // run.json, queue.json, every item file and questions.jsonl off disk to describe
  // the run at all.
  function publishEnabledFor(ws: Workspace): boolean {
    try {
      return isRepo(ws.root);
    } catch {
      // Fail closed on the state block's terms: a workspace whose git status
      // cannot be read must not have conductor_publish recommended into it (C-054).
      return false;
    }
  }

  // The persisted snapshot the live state block reports, read through the SAME
  // committed readers every other consumer uses (readQueueJson for §2.4 scopes,
  // store.loadItem for the FSM position, readQuestions for the §2.11 ledger) — a
  // second reader here would let the block describe a run the gates do not see.
  // Returns null when there is no live run: §3.2 creates one on the orchestrator's
  // first prompt, and until then there is nothing to describe.
  function deliveryStateFor(ws: Workspace): DeliveryState | null {
    let run: Awaited<ReturnType<StateStore["currentRun"]>> = null;
    try {
      run = ws.store.currentRun();
    } catch {
      return null;
    }
    if (run === null) return null;
    const runDir = runDirOf(ws.store.root, run.runId);

    // A run before conductor_decompose has no queue.json at all, and a torn one is
    // a repair job for the stage tools — not a reason to strip a session of its
    // doctrine. Either way the block reports the run with no items rather than
    // nothing at all.
    const items: GateItem[] = [];
    let taintCount = 0;
    try {
      const queue = readQueueJson(runDir, "the §6.4 injection layer");
      for (const entry of queue.items) {
        let item: Item;
        try {
          item = ws.store.loadItem(run.runId, entry.id);
        } catch {
          continue;
        }
        taintCount += item.taint.length;
        items.push({
          id: entry.id,
          state: item.state,
          behavioral: entry.behavioral,
          dependsOn: [...entry.dependsOn],
          fileScope: [...entry.fileScope],
          blocked: item.blocked === null ? null : { reason: item.blocked.reason },
          deferred: item.deferred === null ? null : { reason: item.deferred.reason },
          debugging: item.debugging !== null,
        });
      }
    } catch {
      // no queue yet, or an unreadable one: the run is still real
    }

    let questions: GateQuestion[] = [];
    try {
      questions = readQuestions(runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
    } catch {
      questions = [];
    }

    const overridesRemaining = Math.max(
      0,
      ws.config.workflow.maxOverridesPerRun - run.counters.overridesUsed,
    );

    return {
      run: {
        state: run.state,
        stop: run.stop === null ? null : { kind: run.stop.kind },
        classification: run.classification === null ? null : { kind: run.classification.kind },
        classified: run.classified === true,
      },
      items,
      questions,
      ctx: {
        repoConfigured: ws.repoConfigured,
        publishEnabled: publishEnabledFor(ws),
        taintCount,
        overridesRemaining,
      },
    };
  }

  // The ONE delivery every §6.4 hook reads. Composed per request (never cached):
  // G9's whole point is that the state block describes the run at this moment, and a
  // memoized delivery would re-state a position the run has already left.
  //
  // G5 fail-soft: conductor failing must not take the user's session down. A
  // delivery that cannot be composed is journaled once under the §7.4 name for a
  // hook that could not do its conductor-side work, and the hook then appends
  // nothing — the session runs undelivered, which the §3.8 beacon ordering above
  // has already made impossible for a doctrine failure specifically.
  function deliveryFor(sessionID: string, hook: string): Delivery | null {
    try {
      const ws = ensureWorkspace(sessionID, hook);
      if (ws === null) return null;
      const packs = ensurePacks(hook, sessionID);
      // The registry entry the gates read is the entry the doctrine is chosen
      // from — never a second copy (SG-9). seedOrchestratorEntry reconstructs the
      // orchestrator's from persisted state when this process inherited a live run.
      seedOrchestratorEntry(ws);
      const entry = registry.get(sessionID) as SessionRegistryEntry | undefined;
      // A session with no entry is not conductor's; §6.4's documented fallback
      // still grounds it (an unknown role receives core.md), and the role is
      // reported as what it is rather than promoted to one of §4.1's.
      const registryEntry: SessionRegistryEntry = entry ?? { role: "unregistered" };
      return composeDelivery({
        registryEntry,
        packs,
        state: deliveryStateFor(ws),
        // §4.4: the schema tag rides the registry entry the fan-out wrote, because
        // an injection hook is handed a sessionID and must recover everything else
        // from there. Without it the router's conformance dataset is empty for
        // every run, however the run went.
        job: { schema: registryEntry.schema === true },
      });
    } catch (err) {
      journal.log(
        "error",
        "state",
        "hook.failed",
        { hook, error: err instanceof Error ? err.message : String(err) },
        { sessionID },
      );
      return null;
    }
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
    // The process's ONE monotonic clock (GAP-035). Every handler that stamps a
    // record or compares one takes its time from here, so the freshness and
    // stale-red seams order two events inside a millisecond instead of tying.
    now: () => number;
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
    // BEFORE the workspace, and the order is load-bearing: ensureWorkspace fails
    // closed on a doctrine failure too (§3.8 beacon ordering), and its refusal
    // names the workspace rather than the absent pack. Loading here first
    // keeps loadPacks's own message — which NAMES the pack file — as the refusal
    // the caller reads, so an operator whose doctrine override is missing a pack is
    // told which one (§6.4 fail-closed).
    const loadedPacks = ensurePacks(hook, sessionID);
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
      // The session making this stage call is the orchestrator, so it is the
      // parent every sub-session this engine dispatches hangs under (Task 21.1).
      sessionID,
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
        now: monotonicNow,
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
        // GAP-013: an answer typed through this tool arrived through this tool.
        // The channel is what the composition root OBSERVED, never an argument —
        // the same ruling C-044 applies to a decision's kind. Human provenance
        // comes from the answer file the edit gate keeps every session out of.
        via: "tool",
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
        // §3.5's registry role, read by the root exactly as itemId is: the model
        // is never asked who it is (Task 21.6).
        sessionRole: entry?.role ?? "",
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
          // A question can only stand against a run, so a workspace without one
          // reports an empty list for the same reason the deliveries do.
          standingQuestions: [],
          // The §6.4 delivery receipts live in the run's own journal, so a
          // workspace with no run has none to report — an empty list, never an
          // absent field, so the answer is "nothing delivered" rather than silence.
          deliveries: [],
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

  // The §7.4 record for a §3.4 call that was REFUSED. The gate stack's own
  // refusals are `gates: deny`; this names the refusals past it — the run FSM's
  // illegal transition, the queue amendment validateQueue rejects, a handler's own
  // legality step, an argument the root will not invent. Every one of those calls
  // is already written to the journal as `gates: allow`, because the gates did
  // allow them, so without this record the journal says a call succeeded that the
  // caller was told it could not make, and the refusal survives only in opencode's
  // session log where no replay, observer or post-mortem reaches it.
  function journalRefusal(name: string, sessionID: string, err: unknown): void {
    const entry = registry.get(sessionID);
    const data: Record<string, unknown> = {
      toolName: name,
      // Verbatim: this is exactly the text the caller read, and a paraphrase would
      // make the record a second, differently-worded story about the same refusal.
      reason: err instanceof Error ? err.message : String(err),
    };
    if (entry?.role !== undefined) data.role = entry.role;
    journal.log("warn", "gates", "refused", data, {
      ...(liveRunId === null ? {} : { runId: liveRunId }),
      ...(entry?.itemId === undefined ? {} : { itemId: entry.itemId }),
      sessionID,
    });
  }

  // The ONE body every registered tool executes. Caller legality first, then
  // argument legality (a refusal, never a default), then the bundle, then the
  // committed handler — with ONE catch around all four, so a refusal from any of
  // them is recorded in one place rather than by thirty handlers each remembering
  // to report themselves. It records and RETHROWS: the refusal reaches the caller
  // exactly as it was raised, because a refusal converted into data is a refusal
  // the model reads as a call that succeeded and happened to say no.
  async function runTool(name: string, rawArgs: unknown, context: unknown): Promise<string> {
    const args = argsOf(rawArgs);
    const sessionID = sessionIdOf(context);
    try {
      // GAP-006, the choke point's CALLER half. Identity comes from the §3.5
      // registry — the same map the gate hook reads — and never from an argument,
      // because an identity the model supplies is an identity the model can forge.
      // Asked here, ahead of everything, so it holds for conductor_setup too (the
      // one name that returns before the bundle is assembled).
      const callerEntry = registry.get(sessionID);
      const caller = {
        ...(callerEntry?.role === undefined ? {} : { role: callerEntry.role }),
        ...(callerEntry?.itemId === undefined ? {} : { itemId: callerEntry.itemId }),
      };

      // WHO before WHAT, through core's own predicate (the same one requireToolLegal
      // asks below, so this is an ordering and not a second rule). Asking the argument
      // question first answers a sub-session that may not call this tool at all with a
      // shape complaint — "re-issue the call with the missing field set" — which invites
      // exactly the retry §3.5 exists to refuse and never names the rule it broke.
      const byCaller = callerAllowed(name, caller);
      if (!byCaller.ok) throw refuse(byCaller.why);

      requireDeclaredArgs(name, args);

      if (name === "conductor_setup") {
        // No store: setup is the one tool that runs before a workspace can be
        // opened at all (§2.3's OpenOptions needs the Config setup produces).
        requireToolLegal({ tool: name, runId: "", caller });
        return JSON.stringify(await runSetup(args));
      }

      const run = bound[name];
      if (run === undefined) {
        throw refuse(
          `${name} is registered in the §3.4 inventory but no handler binding is declared for it; ` +
            "conductor refuses the call rather than pretending the stage ran.",
        );
      }
      const assembled = assemble(name, sessionID, !RUNLESS_TOOLS.includes(name));
      try {
        // The PHASE half, after the bundle because it reads the run the bundle
        // resolved. Every §3.4 name passes through here: a tool guarded by its own
        // handler declares that delegation in the table, and a tool that declares
        // nothing is refused rather than run (which is the growth property — the
        // next tool cannot be born unguarded).
        requireToolLegal({
          tool: name,
          store: assembled.deps.store,
          runId: assembled.deps.runId,
          caller,
        });
        return JSON.stringify(await run(args, assembled));
      } finally {
        assembled.release();
      }
    } catch (err) {
      journalRefusal(name, sessionID, err);
      throw err;
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

    // §6.4 (a): the doctrine pack(s) and the live state block, appended to EVERY
    // request's system array. Re-stated every request and never remembered (G9):
    // "process re-stated every turn" is the mechanism the whole design rests on,
    // and it reaches a session through this hook and no other.
    //
    // The §7.4 receipt is written here rather than by the caller, because this is
    // the only place that knows delivery actually happened: C-028's "loaded is not
    // delivered" has no mechanical form without a record made at the moment the
    // text is handed to the request. It rides the LISTED `inject`/`system-append`
    // name (core/journal-events.ts:52 — "the system-prompt append the plugin
    // performs"), which states exactly what happened, so the closed vocabulary is
    // not widened for it.
    "experimental.chat.system.transform": async (hook, output) => {
      const sessionID = typeof hook.sessionID === "string" ? hook.sessionID : "";
      const delivery = deliveryFor(sessionID, "experimental.chat.system.transform");
      if (delivery === null) return;
      for (const entry of delivery.system) output.system.push(entry);
      journal.log(
        "info",
        "inject",
        "system-append",
        {
          role: delivery.role,
          packs: delivery.packFiles,
          packDigest: delivery.packDigest,
          // The half a doctrine-only delivery would silently drop: a run that
          // received its packs and no live state block is visible as `false` here
          // rather than as a record that merely does not mention it.
          stateBlock: delivery.stateBlock.length > 0,
          stateBlockLines: delivery.stateBlock.split("\n").length,
          // The single next tool this request was told to call, and the item it
          // named. Recorded as fields so "recommended vs actual" — the signal
          // that names a model ignoring its state block turn after turn — is
          // derivable from the journal alone.
          recommended: delivery.recommended,
          recommendedItem: delivery.recommendedItem,
          entries: delivery.system.length,
        },
        { sessionID },
      );
    },

    // §6.4 (b): the §4.1 per-role sampling. Only the parameters §4.1 actually
    // names are set — a hook that overwrote topP/topK/maxOutputTokens as well
    // would be substituting its own defaults for the model's under cover of a
    // table that says nothing about them.
    "chat.params": async (hook, output) => {
      // The resolved model, recorded before the early return: the banner must be
      // able to name the weights that actually ran even for a session whose
      // delivery is not composed.
      if (typeof hook.model?.id === "string" && hook.model.id.length > 0) {
        sessionModel.set(hook.sessionID, hook.model.id);
      }
      const delivery = deliveryFor(hook.sessionID, "chat.params");
      if (delivery === null) return;
      output.temperature = delivery.params.temperature;
      if (delivery.params.topP !== undefined) output.topP = delivery.params.topP;
    },

    // §6.4 (c): the §4.4 router tags. ADDED to whatever opencode already carries,
    // never a replacement of the header map — the provider's own auth headers live
    // in it too.
    "chat.headers": async (hook, output) => {
      const delivery = deliveryFor(hook.sessionID, "chat.headers");
      if (delivery === null) return;
      for (const [name, value] of Object.entries(delivery.headers)) {
        output.headers[name] = value;
      }
    },

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
        // A fan-out sub-session's brief. The hook's whole body is about operator
        // prompts: this one is conductor talking to itself, the registry entry
        // belongs to adapter/fanout.ts, and there is no run to bind, report or
        // announce.
        if (result.action === "subsession") return;
        // Rebind the journal to whichever run this prompt belongs to — the one
        // just created, or a live one this plugin instance inherited from an
        // earlier session. Records already written stay where they were written.
        if (liveRunId !== result.runId) {
          bindRunJournal(ws.root, ws.config, result.runId);
        }
        // The §2.11 stale-red exclusions. handleChatMessage has always computed
        // this and this hook has always dropped it, so the exclusions the module
        // header promises to report were reported to nobody. Held here until the
        // banner has a tool result to ride.
        if (result.staleReport !== null && result.staleReport.length > 0) {
          pendingStaleReport.set(sessionID, result.staleReport);
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
      let sessionTree: TreePath = NO_TREE;
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
        // §2 tool-surface posture from the repo's own config. Threading it here
        // rather than letting the gate read a default is what makes the lane
        // revertible from a config file instead of from a code edit.
        toolSurface: config.toolSurface ?? DEFAULT_CONFIG.toolSurface,
        journal,
        corr,
      });
    },

    // Thin bus hook: the §3.7 idle engine and the §3.5(b)/§3.6 ask-gate both hang
    // off the `permission.asked` / `session.idle` BUS events (adapter/wire-notes.md:32
    // — the typed `permission.ask` PLUGIN hook is never dispatched at 1.18.15), so
    // this body parses nothing and decides nothing: it hands the whole event to the
    // §3.8: the session banner and the §2.11 stale-red report.
    //
    // THE SEAM IS THE FINDING. Task 20.5 probed four candidates against the
    // pinned binary: a part appended inside chat.message reaches neither the
    // transcript nor the model; tui.showToast answers success with no TUI
    // attached, so a 200 proves reachability and not visibility; a plugin tool's
    // own return string is visible but tied to a call. Only a tool.execute.after
    // output mutation puts plugin-authored text in front of an operator — so the
    // banner rides the session's FIRST tool result and is conditional on a tool
    // running. HONEST-LIMITS records that rather than implying otherwise.
    //
    // A conductor_* result is never decorated. Those are structured payloads the
    // orchestrator parses, and prefixing prose to one would break the parse — a
    // banner that costs the run its state transition is worse than no banner.
    "tool.execute.after": async (hook, output) => {
      const sessionID = hook.sessionID;
      if (bannered.has(sessionID)) return;
      if (hook.tool.startsWith("conductor_")) return;
      // Mark before composing: a throw while composing must not arm a second
      // attempt on every later tool call for the rest of the session.
      bannered.add(sessionID);

      try {
        const ws = workspace;
        const staleReport = pendingStaleReport.get(sessionID) ?? null;
        pendingStaleReport.delete(sessionID);
        const banner = composeSessionBanner({
          version: CONDUCTOR_VERSION,
          pid: process.pid,
          runId: liveRunId,
          model: sessionModel.get(sessionID) ?? ws?.config.models.default ?? "unknown model",
          staleReport,
        });
        output.output = banner + "\n" + output.output;
      } catch (err) {
        // G5 fail-soft, on the same terms as every other hook body: a banner
        // failing must not take the session down. Journaled once and swallowed.
        journal.log(
          "error",
          "state",
          "hook.failed",
          {
            hook: "tool.execute.after",
            error: err instanceof Error ? err.message : String(err),
          },
          { sessionID },
        );
      }
    },

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
        now: monotonicNow,
      });
    },
  };
};
