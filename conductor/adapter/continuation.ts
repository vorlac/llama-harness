// conductor/adapter/continuation.ts — Task 10.1: the §3.7 continuation engine and
// the §3.5(b)/§3.6 ask-gate (plan lines 2731-2745).
//
// An ADAPTER (G14): node:fs / node:path only, plus an INJECTED clock, an INJECTED
// state store and an INJECTED journal. It dispatches ZERO model sub-sessions — the
// idle engine sends ONE message to the orchestrator's own session, and the ask-gate
// answers a permission request. Every durable read and write goes through the
// injected store (G6); every rule it applies is READ from core or from the
// committed handlers in tools.ts, never restated here:
//
//   core/stops.ts isTerminal        — §2.3's ONE terminality test.
//   core/stops.ts shouldTerminate   — the §3.7 wedge rule. FUTILE_RE_PROMPT_LIMIT
//                                     is module-private there and is never
//                                     restated, imported or read from an env var.
//   core/gates-phase.ts legalTools  — the named next action, reached through
//     (via tools.ts waveVerdict)      the ONE committed assembly of its inputs.
//   core/gates-edit.ts decideEdit   — the inline-claim coverage adjudicator,
//                                     including the `..` and .conductor/** denies.
//   core/decide.ts isHumanTerritory — Task 1.5's §6.2 verdict.
//   tools.ts handleReport           — the §2.9 stop-report, in its stop mode
//                                     (selected from the persisted run.stop). This
//                                     file contains NO report-writing code and no
//                                     stale-red registration of its own.
//   worktrees.ts removeWorktree     — the §4.2 cleanup 9.6 ships with no caller;
//                                     the run-lifecycle owner (this file) calls it.
//
// THE FUTILITY SIGNATURE EXCLUDES run.counters (SG-1). §3.7.2's literal "hash of
// run.json" is self-defeating: run.counters lives INSIDE run.json (core/types.ts),
// so every re-prompt mutates the file and a raw hash would reset futility on every
// pass — the wedge detector could never fire. The signature is a canonical
// projection over run.state, run.classification.kind, run.planReviewRounds, the
// items (id/state/blockedReason/deferredReason) and the questions (id/answered),
// and nothing else: every extra field is another way for a wedged run to look like
// it moved.
//
// THE DEBOUNCE AND THE ONE-IN-FLIGHT LATCH ARE IN-MEMORY (SG-3), held in a
// caller-owned ContinuationState — the same shape the §3.5 registry and the §3.6
// override-grant map already use. §2.3's schema has no field for either and adding
// one would be a schema change. The durable half (counters + the projected
// signature) is derived from persisted state and survives a restart.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { readQuestions } from "./questions.ts";
import { removeWorktree as removeWorktreeImpl } from "./worktrees.ts";
import {
  appendAnomaly,
  handleReport,
  handlerRunDir,
  inlineClaimScopeFor,
  waveVerdict,
} from "./tools.ts";
import type { RegistryEntry } from "./tools.ts";
import type { StateStore } from "./state.ts";
import { decideEdit } from "../core/gates-edit.ts";
import { isHumanTerritory } from "../core/decide.ts";
import { isTerminal, shouldTerminate } from "../core/stops.ts";
import type { Config, Item, Queue, QuestionRecord, Run, StopKind } from "../core/types.ts";

// ---------------------------------------------------------------------------
// The injected surfaces
// ---------------------------------------------------------------------------

/** The §7.4 sink, with runId optional: an ask can arrive before any run exists. */
export interface ContinuationJournal {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
}

export interface ContinuationEnvelope {
  data?: unknown;
  error?: unknown;
}

/**
 * The SDK subset this file drives: the fan-out engine's session surface (so a
 * client that satisfies adapter/fanout.ts also satisfies this one) plus the
 * WIRE-VERIFIED permission reply route. adapter/wire-notes.md:55-59 records that
 * the plan's `client.permission.reply({requestID, reply})` does not exist at
 * 1.18.15; the generated method is the one spelled below, and its response
 * vocabulary is 'once' | 'always' | 'reject' (only 'once' and 'reject' are
 * exercised — wire-notes.md:109).
 */
export interface ContinuationClient {
  session: {
    create(opts?: { body?: { title?: string; parentID?: string } }): Promise<ContinuationEnvelope>;
    prompt(opts: { path: { id: string }; body: Record<string, unknown> }): Promise<ContinuationEnvelope>;
    abort(opts: { path: { id: string } }): Promise<ContinuationEnvelope>;
    messages(opts: { path: { id: string } }): Promise<ContinuationEnvelope>;
  };
  postSessionIdPermissionsPermissionId(opts: {
    path: { id: string; permissionID: string };
    body: { response: PermissionResponse };
  }): Promise<ContinuationEnvelope>;
}

export type PermissionResponse = "once" | "always" | "reject";

/** The §2.10 conversion a denied sub-session ask produces (no new status). */
export interface NeedsContextConversion {
  sessionID: string;
  itemId: string | null;
  status: string;
  neededContext: string;
}

/**
 * The caller-owned in-memory half (SG-3/G4): the debounce clock, the
 * one-in-flight latch, the last observed futility signature, the permission ids
 * already adjudicated (the bus may re-deliver), and the NEEDS_CONTEXT surface
 * queue the next re-prompt drains.
 */
export interface ContinuationState {
  lastRePromptMs: number | null;
  rePromptInFlight: boolean;
  lastSignature: string | null;
  adjudicated: Set<string>;
  pendingConversions: NeedsContextConversion[];
}

export function createContinuationState(): ContinuationState {
  return {
    lastRePromptMs: null,
    rePromptInFlight: false,
    lastSignature: null,
    adjudicated: new Set<string>(),
    pendingConversions: [],
  };
}

/** §3.7.4: the debounce window, measured from the LAST re-prompt (plan line 1462). */
const DEBOUNCE_MS = 2000;

export interface StopRecorded {
  kind: string;
  reasonDisplay: string;
  tsMs: number;
}

/** The two injection seams, each defaulting to the committed implementation. */
export interface ContinuationDeps {
  writeStopReport?: (input: {
    store: StateStore;
    runId: string;
    config: Config;
    journal: ContinuationJournal;
    stateHome: string;
    workspaceKey: string;
    now?: () => number;
  }) => Promise<{ reportPath: string }>;
  removeWorktree?: (
    workspace: string,
    runId: string,
    itemId: string,
    ctx: { stateHome: string; workspaceKey: string },
  ) => void;
}

export interface SessionIdleInput {
  store: StateStore;
  state: ContinuationState;
  registry: Map<string, RegistryEntry>;
  sessionID: string;
  client: ContinuationClient;
  config: Config;
  journal: ContinuationJournal;
  stateHome: string;
  workspaceKey: string;
  now: () => number;
  deps?: ContinuationDeps;
}

export interface SessionIdleResult {
  runId: string | null;
  prompted: boolean;
  stop: StopRecorded | null;
}

export interface PermissionAskedEvent {
  id: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
}

export interface PermissionAskedInput {
  store: StateStore;
  state: ContinuationState;
  registry: Map<string, RegistryEntry>;
  client: ContinuationClient;
  event: PermissionAskedEvent;
  journal: ContinuationJournal;
  now?: () => number;
}

export interface PermissionAskedResult {
  replied: PermissionResponse | null;
  conversion: NeedsContextConversion | null;
}

export interface PluginEventInput {
  event: { type: string; properties?: Record<string, unknown> };
  store: StateStore;
  state: ContinuationState;
  registry: Map<string, RegistryEntry>;
  client: ContinuationClient;
  config: Config;
  journal: ContinuationJournal;
  stateHome: string;
  workspaceKey: string;
  now: () => number;
  deps?: ContinuationDeps;
}

// ---------------------------------------------------------------------------
// The two ONE-derivation helpers BOTH seams read
// ---------------------------------------------------------------------------

/**
 * SG-9: adapter/chat-message.ts registers the orchestrator as {role:"orchestrator"}
 * with NO `tree`, and both decideEdit consumers read `entry?.tree ?? ""`. With an
 * empty tree core/gates-edit.ts normalizeUnderTree turns an ABSOLUTE ask path into
 * a root-relative one ("/repo/src/a.ts" -> "repo/src/a.ts") which matches no
 * tree-relative item scope, so an inline claim could never cover an absolute path.
 *
 * This is the ONE resolution both seams use: the entry's own tree when it has one,
 * the workspace root otherwise. The resolved value is RECORDED onto the §3.5
 * registry entry, because adapter/tools.ts gateBeforeToolCall reads `entry.tree`
 * directly and has no workspace root of its own — if the resolution lived only in
 * this function's return value, the ask-gate and the tool.execute.before gate
 * would judge the same path against two different trees, which is exactly the
 * split this task exists to close. It is idempotent (the root is stable), so a
 * chat.message re-registration that drops the field is simply refilled next time.
 *
 * The entry MUST be the registry's own object: the plugin copies at the
 * registration boundary precisely so a per-session fact recorded here cannot leak
 * through adapter/chat-message.ts's shared orchestrator constant.
 */
export function resolveSessionTree(store: StateStore, entry: RegistryEntry | undefined): string {
  if (entry === undefined) return store.root;
  if (entry.tree !== undefined && entry.tree.length > 0) return entry.tree;
  entry.tree = store.root;
  return store.root;
}

function readQueue(runDir: string): Queue | null {
  const queuePath = path.join(runDir, "queue.json");
  if (!existsSync(queuePath)) return null;
  try {
    return JSON.parse(readFileSync(queuePath, "utf8")) as Queue;
  } catch {
    return null;
  }
}

/**
 * SG-8: the §3.6 claim scope, for the whole run. `active` means the item carries a
 * claim AND has not reached PUBLISHED — the committed tools.ts inlineClaimScopeFor
 * implements only the first half, because the persisted record stores neither a
 * scope nor the state it was claimed in. The conservative half of §3.6's expiry is
 * implemented here (a claim on a finished item covers nothing); the mid-FSM half
 * ("until the item leaves its CURRENT state") is not computable from committed
 * state and is deliberately NOT implemented.
 *
 * Returns the flat glob list BOTH seams take — GateHookInput.inlineClaimScope and
 * the permission reply — or null when no claim is active. Fail closed: no queue,
 * no item, no claim all derive no scope at all.
 */
export function activeInlineClaimScope(store: StateStore, runId: string): string[] | null {
  const queue = readQueue(handlerRunDir(store, runId));
  if (queue === null) return null;
  const scope: string[] = [];
  for (const entry of queue.items) {
    let item: Item;
    try {
      item = store.loadItem(runId, entry.id);
    } catch {
      continue;
    }
    if (item.inlineClaim === null) continue;
    if (item.state === "PUBLISHED") continue;
    const globs = inlineClaimScopeFor(store, runId, entry.id);
    if (globs === null) continue;
    for (const glob of globs) {
      if (!scope.includes(glob)) scope.push(glob);
    }
  }
  return scope.length === 0 ? null : scope;
}

// ---------------------------------------------------------------------------
// The futility signature (SG-1)
// ---------------------------------------------------------------------------

function signatureOf(store: StateStore, run: Run, runDir: string, queue: Queue | null): string {
  const items: Array<Record<string, unknown>> = [];
  for (const entry of queue === null ? [] : queue.items) {
    let item: Item;
    try {
      item = store.loadItem(run.runId, entry.id);
    } catch {
      continue;
    }
    items.push({
      id: item.id,
      state: item.state,
      blockedReason: item.blocked === null ? null : item.blocked.reason,
      deferredReason: item.deferred === null ? null : item.deferred.reason,
    });
  }
  items.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  let questions: QuestionRecord[] = [];
  try {
    questions = readQuestions(runDir);
  } catch {
    questions = [];
  }
  const questionProjection = questions
    .map((q) => ({ id: q.id, answered: q.answeredIso !== null }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Keys are written in one fixed order, so the serialization is canonical.
  return JSON.stringify({
    classificationKind: run.classification.kind,
    items,
    planReviewRounds: run.planReviewRounds,
    questions: questionProjection,
    runState: run.state,
  });
}

// ---------------------------------------------------------------------------
// The C-032 E7 reconciliation (repair half)
// ---------------------------------------------------------------------------

/**
 * blockAndAsk (tools.ts) and blockVetAndAsk append their §2.11 question FIRST and
 * call store.setBlocked SECOND. A crash between those two writes — or two
 * in-flight calls — leaves an OPEN question that no item references, and the
 * stage gate then offers the tool again on an item nothing says is blocked.
 *
 * The second write is fully determined by the first and is idempotent, so the
 * engine completes it: for every OPEN implementer-blocked question naming an item
 * whose `blocked` is null, set the block at that question. A fully-applied pair is
 * left untouched (the item already carries a disposition) and an ANSWERED question
 * never re-blocks anything. No question is ever appended here.
 */
function reconcileOrphanQuestions(
  store: StateStore,
  runId: string,
  runDir: string,
  journal: ContinuationJournal,
): void {
  let questions: QuestionRecord[];
  try {
    questions = readQuestions(runDir);
  } catch {
    return;
  }
  for (const question of questions) {
    if (question.answeredIso !== null) continue;
    if (question.origin !== "implementer-blocked") continue;
    for (const itemId of question.blocksItems) {
      let item: Item;
      try {
        item = store.loadItem(runId, itemId);
      } catch {
        continue;
      }
      if (item.blocked !== null) continue;
      store.setBlocked(runId, itemId, {
        reason:
          "completing a half-applied block: open question " +
          question.id +
          " names this item but the item carried no disposition (§2.11, C-032 E7)",
        stage: item.state,
        questionId: question.id,
      });
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, blocked: true, questionId: question.id, reconciled: true },
        { runId, itemId },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Terminal-run cleanup (§4.2 worktrees + SG-4 archival)
// ---------------------------------------------------------------------------

function cleanupAndArchive(input: SessionIdleInput, run: Run, runDir: string): void {
  const { store, journal } = input;
  const remove = input.deps?.removeWorktree ?? removeWorktreeImpl;
  const queue = readQueue(runDir);
  for (const entry of queue === null ? [] : queue.items) {
    let item: Item;
    try {
      item = store.loadItem(run.runId, entry.id);
    } catch {
      continue;
    }
    if (item.worktree === null) continue;
    try {
      remove(store.root, run.runId, entry.id, {
        stateHome: input.stateHome,
        workspaceKey: input.workspaceKey,
      });
    } catch (err) {
      journal.log(
        "error",
        "state",
        "hook.failed",
        {
          hook: "continuation.worktree-cleanup",
          itemId: entry.id,
          error: err instanceof Error ? err.message : String(err),
        },
        { runId: run.runId, itemId: entry.id },
      );
    }
  }
  store.archiveRun(run.runId);
}

// ---------------------------------------------------------------------------
// The stop paths (§2.9). ONLY `noop` and `interrupt` are recorded here.
// ---------------------------------------------------------------------------

async function driveStopReport(input: SessionIdleInput, runId: string): Promise<void> {
  const writer =
    input.deps?.writeStopReport ??
    (async (i: {
      store: StateStore;
      runId: string;
      config: Config;
      journal: ContinuationJournal;
      stateHome: string;
      workspaceKey: string;
      now?: () => number;
    }): Promise<{ reportPath: string }> =>
      handleReport({
        store: i.store,
        runId: i.runId,
        config: i.config,
        journal: i.journal,
        stateHome: i.stateHome,
        workspaceKey: i.workspaceKey,
        now: i.now,
      }));
  try {
    await writer({
      store: input.store,
      runId,
      config: input.config,
      journal: input.journal,
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      now: input.now,
    });
  } catch (err) {
    // G5 fail-soft: the stop is already durable and the §2.8 trace is already on
    // disk. A writer failure must not swallow either of them.
    input.journal.log(
      "error",
      "state",
      "hook.failed",
      {
        hook: "continuation.stop-report",
        runId,
        error: err instanceof Error ? err.message : String(err),
      },
      { runId },
    );
  }
}

// Recording a stop is a schema-validated field write on run.json (core/fsm-run.ts
// has no stop logic at all), so it is legal from any non-terminal state — the
// wedge and the halt are state-independent.
function recordStop(store: StateStore, run: Run, stop: StopRecorded): Run {
  const next = store.loadRun(run.runId);
  next.stop = { kind: stop.kind as StopKind, reasonDisplay: stop.reasonDisplay, tsMs: stop.tsMs };
  store.saveRun(next);
  return next;
}

// ---------------------------------------------------------------------------
// The composed re-prompt
// ---------------------------------------------------------------------------

function composeRePrompt(
  run: Run,
  recommended: { tool: string; args: { itemId?: string } },
  conversions: NeedsContextConversion[],
): string {
  const lines: string[] = [
    "conductor: this session has gone idle while run " + run.runId + " still has work to do.",
    "",
    "Run state: " + run.state + ".",
    "The phase gate's next action is: " +
      recommended.tool +
      (recommended.args.itemId === undefined ? "" : " for item " + recommended.args.itemId) +
      ".",
  ];
  if (conversions.length > 0) {
    lines.push("");
    lines.push("A sub-session was refused a permission and needs context before it can proceed:");
    for (const conversion of conversions) {
      lines.push(
        "- " +
          (conversion.itemId === null ? "(no item)" : conversion.itemId) +
          " [" +
          conversion.status +
          "]: " +
          conversion.neededContext,
      );
    }
  }
  lines.push("");
  lines.push("Call that action now, or answer the open question that is holding the run.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// handleSessionIdle — the §3.7 idle engine
// ---------------------------------------------------------------------------

const NO_RUN: SessionIdleResult = { runId: null, prompted: false, stop: null };

export async function handleSessionIdle(input: SessionIdleInput): Promise<SessionIdleResult> {
  const { store, state, registry, sessionID, journal, config } = input;
  const now = input.now;

  // (a) ORCHESTRATOR-ONLY. §3.7.1's engine re-prompts the orchestrator; a
  //     sub-session going idle is the fan-out engine's business, and a session
  //     with no registry entry is nobody's.
  const entry = registry.get(sessionID);
  if (entry === undefined || entry.role !== "orchestrator") return NO_RUN;

  // (b) A live run, or nothing to do. An archived run leaves exactly this state
  //     behind (archiveRun clears the pointer), so it is a quiet no-op.
  const current = store.currentRun();
  if (current === null) return NO_RUN;
  const runId = current.runId;
  const runDir = handlerRunDir(store, runId);

  // (c) The C-032 E7 repair, before any re-prompt or stop decision.
  reconcileOrphanQuestions(store, runId, runDir, journal);

  let run = store.loadRun(runId);

  // (d) §3.7.3 HALT outranks everything — the debounce, the recommendation and
  //     the futility rule alike. A human halt is not a §2.8 anomaly, so no
  //     disengage record is appended; the stop-report is written through the same
  //     ONE writer every other stop uses.
  if (store.isHalted() && !isTerminal(run)) {
    const stop: StopRecorded = {
      kind: "interrupt",
      reasonDisplay:
        "the .conductor/state/halt file is present: a human halted this workspace, so the run stops here",
      tsMs: now(),
    };
    run = recordStop(store, run, stop);
    journal.log(
      "info",
      "continuation",
      "disengage",
      { stop: stop.kind, reasonDisplay: stop.reasonDisplay },
      { runId, sessionID },
    );
    await driveStopReport(input, runId);
    cleanupAndArchive(input, run, runDir);
    return { runId, prompted: false, stop };
  }

  // (e) §2.3 terminality — ONE definition, read from core. A terminal run is never
  //     re-prompted; it is cleaned up and archived in this same pass, because
  //     archiveRun clears the pointer and no later pass would find it again.
  if (isTerminal(run)) {
    cleanupAndArchive(input, run, runDir);
    return { runId, prompted: false, stop: null };
  }

  // (f) The wedge rule (Task 1.3), consulted with the PERSISTED counters BEFORE
  //     this pass touches them — the only order in which "exactly three prompts,
  //     the fourth stops" and "futileRePrompts reads 1,2,3" are both true. The
  //     threshold lives in core/stops.ts and is never restated here.
  const verdict = shouldTerminate(run, run.counters, store.itemsSummary(runId), config);
  if (verdict.stop && verdict.kind === "noop") {
    const tsMs = now();
    const reasonDisplay =
      "the run made no observable progress across " +
      String(run.counters.futileRePrompts) +
      " consecutive re-prompts (§3.7 futile re-prompt limit reached): disengaging rather than burning tokens";
    // §2.8 WRITE-AHEAD: the anomaly is appended BEFORE the stop and the report, so
    // a process killed mid-disengagement still leaves its trace.
    appendAnomaly(runDir, {
      ts: tsMs,
      kind: "disengage",
      detail: reasonDisplay,
    });
    const stop: StopRecorded = { kind: "noop", reasonDisplay, tsMs };
    run = recordStop(store, run, stop);
    journal.log(
      "info",
      "continuation",
      "disengage",
      { stop: stop.kind, futileRePrompts: run.counters.futileRePrompts, reasonDisplay },
      { runId, sessionID },
    );
    await driveStopReport(input, runId);
    cleanupAndArchive(input, run, runDir);
    return { runId, prompted: false, stop };
  }
  // Every OTHER kind shouldTerminate can return belongs to another recorder:
  // blocked/surfaced/done to conductor_report, env to the override hatch
  // (§2.9:900-905). This engine writes nothing for them and carries on.

  // (g) The gate's own verdict. No second next-step derivation exists.
  const queue = readQueue(runDir);
  const gate = waveVerdict(store, runId, runDir, queue ?? { items: [] });
  const recommended = gate.recommended;
  if (recommended === null) {
    // SG-2: a reachable non-terminal position where the gate offers no next step.
    // Prompting a tool nobody offered would invent state; counting it as a futile
    // RE-prompt would be a lie, because nothing was re-prompted.
    journal.log("info", "continuation", "idle", { why: gate.why, runState: run.state }, { runId, sessionID });
    return { runId, prompted: false, stop: null };
  }

  // (h) §3.7.4 debounce and the one-in-flight latch — INDEPENDENT guards.
  if (state.rePromptInFlight) return { runId, prompted: false, stop: null };
  if (state.lastRePromptMs !== null && now() - state.lastRePromptMs < DEBOUNCE_MS) {
    return { runId, prompted: false, stop: null };
  }

  // (i) Counters, then the message. A signature that DIFFERS from the last one
  //     this engine observed is progress and resets the futile counter; equal (or
  //     no observation yet) increments it.
  const signature = signatureOf(store, run, runDir, queue);
  run.counters.idleRePrompts += 1;
  run.counters.futileRePrompts =
    state.lastSignature !== null && state.lastSignature !== signature
      ? 0
      : run.counters.futileRePrompts + 1;
  store.saveRun(run);
  state.lastSignature = signature;
  state.lastRePromptMs = now();

  const conversions = state.pendingConversions.splice(0, state.pendingConversions.length);
  const text = composeRePrompt(run, recommended, conversions);

  // The prompt is FIRED, not awaited: the latch is what bounds concurrency, and
  // awaiting the orchestrator's reply here would hold the hook open for the whole
  // turn. It clears when the prompt settles, either way.
  state.rePromptInFlight = true;
  const settle = (): void => {
    state.rePromptInFlight = false;
  };
  input.client.session.prompt({ path: { id: sessionID }, body: { parts: [{ type: "text", text }] } }).then(
    settle,
    settle,
  );

  journal.log(
    "info",
    "continuation",
    "reprompt",
    {
      tool: recommended.tool,
      itemId: recommended.args.itemId ?? null,
      idleRePrompts: run.counters.idleRePrompts,
      futileRePrompts: run.counters.futileRePrompts,
      surfaced: conversions.length,
    },
    { runId, sessionID },
  );

  return { runId, prompted: true, stop: null };
}

// ---------------------------------------------------------------------------
// handlePermissionAsked — the §3.5(b)/§3.6 ask-gate
// ---------------------------------------------------------------------------

// SG-10: wire-notes.md:110 records `patterns`/`metadata` as NEVER asserted, so
// which field carries the edit's path is unverified. Extraction order is
// metadata.filePath, then metadata.path, then a single CONCRETE (wildcard-free)
// entry of `patterns`. Anything else yields null and the ask FAILS CLOSED.
function stringField(metadata: Record<string, unknown> | undefined, key: string): string | null {
  if (metadata === undefined) return null;
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasWildcard(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

function extractAskPath(event: PermissionAskedEvent): string | null {
  const direct = stringField(event.metadata, "filePath") ?? stringField(event.metadata, "path");
  if (direct !== null) return direct;
  const patterns = event.patterns ?? [];
  const concrete = patterns.filter((pattern) => pattern.length > 0 && !hasWildcard(pattern));
  return concrete.length === 1 ? concrete[0] : null;
}

function extractAskQuestion(event: PermissionAskedEvent): string | null {
  return stringField(event.metadata, "question") ?? stringField(event.metadata, "text");
}

async function sendReply(
  input: PermissionAskedInput,
  response: PermissionResponse,
  corr: { runId?: string; sessionID?: string },
): Promise<void> {
  try {
    const envelope = await input.client.postSessionIdPermissionsPermissionId({
      path: { id: input.event.sessionID, permissionID: input.event.id },
      body: { response },
    });
    if (envelope !== null && envelope !== undefined && envelope.error !== undefined && envelope.error !== null) {
      input.journal.log(
        "error",
        "state",
        "hook.failed",
        {
          hook: "permission.asked",
          permissionID: input.event.id,
          response,
          error: JSON.stringify(envelope.error),
        },
        corr,
      );
    }
  } catch (err) {
    // opencode's own permission timeout is the backstop; conductor does not
    // compound a transport failure with a crash (G5).
    input.journal.log(
      "error",
      "state",
      "hook.failed",
      {
        hook: "permission.asked",
        permissionID: input.event.id,
        response,
        error: err instanceof Error ? err.message : String(err),
      },
      corr,
    );
  }
}

export async function handlePermissionAsked(input: PermissionAskedInput): Promise<PermissionAskedResult> {
  const { store, state, registry, event, journal } = input;

  // The bus may re-deliver a permission id. Adjudication is ONCE per id.
  if (state.adjudicated.has(event.id)) return { replied: null, conversion: null };

  const run = store.currentRun();
  const runId = run === null ? undefined : run.runId;
  const corr = { runId, sessionID: event.sessionID };

  // (1) REGISTRY-FIRST, exactly as the §3.5 tool gate reads it: an unregistered
  //     session is granted nothing on the strength of the ask alone.
  const entry = registry.get(event.sessionID);
  if (entry === undefined) {
    state.adjudicated.add(event.id);
    journal.log(
      "warn",
      "gates",
      "deny",
      {
        permission: event.permission,
        permissionID: event.id,
        reason:
          "this session has no §3.5 registry entry; conductor grants no permission on the strength of an ask alone (missing registration)",
      },
      corr,
    );
    await sendReply(input, "reject", corr);
    return { replied: "reject", conversion: null };
  }

  // (2) §3.5(b): a sub-session is refused EVERY permission kind — 'question'
  //     included, which §5.3 grants precisely so the plugin can see and refuse it.
  //     The refusal converts to a §2.10 NEEDS_CONTEXT disposition the idle engine
  //     surfaces to the orchestrator on its next re-prompt (SG-5).
  if (entry.role !== "orchestrator") {
    state.adjudicated.add(event.id);
    const patterns = event.patterns ?? [];
    const asked = patterns.length > 0 ? patterns.join(", ") : (extractAskPath(event) ?? "(no pattern in the payload)");
    const neededContext =
      'the sub-session was denied the "' +
      event.permission +
      '" permission for ' +
      asked +
      " — it cannot proceed until it is given the context, or the scope, to do this work inside its own assignment";
    journal.log(
      "warn",
      "gates",
      "deny",
      {
        permission: event.permission,
        permissionID: event.id,
        role: entry.role,
        itemId: entry.itemId ?? null,
        reason: "a sub-session may not be granted a permission ask (§3.5(b)); it is refused and surfaced instead",
      },
      corr,
    );
    await sendReply(input, "reject", corr);
    const conversion: NeedsContextConversion = {
      sessionID: event.sessionID,
      itemId: entry.itemId ?? null,
      status: "NEEDS_CONTEXT",
      neededContext,
    };
    state.pendingConversions.push(conversion);
    return { replied: "reject", conversion };
  }

  // (3) The ORCHESTRATOR. Its edit ask is adjudicated by the §3.6 inline claim
  //     through core/gates-edit.ts decideEdit — no second path matcher exists here.
  if (event.permission === "edit") {
    state.adjudicated.add(event.id);
    const askedPath = extractAskPath(event);
    if (askedPath === null) {
      journal.log(
        "warn",
        "gates",
        "deny",
        {
          permission: event.permission,
          permissionID: event.id,
          patterns: event.patterns ?? [],
          reason:
            "no concrete file path could be extracted from the permission.asked payload, so the claim cannot be checked; an unrecognized payload fails closed",
        },
        corr,
      );
      await sendReply(input, "reject", corr);
      return { replied: "reject", conversion: null };
    }
    const decision = decideEdit({
      sessionRole: "orchestrator",
      registered: true,
      fileScope: [],
      testScope: [],
      path: askedPath,
      verifyInFlightTree: null,
      sessionTree: resolveSessionTree(store, entry),
      inlineClaimScope: runId === undefined ? null : activeInlineClaimScope(store, runId),
    });
    if (decision.action === "allow") {
      journal.log(
        "info",
        "gates",
        "allow",
        { permission: event.permission, permissionID: event.id, path: askedPath, via: "inline-claim" },
        corr,
      );
      await sendReply(input, "once", corr);
      return { replied: "once", conversion: null };
    }
    journal.log(
      "warn",
      "gates",
      "deny",
      {
        permission: event.permission,
        permissionID: event.id,
        path: askedPath,
        reason: decision.reason ?? "the edit gate denied this orchestrator ask",
      },
      corr,
    );
    await sendReply(input, "reject", corr);
    return { replied: "reject", conversion: null };
  }

  // (4) A question ask is ALLOWED, but counted and journaled with Task 1.5's
  //     §6.2 verdict. When no text can be extracted the verdict is not
  //     fabricated: humanTerritory false with textAvailable false says so.
  if (event.permission === "question") {
    state.adjudicated.add(event.id);
    const text = extractAskQuestion(event);
    journal.log(
      "info",
      "gates",
      "allow",
      {
        permission: event.permission,
        permissionID: event.id,
        humanTerritory: text === null ? false : isHumanTerritory(text),
        textAvailable: text !== null,
      },
      corr,
    );
    await sendReply(input, "once", corr);
    return { replied: "once", conversion: null };
  }

  // (5) DEFAULT DENY. A permission vocabulary that grows upstream must not
  //     silently widen what the orchestrator may do.
  state.adjudicated.add(event.id);
  journal.log(
    "warn",
    "gates",
    "deny",
    {
      permission: event.permission,
      permissionID: event.id,
      reason:
        'the ask-gate adjudicates only "edit" (by inline claim) and "question" (allowed and counted); every other permission kind is refused: ' +
        event.permission,
    },
    corr,
  );
  await sendReply(input, "reject", corr);
  return { replied: "reject", conversion: null };
}

// ---------------------------------------------------------------------------
// handlePluginEvent — the router the plugin's `event` hook delegates to
// ---------------------------------------------------------------------------

function stringProp(properties: Record<string, unknown> | undefined, key: string): string | null {
  if (properties === undefined) return null;
  const value = properties[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Routes by event.type and NEVER throws (G5): a conductor bug must not kill the
 * opencode session that would otherwise still work. Every unrouted type — the
 * whole rest of the bus — is ignored silently.
 */
export async function handlePluginEvent(input: PluginEventInput): Promise<void> {
  const { event, journal } = input;
  const sessionID = stringProp(event.properties, "sessionID");
  try {
    if (event.type === "session.idle") {
      if (sessionID === null) return;
      await handleSessionIdle({
        store: input.store,
        state: input.state,
        registry: input.registry,
        sessionID,
        client: input.client,
        config: input.config,
        journal: input.journal,
        stateHome: input.stateHome,
        workspaceKey: input.workspaceKey,
        now: input.now,
        deps: input.deps,
      });
      return;
    }
    if (event.type === "permission.asked") {
      const id = stringProp(event.properties, "id");
      const permission = stringProp(event.properties, "permission");
      if (sessionID === null || id === null || permission === null) return;
      const properties = event.properties ?? {};
      const patterns = properties.patterns;
      const metadata = properties.metadata;
      await handlePermissionAsked({
        store: input.store,
        state: input.state,
        registry: input.registry,
        client: input.client,
        event: {
          id,
          sessionID,
          permission,
          ...(Array.isArray(patterns) ? { patterns: patterns.filter((p): p is string => typeof p === "string") } : {}),
          ...(metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
            ? { metadata: metadata as Record<string, unknown> }
            : {}),
        },
        journal: input.journal,
        now: input.now,
      });
      return;
    }
  } catch (err) {
    journal.log(
      "error",
      "state",
      "hook.failed",
      {
        hook: "event",
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      },
      { sessionID: sessionID ?? undefined },
    );
  }
}
