// conductor/adapter/chat-message.ts — Task 5.4: the `chat.message` hook BODY,
// factored as a testable adapter function (the opencode plugin wiring lives in
// Task 5.3's plugin/index.ts). Plan lines 1064-1075 (§3.2 INTAKE run creation),
// 1344-1347 (§3.5 orchestrator registry entry), 1496-1509 (§3.9 no-git).
//
// This is the glue between an arriving user prompt and a conductor run:
//   - a prompt with NO live run (none, or isTerminal(currentRun) — §2.3's single
//     terminality definition) CREATES the run (state INTAKE, current-run pointed
//     at it) and reports any §2.11 stale-red exclusions in its first response;
//   - a prompt arriving DURING a live (non-terminal) run is routed into it as
//     orchestrator context — journaled `user.midrun-prompt` — and NEVER starts a
//     fresh run (plan line 1073).
//
// ADAPTER (G14): a THIN composition over subjects that already exist —
// adapter/state.ts (openWorkspace -> StateStore, which owns run creation and the
// startHead/startBranch/startDirty + excludedStaleRed capture) and core/stops.ts
// (isTerminal). It touches no filesystem, spawns no process, and reads no wall
// clock of its own: every durable write and every stamped timestamp goes through
// the injected store. It uses no single-runtime API and no shell tag, so it runs
// under both the opencode runtime and Node type-stripping.

import { isTerminal } from "../core/stops.ts";
import type { TreePath } from "../core/types.ts";
import type { CreateRunInput, StateStore } from "./state.ts";

// The §3.5 session-registry the gate also consults. chat.message writes the
// orchestrator session's entry; the fan-out engine (elsewhere) writes the
// sub-session entries. `receivingReview` marks a §3.3 review-fix dispatch —
// buildSystemAppend keys the receive-review.md secondary-pack delivery on it.
export interface SessionRegistryEntry {
  role: string;
  itemId?: string;
  // The tree PATH the §3.5 gates judge the session against (core/types.ts brands
  // it apart from the evidence layer's marker slug). Absent until
  // adapter/continuation.ts resolveSessionTree records the workspace root onto
  // the orchestrator's own entry.
  tree?: TreePath;
  receivingReview?: boolean;
}
export interface SessionRegistry {
  register(sessionID: string, entry: SessionRegistryEntry): void;
  get(sessionID: string): SessionRegistryEntry | undefined;
}

// The journal sink the hook writes `user.midrun-prompt` through. Structurally the
// adapter/state.ts StateJournal (log-only; runId optional because a hook can
// precede its run). `user.midrun-prompt` is registered under the `state`
// component in the closed §7.4 vocabulary (core/journal-events.ts), so a real
// createJournal accepts it.
export interface ChatMessageJournal {
  log(
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ): void;
}

export interface HandleChatMessageInput {
  store: StateStore; // the openWorkspace() result
  registry: SessionRegistry; // the §3.5 session registry (orchestrator entry written here)
  sessionID: string; // the arriving (orchestrator) session
  prompt: string; // the user's prompt text
  journal: ChatMessageJournal;
  now?: () => number; // optional injected clock for any ts the hook itself stamps
}

// A FLAT result (not a discriminated union) so callers need no narrowing:
//  - "created":       a fresh run was minted; runId is that fresh run; staleReport
//                     is the user-facing exclusion notice (null when none in force).
//  - "routed-midrun": no run created; runId is the LIVE run the prompt was routed
//                     into; staleReport is null.
export interface ChatMessageResult {
  action: "created" | "routed-midrun";
  runId: string;
  staleReport: string | null;
}

// The orchestrator's registry role (§3.5). Registering the orchestrator session is
// idempotent: chat.message owns this entry and re-asserts it on every prompt.
const ORCHESTRATOR: SessionRegistryEntry = { role: "orchestrator" };

// The classification is unknown at INTAKE — the orchestrator's first legal tool,
// conductor_classify, runs LATER and overwrites this (plan lines 1076-1094). The
// hook synthesizes a schema-valid provisional classification so run.json is a
// durable, valid §2.3 Run the moment it is created: kind "work" keeps the run in
// INTAKE (plan line 1093, "work ⇒ the run stays in INTAKE with the classification
// recorded"), and the check is recorded as not-yet-agreed because the skeptic
// CLASSIFICATION_CHECK has not run.
const PROVISIONAL_CLASSIFICATION: CreateRunInput["classification"] = {
  kind: "work",
  rationale: "provisional at intake; conductor_classify has not run yet",
  check: { agreed: false, note: "classification check pending conductor_classify" },
};

// Build the §3.2 first-response notice for the stale-red exclusions carried into
// this run. Returns null when none are in force; otherwise a sentence naming the
// count and using the plan's phrasing ("still red", "excluded from verification").
function staleReportOf(excluded: readonly string[]): string | null {
  const count = excluded.length;
  if (count === 0) return null;
  const noun = count === 1 ? "test file" : "test files";
  return (
    `${count} ${noun} from earlier runs are still red and are excluded from ` +
    "verification."
  );
}

export function handleChatMessage(input: HandleChatMessageInput): ChatMessageResult {
  const { store, registry, sessionID, prompt, journal } = input;

  const live = store.currentRun();
  const hasLiveRun = live !== null && !isTerminal(live);

  if (hasLiveRun) {
    // A prompt arriving DURING a live run is routed into it as orchestrator
    // context — never a fresh run (plan line 1073). Journal it as
    // `user.midrun-prompt`, correlated to the live run, with the prompt text
    // preserved so the orchestrator context is not lost.
    const liveRunId = live.runId;
    journal.log("info", "state", "user.midrun-prompt", { prompt }, { runId: liveRunId, sessionID });
    // Idempotent re-assertion of the orchestrator's §3.5 registry entry.
    registry.register(sessionID, ORCHESTRATOR);
    return { action: "routed-midrun", runId: liveRunId, staleReport: null };
  }

  // No live run (none, or the last run is terminal): create a fresh run. The
  // store captures startHead/startBranch/startDirty + excludedStaleRed and points
  // current-run at the fresh run (§3.2), coercing the git terms to "" under §3.9.
  const run = store.createRun({ prompt, sessionID, classification: PROVISIONAL_CLASSIFICATION });
  registry.register(sessionID, ORCHESTRATOR);
  return {
    action: "created",
    runId: run.runId,
    staleReport: staleReportOf(run.excludedStaleRed),
  };
}
