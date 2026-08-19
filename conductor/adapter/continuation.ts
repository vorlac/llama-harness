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
//                                     Called DIRECTLY in exactly one other place:
//                                     UNIVERSAL_META_TOOLS probes it over a
//                                     synthetic empty position to derive the meta
//                                     tools that are legal everywhere. That is a
//                                     question about the GATE, not about this run,
//                                     so it assembles no run inputs of its own.
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
// THE DEBOUNCE, THE ONE-IN-FLIGHT LATCH, THE LAST OBSERVED SIGNATURE AND THE
// CONSECUTIVE-SEND-FAILURE COUNT ARE IN-MEMORY (SG-3), held in a caller-owned
// ContinuationState — the same shape the
// §3.5 registry and the §3.6 override-grant map already use. §2.3's schema has no
// field for any of them and adding one would be a schema change. Only the counters
// are durable, and the signature as of the PREVIOUS re-prompt is not recoverable
// from them: a restarted process can compute today's signature but has nothing to
// compare it against. So a pass with no prior observation on a run that has already
// been re-prompted leaves counters.futileRePrompts exactly as it found it. A
// restart may therefore cost one extra prompt (as it may on the debounce clock);
// it may never cost a live run, because §3.7's wedge detector must fire only on a
// run that is not moving.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { readQuestions } from "./questions.ts";
import { reconcileOrphanQuestions, replayBlockIntents } from "./block-and-ask.ts";
import { removeWorktree as removeWorktreeImpl } from "./worktrees.ts";
import {
  appendAnomaly,
  handleReport,
  handlerRunDir,
  ingestAnswerFiles,
  inlineClaimScopeFor,
  waveVerdict,
} from "./tools.ts";
import type { RegistryEntry } from "./tools.ts";
import type { StateStore } from "./state.ts";
import { decideEdit } from "../core/gates-edit.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateRun, LegalToolsResult } from "../core/gates-phase.ts";
import { isHumanTerritory } from "../core/decide.ts";
import { dispositionsOf, isResumableStop, runDispositionOf, stopKindOf } from "../core/disposition.ts";
import { isTerminal, shouldTerminate } from "../core/stops.ts";
import type { Config, Item, Queue, QuestionRecord, Run, StopKind, TreePath } from "../core/types.ts";

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

/**
 * The §2.10 conversion a denied sub-session ask produces (no additional status).
 *
 * `runId` is the run the ask was raised UNDER, and it is what makes the queue
 * below run-scoped: the queue itself is process-scoped (SG-3), it outlives the
 * run that filled it, and `itemId` only means anything inside its own run. A
 * conversion delivered into a LATER run would name an item that run does not
 * contain — state the orchestrator could act on only by inventing it. Null when
 * no run was current at the moment of the ask.
 */
export interface NeedsContextConversion {
  runId: string | null;
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
  /**
   * CONSECUTIVE re-prompts that never left this process (a synchronous throw out
   * of the SDK call). It lives here, alongside the debounce clock and the last
   * signature, for SG-3's reason: §2.3's schema has no field for it and adding
   * one would be a schema change. In-memory is also the only place it MEANS
   * anything — it counts failures of ONE live transport, and a restarted process
   * holds a different one. It is reset by any send that leaves.
   */
  consecutiveSendFailures: number;
}

export function createContinuationState(): ContinuationState {
  return {
    lastRePromptMs: null,
    rePromptInFlight: false,
    lastSignature: null,
    adjudicated: new Set<string>(),
    pendingConversions: [],
    consecutiveSendFailures: 0,
  };
}

/** §3.7.4: the debounce window, measured from the LAST re-prompt (plan line 1462). */
const DEBOUNCE_MS = 2000;

/**
 * THE TRANSPORT FLOOR. A send that throws on the way out is charged to NOBODY
 * per pass (FW-SG-3, and the reasoning at the accounting below): a session that
 * was never asked cannot be accused of failing to progress. But a transport that
 * is permanently dead then freezes the counters forever, and §3.7's futile
 * re-prompt limit — the ONLY wedge detector — can never fire: the fault creates
 * the very wedge the engine exists to end. So consecutive failures have a floor
 * of their own, and it stops the run `env` (§2.9's kind for tooling broken).
 *
 * It is deliberately LOOSER than core/stops.ts's futile limit. That limit
 * measures an orchestrator that received three messages and did nothing; this
 * one measures a transport, where a handful of consecutive faults is still
 * plausibly transient. A single failure followed by a successful send resets it
 * and stops nothing — a fix that killed a run on one hiccup would be worse than
 * the defect it repairs.
 */
const CONSECUTIVE_SEND_FAILURE_LIMIT = 5;

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
export function resolveSessionTree(store: StateStore, entry: RegistryEntry | undefined): TreePath {
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

  // Keys are written in one settled order, so the serialization is canonical.
  return JSON.stringify({
    classificationKind: run.classification.kind,
    items,
    planReviewRounds: run.planReviewRounds,
    questions: questionProjection,
    runState: run.state,
  });
}

// ---------------------------------------------------------------------------
// Terminal-run cleanup (§4.2 worktrees + SG-4 archival)
// ---------------------------------------------------------------------------

function cleanupAndArchive(input: SessionIdleInput, run: Run, runDir: string): void {
  const { store, journal } = input;
  // SG-5's channel closes with the run: a conversion raised under it has no
  // orchestrator left to surface it to, and it must not be carried into a later
  // run (the drain below is run-scoped for exactly that). Silent loss is the one
  // thing that is not allowed, so each undelivered conversion leaves a record
  // naming what the orchestrator never heard — and is then REMOVED (ISSUE-036).
  // Reporting it and leaving it queued reports the same dead conversion twice:
  // once here as lost, once at the next drain as discarded, with the entry
  // retained for the life of the process in between.
  const closed = input.state.pendingConversions.filter((conversion) => conversion.runId === run.runId);
  const carried = input.state.pendingConversions.filter((conversion) => conversion.runId !== run.runId);
  // In place: the queue is one array the whole engine shares by reference.
  input.state.pendingConversions.length = 0;
  input.state.pendingConversions.push(...carried);
  for (const conversion of closed) {
    journal.log(
      "error",
      "state",
      "hook.failed",
      {
        hook: "continuation.surface-conversion",
        itemId: conversion.itemId,
        sessionID: conversion.sessionID,
        error:
          "the run ended before this NEEDS_CONTEXT conversion could be surfaced to the orchestrator, so it is lost: " +
          conversion.neededContext,
      },
      { runId: run.runId, ...(conversion.itemId === null ? {} : { itemId: conversion.itemId }) },
    );
  }
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

/**
 * §3.7.1's ACTIONABLE WORK, half one: the items the plan names — "items not
 * PUBLISHED/blocked". A deferred item is a judgment this run does not revisit,
 * so it is settled here exactly as it is settled for the report (§3.4).
 */
function unfinishedItemIds(store: StateStore, runId: string, queue: Queue | null): string[] {
  const ids: string[] = [];
  for (const entry of queue === null ? [] : queue.items) {
    let item: Item;
    try {
      item = store.loadItem(runId, entry.id);
    } catch {
      continue;
    }
    if (item.state === "PUBLISHED") continue;
    if (item.blocked !== null) continue;
    if (item.deferred !== null) continue;
    ids.push(item.id);
  }
  ids.sort();
  return ids;
}

/**
 * GAP-022: the run's ONE disposition and the counts the §2.9 closer reads, derived
 * from the SAME persisted item files and §2.11 ledger conductor_report derives them
 * from — so the engine and the report tool can never read one run two ways.
 */
function runClosureOf(
  store: StateStore,
  runId: string,
  queue: Queue | null,
): {
  disposition: ReturnType<typeof runDispositionOf>;
  blockedItems: number;
  openQuestions: number;
  advancedItems: number;
} {
  const items: Array<{
    id: string;
    state: string;
    dependsOn: string[];
    blocked: Item["blocked"];
    deferred: Item["deferred"];
  }> = [];
  for (const entry of queue === null ? [] : queue.items) {
    let item: Item;
    try {
      item = store.loadItem(runId, entry.id);
    } catch {
      continue;
    }
    items.push({
      id: entry.id,
      state: item.state,
      dependsOn: entry.dependsOn,
      blocked: item.blocked,
      deferred: item.deferred,
    });
  }
  const summary = store.itemsSummary(runId);
  const openQuestionIds = readOpenQuestionIds(store, runId);
  const dispositions = dispositionsOf(items, { openQuestionIds });
  return {
    disposition: runDispositionOf([...dispositions.values()], { openQuestions: summary.surfacedQuestions }),
    blockedItems: summary.blocked,
    openQuestions: summary.surfacedQuestions,
    advancedItems: items.filter((item) => item.state === "PUBLISHED").length,
  };
}

// The ids of the §2.11 questions still unanswered. Read through the run dir the
// store owns, so a torn or absent ledger reads as "no live lever" rather than
// throwing out of the idle pass (G5).
function readOpenQuestionIds(store: StateStore, runId: string): string[] {
  try {
    return readQuestions(handlerRunDir(store, runId))
      .filter((q) => q.answeredIso === null)
      .map((q) => q.id);
  } catch {
    return [];
  }
}

/**
 * ISSUE-066: is this run terminal ONLY because it recorded a resumable stop while
 * a human question is still open? Such a run is not finished with anything — it is
 * waiting, and conductor_answer is the documented way out. It keeps its pointer.
 *
 * A run terminal by FSM STATE is excluded: conductor_report has closed it and
 * written its §2.9 artifact, so there is nothing left for an answer to revive.
 */
function waitingForAnAnswer(store: StateStore, run: Run, runId: string): boolean {
  if (run.stop === null) return false;
  if (!isResumableStop(run.stop.kind)) return false;
  if (isTerminal({ state: run.state, stop: null })) return false;
  return store.itemsSummary(runId).surfacedQuestions > 0;
}

/**
 * The argless tools the gate legalizes for THIS position — the only vocabulary a
 * re-prompt may reach for when no stage tool is offered (FW-SG-1). Read off the
 * verdict, so the message can name nothing the gate withheld.
 */
function offeredMetaTools(gate: LegalToolsResult): string[] {
  return [...gate.legal.entries()]
    .filter(([, hint]) => hint.itemIds === undefined)
    .map(([tool]) => tool)
    .sort();
}

// The position that says nothing about where the run is: non-terminal (so the
// §3.2 meta tools are offered at all), with NO items — the one position with
// genuinely nothing left to do, so no stage tool and no report can be legal —
// and, below, no open question, so conductor_answer is not in play either.
const NOWHERE_IN_PARTICULAR: GateRun = {
  state: "EXECUTING",
  stop: null,
  classification: { kind: "work" },
};

/**
 * The meta tools §3.2 makes legal in EVERY non-terminal state, so that their
 * presence says nothing about where the run actually is. A legal tool OUTSIDE
 * this set is the gate naming a lever this position actually has (in the wedge,
 * conductor_answer against the §2.11 question the blocked item minted), which is
 * what makes a re-prompt something other than an invented next step.
 *
 * DERIVED from core/gates-phase.ts legalTools, which owns the fact, rather than
 * spelled out here a second time: this file once carried the four names by hand,
 * and a fifth always-legal meta tool would have had to be copied across by hand
 * with nothing to catch the omission but the engine quietly reading it as
 * position-specific.
 *
 * `publishEnabled` is the one input this probe cannot honestly assert: it reaches
 * only per-item stage tools, and the probe carries no items. So the probe does not
 * pick a mode — it asks under BOTH and keeps what they agree on, which is why this
 * call site neither inherits the parameter's default nor hardcodes a value
 * (tests/legaltools-callsites.test.ts).
 */
export const UNIVERSAL_META_TOOLS: readonly string[] = ((): readonly string[] => {
  const modes: readonly boolean[] = [true, false];
  let universal: string[] | null = null;
  for (const publishEnabled of modes) {
    const verdict = legalTools(NOWHERE_IN_PARTICULAR, [], [], true, publishEnabled);
    const offered = [...verdict.legal.keys()];
    universal = universal === null ? offered : universal.filter((tool) => verdict.legal.has(tool));
  }
  return universal === null ? [] : universal.sort();
})();

function positionSpecificTools(offered: string[]): string[] {
  return offered.filter((tool) => !UNIVERSAL_META_TOOLS.includes(tool));
}

function composeRePrompt(
  run: Run,
  recommended: { tool: string; args: { itemId?: string } } | null,
  conversions: NeedsContextConversion[],
  unfinished: string[],
  offered: string[],
): string {
  const lines: string[] = [
    "conductor: this session has gone idle while run " + run.runId + " still has work to do.",
    "",
    "Run state: " + run.state + ".",
  ];
  if (recommended === null) {
    // FW-SG-1: no stage tool is offered here, so none is named. What the gate DID
    // return is named instead, together with the work that is still outstanding —
    // the fact §3.7.1 calls actionable.
    lines.push("The phase gate offers no per-item stage tool here: nothing is schedulable this wave.");
    lines.push("Still unfinished — neither published, blocked nor deferred: " + unfinished.join(", ") + ".");
    lines.push("The actions the gate legalizes right now: " + offered.join(", ") + ".");
  } else {
    lines.push(
      "The phase gate's next action is: " +
        recommended.tool +
        (recommended.args.itemId === undefined ? "" : " for item " + recommended.args.itemId) +
        ".",
    );
  }
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
  lines.push(
    recommended === null
      ? "Take one of those actions now — answering the open question that is holding the run is how the outstanding work becomes schedulable again."
      : "Call that action now, or answer the open question that is holding the run.",
  );
  return lines.join("\n");
}

/**
 * Takes the conversions belonging to `runId` off the process-scoped queue, and
 * DISCARDS the rest with a record. A conversion names an item by id, and an id
 * only means anything inside the run it was raised under; delivering a foreign
 * one would hand the orchestrator an item its run does not contain.
 */
function takeConversionsFor(
  state: ContinuationState,
  runId: string,
  journal: ContinuationJournal,
  sessionID: string,
): NeedsContextConversion[] {
  const mine: NeedsContextConversion[] = [];
  const foreign: NeedsContextConversion[] = [];
  for (const conversion of state.pendingConversions) {
    (conversion.runId === runId ? mine : foreign).push(conversion);
  }
  state.pendingConversions.length = 0;
  for (const conversion of foreign) {
    journal.log(
      "error",
      "state",
      "hook.failed",
      {
        hook: "continuation.surface-conversion",
        itemId: conversion.itemId,
        sessionID: conversion.sessionID,
        error:
          "this NEEDS_CONTEXT conversion was raised under run " +
          (conversion.runId ?? "(no run)") +
          ", which is no longer the live run, so it is discarded rather than surfaced under another run's items: " +
          conversion.neededContext,
      },
      { runId, sessionID },
    );
  }
  return mine;
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

  // (c) The C-032 E7 repair, before any re-prompt or stop decision — both layers:
  //     the intents a killed block-and-ask left behind, then the ledger sweep that
  //     catches an ask whose intent never landed (GAP-028).
  replayBlockIntents({ store, runId, runDir, journal, now });
  reconcileOrphanQuestions(store, runId, runDir, journal);

  // (c2) GAP-013's out-of-band channel, ingested BEFORE the terminality and
  //      futility verdicts below. The operator answers by dropping a file into the
  //      state area no session may write, and this pass is what turns that file
  //      into an answer — so a run that STOPPED waiting on the question is revived
  //      by the same idle pass that finds it, with no model call anywhere in the
  //      path. Ingesting after the terminality check would archive the run first
  //      and lose exactly the work ISSUE-066 is about.
  ingestAnswerFiles({ store, runId, journal, now });

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
    // ISSUE-066: a run that stopped WAITING is exactly the run whose committed
    // work archiving loses. Archiving clears the current-run pointer, so the
    // documented conductor_answer resume path had nothing left to revive: the
    // honest waiting model lost its work while the model that deferred the same
    // item closed clean. A run terminal only by a RESUMABLE stop record, still
    // holding the unanswered question it is waiting on, keeps its pointer.
    if (waitingForAnAnswer(store, run, runId)) {
      journal.log(
        "info",
        "continuation",
        "idle",
        {
          why:
            "the run stopped " +
            String(run.stop?.kind) +
            " and an unanswered question still gates it: the pointer is held so conductor_answer can revive it",
          runState: run.state,
        },
        { runId, sessionID },
      );
      return { runId, prompted: false, stop: null };
    }
    cleanupAndArchive(input, run, runDir);
    return { runId, prompted: false, stop: null };
  }

  // (f) PROGRESS BEFORE THE VERDICT. The futility signature is computed here,
  //     ahead of the wedge rule, because a run that MOVED since the last
  //     re-prompt is not wedged and must not be stopped on a counter that
  //     describes the state it has already left. Deciding first and comparing
  //     afterwards killed exactly the run that finally did the work in response
  //     to the third re-prompt: the observation was in hand and simply never
  //     consulted. The reset is skipped when this process has no prior
  //     observation (SG-3's restart case) — there is nothing to compare against,
  //     and inventing progress would be as wrong as inventing futility.
  const queue = readQueue(runDir);
  const signature = signatureOf(store, run, runDir, queue);
  const movedSinceLastRePrompt = state.lastSignature !== null && state.lastSignature !== signature;
  if (movedSinceLastRePrompt && run.counters.futileRePrompts > 0) {
    run.counters.futileRePrompts = 0;
    store.saveRun(run);
  }

  // (g) The wedge rule (Task 1.3), consulted with the PERSISTED counters BEFORE
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
  // GAP-021 / ISSUE-065: `blocked` and `surfaced` used to belong to "another
  // recorder" — conductor_report — which could not write them: it hardcoded
  // `done`. A delegation ring with no writer, in which a run whose every remaining
  // item waited on a human either closed "the run completed" or sat in EXECUTING
  // forever. The engine records what the closer decided, writes the §2.9 artifact
  // through the ONE writer, and — because both kinds are RESUMABLE — leaves the
  // pointer alone so an answer can revive the run instead of finding it archived.
  if (verdict.stop && (verdict.kind === "blocked" || verdict.kind === "surfaced")) {
    const tsMs = now();
    const summary = store.itemsSummary(runId);
    const reasonDisplay =
      verdict.kind === "blocked"
        ? "no item can be advanced by this run: " +
          String(summary.blocked) +
          " blocked, " +
          String(summary.deferred) +
          " deferred, " +
          String(summary.surfacedQuestions) +
          " question(s) open — a human holds the next move"
        : String(summary.surfacedQuestions) +
          " human-territory question(s) are open and no item is schedulable: the run waits on an answer";
    const stop: StopRecorded = { kind: verdict.kind, reasonDisplay, tsMs };
    run = recordStop(store, run, stop);
    journal.log(
      "info",
      "continuation",
      "disengage",
      { stop: stop.kind, reasonDisplay, ...summary },
      { runId, sessionID },
    );
    await driveStopReport(input, runId);
    if (!waitingForAnAnswer(store, store.loadRun(runId), runId)) {
      cleanupAndArchive(input, run, runDir);
    }
    return { runId, prompted: false, stop };
  }
  // `env` remains the override hatch's to record and `done` conductor_report's
  // (§2.9:900-905): this engine writes neither.

  // (h) The gate's own verdict. No second next-step derivation exists.
  const gate = waveVerdict(store, runId, runDir, queue ?? { items: [] });
  const recommended = gate.recommended;

  // §3.7.1 gates re-prompting on ACTIONABLE WORK — "items not PUBLISHED/blocked,
  // or a legal next run transition" — NOT on a recommended stage tool. The two
  // came apart in exactly the shape §2.9:911-915 calls the worst failure of the
  // original design: with A blocked behind an open question and B carrying
  // dependsOn:[A], cannotEverPublish rightly refuses to call B permanently stuck
  // (so conductor_report rightly refuses too) while depsReady rightly keeps both
  // out of the wave (so `recommended` is null). Returning here on that position
  // froze the counters, which disabled §3.7's ONLY wedge detector, and the run sat
  // in EXECUTING forever with no human-readable artifact.
  //
  // SG-2's branch is kept for the case it was written for. Its concern is real —
  // "prompting a tool nobody offered would invent state; counting it as a futile
  // RE-prompt would be a lie, because nothing was re-prompted" — and it is honoured
  // two ways: the engine stays silent when nothing is actionable, and when it does
  // speak it names only what `offeredMetaTools` read off this very verdict.
  const offered = offeredMetaTools(gate);
  const unfinished = recommended === null ? unfinishedItemIds(store, runId, queue) : [];
  const actionable =
    recommended !== null || (unfinished.length > 0 && positionSpecificTools(offered).length > 0);
  if (!actionable) {
    // ISSUE-067: this silence was the whole wedge. A blocked item no answer can
    // release, plus a dependent, offered no stage tool, no conductor_answer and no
    // report — so the futile counter never moved, no §2.9 kind was reachable, and
    // the run sat in EXECUTING forever with nothing on disk saying so. The
    // discriminator is the run's ONE disposition: `stuck` means unfinished work
    // with no lever a human or this run could pull, which is a stop, not a pause.
    // `waiting-human` and `settled` stay silent — the first has an answer coming,
    // the second is a run whose closer is the report tool.
    const closure = runClosureOf(store, runId, queue);
    if (closure.disposition === "stuck") {
      const tsMs = now();
      const stopVerdict = stopKindOf({ cause: "settle", run: closure });
      const stop: StopRecorded = {
        kind: stopVerdict.kind,
        reasonDisplay:
          stopVerdict.why +
          "; the gate offers no lever here: " +
          gate.why,
        tsMs,
      };
      run = recordStop(store, run, stop);
      journal.log(
        "info",
        "continuation",
        "disengage",
        { stop: stop.kind, reasonDisplay: stop.reasonDisplay, disposition: closure.disposition },
        { runId, sessionID },
      );
      await driveStopReport(input, runId);
      cleanupAndArchive(input, run, runDir);
      return { runId, prompted: false, stop };
    }
    journal.log("info", "continuation", "idle", { why: gate.why, runState: run.state }, { runId, sessionID });
    return { runId, prompted: false, stop: null };
  }

  // (i) §3.7.4 debounce and the one-in-flight latch — INDEPENDENT guards.
  if (state.rePromptInFlight) return { runId, prompted: false, stop: null };
  if (state.lastRePromptMs !== null && now() - state.lastRePromptMs < DEBOUNCE_MS) {
    return { runId, prompted: false, stop: null };
  }

  // (j) The message, the send, and — only if the send actually left this process —
  //     the accounting. A signature that DIFFERS from the last one this engine
  //     observed is progress and resets the futile counter; an equal one increments
  //     it. The comparison is the same one (f) already made, and it is made against
  //     the same observation, so the two can never disagree.
  //
  //     The third case is a pass with NO prior observation. SG-3 keeps the last
  //     signature in memory while the counters are persisted, so a process
  //     restart lands here with counters mid-count and nothing to compare them
  //     against. The information is genuinely gone: the signature of the state
  //     as of the previous re-prompt is not recoverable from run.json. Since
  //     §3.7's wedge detector may only fire on a run that is NOT moving, such a
  //     pass carries the persisted futile counter forward UNTOUCHED rather than
  //     counting a re-prompt it never observed — the same trade SG-3 already
  //     takes on the debounce clock (a restart may cost one extra prompt; it may
  //     never cost a live run). A run that has never been re-prompted at all
  //     (idleRePrompts 0) has no lost observation, so its first re-prompt counts
  //     normally, which is what keeps 1,2,3 true for a fresh wedge.
  const resumedMidCount = state.lastSignature === null && run.counters.idleRePrompts > 0;

  // Only THIS run's conversions ride along; anything raised under an earlier run
  // is discarded here rather than delivered, and either way the queue is left
  // holding nothing that has already been accounted for.
  const conversions = takeConversionsFor(state, runId, journal, sessionID);
  const text = composeRePrompt(run, recommended, conversions, unfinished, offered);

  // The prompt is FIRED, not awaited: the latch is what bounds concurrency, and
  // awaiting the orchestrator's reply here would hold the hook open for the whole
  // turn. It clears when the prompt settles, either way — and a SYNCHRONOUS throw
  // out of the SDK call settles it too. A latch left raised by a transient
  // transport fault silences the idle engine for the life of the process, which
  // freezes the counters, which means the wedge detector can never fire: the
  // fault would create the very wedge this engine exists to end.
  //
  // The conversions were drained BEFORE the send, so a failed send would destroy
  // the only channel a refused sub-session has to the orchestrator (SG-5). They
  // go back on the queue instead, ahead of anything raised since, and the failure
  // is journaled like every other G5 fail-soft path in this file.
  state.rePromptInFlight = true;
  const settle = (): void => {
    state.rePromptInFlight = false;
  };
  const failed = (err: unknown): void => {
    settle();
    state.pendingConversions.unshift(...conversions);
    journal.log(
      "error",
      "state",
      "hook.failed",
      {
        hook: "continuation.reprompt",
        surfaced: conversions.length,
        error: err instanceof Error ? err.message : String(err),
      },
      { runId, sessionID },
    );
  };
  let sent = true;
  try {
    input.client.session.prompt({ path: { id: sessionID }, body: { parts: [{ type: "text", text }] } }).then(
      settle,
      failed,
    );
  } catch (err) {
    sent = false;
    failed(err);
  }

  // THE ACCOUNTING FOLLOWS THE SEND, and a send that threw on the way out never
  // happened: nothing left this process, so nothing about it may be charged to the
  // ORCHESTRATOR. Charging it anyway walked a merely unreachable transport to the
  // §3.7 futility threshold in three passes and killed the run with a durable
  // "no observable progress across 3 consecutive re-prompts" — an accusation
  // against a session that was never asked once. The error record `failed` already
  // wrote is the whole and correct trace of such a pass. The debounce clock is
  // left alone for the same reason: it paces re-prompts the orchestrator receives.
  //
  // A call that RETURNED, and rejects later, did leave: it is counted here, and its
  // rejection is fail-soft in `failed`, which puts the conversions back so nothing
  // the sub-sessions raised is lost with it — and the futile rule above already
  // bounds THAT case, because the pass was charged.
  //
  // What the un-charged case needs instead is a floor of its own. Nothing durable
  // moves on a failed pass, so without one a permanently dead transport idles
  // forever: the counters never move, §3.7's only wedge detector never fires, and
  // the run has no artifact and no end. The count is CONSECUTIVE (any send that
  // leaves resets it below), so a transient fault costs the run nothing.
  if (!sent) {
    state.consecutiveSendFailures += 1;
    if (state.consecutiveSendFailures < CONSECUTIVE_SEND_FAILURE_LIMIT) {
      return { runId, prompted: false, stop: null };
    }
    const tsMs = now();
    const reasonDisplay =
      "the orchestrator session could not be reached: " +
      String(state.consecutiveSendFailures) +
      " consecutive re-prompts failed in transport before they left this process, so the run is stopping rather than idling against a dead transport (§2.9 env: tooling broken)";
    // §2.8 WRITE-AHEAD, as on the wedge path: the trace lands before the stop and
    // the report, so a process killed mid-disengagement still leaves it.
    appendAnomaly(runDir, { ts: tsMs, kind: "disengage", detail: reasonDisplay });
    const stop: StopRecorded = { kind: "env", reasonDisplay, tsMs };
    run = recordStop(store, run, stop);
    journal.log(
      "info",
      "continuation",
      "disengage",
      { stop: stop.kind, consecutiveSendFailures: state.consecutiveSendFailures, reasonDisplay },
      { runId, sessionID },
    );
    // §2.9's normative rule holds for THIS stop too: every stop writes a report,
    // through the ONE writer, in its stop mode — no closing verify.
    await driveStopReport(input, runId);
    cleanupAndArchive(input, run, runDir);
    state.consecutiveSendFailures = 0;
    return { runId, prompted: false, stop };
  }
  state.consecutiveSendFailures = 0;

  run.counters.idleRePrompts += 1;
  if (!resumedMidCount) {
    run.counters.futileRePrompts = movedSinceLastRePrompt ? 0 : run.counters.futileRePrompts + 1;
  }
  store.saveRun(run);
  state.lastSignature = signature;
  state.lastRePromptMs = now();

  journal.log(
    "info",
    "continuation",
    "reprompt",
    {
      // Null when the gate offered no stage tool and the re-prompt named the meta
      // tools instead: the record states what the gate returned, not a tool the
      // engine picked.
      tool: recommended === null ? null : recommended.tool,
      itemId: recommended === null ? null : (recommended.args.itemId ?? null),
      unfinished,
      offered,
      idleRePrompts: run.counters.idleRePrompts,
      futileRePrompts: run.counters.futileRePrompts,
      surfaced: conversions.length,
    },
    { runId, sessionID },
  );

  return { runId, prompted: sent, stop: null };
}

// ---------------------------------------------------------------------------
// handlePermissionAsked — the §3.5(b)/§3.6 ask-gate
// ---------------------------------------------------------------------------

// SG-10: wire-notes.md:110 records `patterns`/`metadata` as NEVER asserted, so
// which field carries the edit's path is unverified. Extraction order is
// metadata.filePath, then metadata.path, then a single CONCRETE (wildcard-free)
// entry of `patterns`. Anything else yields null and the ask FAILS CLOSED.
//
// A WILDCARD anywhere in `patterns` makes the whole payload unadjudicable, and
// that is checked FIRST — before the metadata fields and before the single-entry
// rule. The reply grants the ASK, not the path the gate happened to check, so
// filtering the wildcards out and adjudicating on whatever concrete entry remains
// would grant `**` on the strength of one covered file. SG-10's degradation is
// "the claim does not work", never "the orchestrator may edit anything".
function stringField(metadata: Record<string, unknown> | undefined, key: string): string | null {
  if (metadata === undefined) return null;
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasWildcard(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

function extractAskPath(event: PermissionAskedEvent): string | null {
  const patterns = event.patterns ?? [];
  if (patterns.some((pattern) => hasWildcard(pattern))) return null;
  // The wildcard screen governs EVERY field the extraction can return, not only
  // `patterns`. The metadata fields WIN the precedence, so a wildcard riding
  // `metadata.filePath` was adjudicated as one concrete file and replied "once" —
  // the `**`-on-one-file grant SG-10 forbids, arriving through the field the
  // extraction prefers most. The field that wins the precedence is the field that
  // decides: a wildcard in it makes the payload unadjudicable outright, never a
  // reason to fall through to a lower-precedence field, which would grant the
  // wildcard ask on the strength of some other entry.
  const direct = stringField(event.metadata, "filePath") ?? stringField(event.metadata, "path");
  if (direct !== null) return hasWildcard(direct) ? null : direct;
  const concrete = patterns.filter((pattern) => pattern.length > 0);
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
      runId: runId ?? null,
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
