// conductor/core/schedule.ts — §4.2 the wave scheduler (Task 3.3; plan lines
// 1544-1618, 2261-2273). Core module: pure — no I/O, no runtime globals, no wall
// clock. Given a queue (scopes + dependency edges), the runtime item facts
// (state + blocked/deferred annotations), and the config caps, it computes the
// next MAXIMAL parallel wave and the per-stage read fan-out.
//
// A wave (§4.2) is the maximal set of items that are (a) dependency-ready — every
// dependsOn maps to a PUBLISHED item, nothing below PUBLISHED unlocks; (b)
// pairwise fileScope-disjoint via the conservative scopesIntersect (§1.2, plan
// 2091-2093 — a shared literal head over-approximates to "intersecting", which
// only ever costs parallelism); (c) not blocked or deferred; (d) within
// parallel.maxImplementers; and never an already-PUBLISHED item. The order is
// intrinsic (DAG depth ascending, then id ascending), so it is invariant under
// input reordering.
//
// Defense-in-depth (Phase-1 adversarial gate binding, task-3.3.assertions.json):
// scopesIntersect([], X) returns false — an EMPTY fileScope reads as DISJOINT and
// would otherwise join every wave. A wildcard-headed glob (empty literal head)
// is the mirror trap. Both are DEGENERATE scopes: the scheduler treats a
// degenerate-scope item as conflicting with all others so it never shares a wave,
// explicitly, rather than trusting scopesIntersect on the empty case.

import { isWildcardHeaded, scopesIntersect } from "./shell-parse.ts";

// ---------------------------------------------------------------------------
// Minimal structural param shapes (the pure scheduler consumes only these
// fields). Deliberately narrower than the full §2.4 Queue / §2.5 Item / §2.1
// Config in ./types.ts so the callers' real records AND the tests' minimal
// fixtures are both assignable under tsc --strict.
// ---------------------------------------------------------------------------

// §2.4 queue item, scheduler subset: identity, write scope, dependency edges.
export interface ScheduleQueueItem {
  id: string;
  fileScope: string[];
  dependsOn: string[];
}

export interface ScheduleQueue {
  items: ScheduleQueueItem[];
}

// §2.5 runtime item, scheduler subset: FSM position plus the two annotations
// that veto scheduling. A non-null blocked/deferred excludes the item.
export interface ScheduleItem {
  id: string;
  state: string;
  blocked: { reason: string } | null;
  deferred: { reason: string } | null;
}

// §2.1 config, scheduler subset: the two caps this module enforces.
export interface ScheduleConfig {
  parallel: { maxImplementers: number; maxReaders: number };
  workflow: {
    planReviewers: number;
    itemReviewers: number;
    vetCritics: number;
    skepticsPerFinding: number;
  };
}

export interface WavePlan {
  parallel: string[];
  rationale: string;
}

// The read-fan-out stages (§4.3): each maps to one workflow reader count.
export type ReadStage = "planReview" | "itemReview" | "vet" | "skeptics";

// The dependency state that unlocks a dependent (§4.2): only PUBLISHED counts.
const PUBLISHED = "PUBLISHED";

// ---------------------------------------------------------------------------
// Scope degeneracy — the conservative-serialize binding.
// ---------------------------------------------------------------------------

// True when a fileScope must be treated as conflicting with EVERY other scope:
// an empty list (no files named — scopesIntersect reads it as disjoint, the trap
// this guards) OR any glob whose literal head is empty (a wildcard-headed first
// path segment prefixes every path). A degenerate-scope item never shares a wave.
// The wildcard-construct vocabulary is shell-parse's own isWildcardHeaded, so the
// scheduler and the §3.2 queue-acceptance rule cannot disagree about what
// "wildcard-headed" means.
function isDegenerateScope(fileScope: string[]): boolean {
  if (fileScope.length === 0) return true;
  return fileScope.some((glob) => isWildcardHeaded(glob));
}

// ---------------------------------------------------------------------------
// DAG depth (the deterministic-order key).
// ---------------------------------------------------------------------------

// Longest-dependency-chain depth over the FULL queue graph: 0 for an item with
// no dependsOn, else 1 + max depth of its dependencies. Computed from the edges
// alone (independent of publish state), so an item's ordinal is intrinsic. An
// unknown dependency id contributes 0; the in-progress guard makes a malformed
// cyclic edge terminate rather than recurse forever (the queue is a DAG by
// §2.4, so this is a safety floor, not a live path).
function computeDepth(
  id: string,
  byId: Map<string, ScheduleQueueItem>,
  memo: Map<string, number>,
  inProgress: Set<string>,
): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const item = byId.get(id);
  if (item === undefined || inProgress.has(id)) return 0;
  inProgress.add(id);
  let maxDep = -1;
  for (const dep of item.dependsOn) {
    const depDepth = computeDepth(dep, byId, memo, inProgress);
    if (depDepth > maxDep) maxDep = depDepth;
  }
  inProgress.delete(id);
  const depth = maxDep + 1;
  memo.set(id, depth);
  return depth;
}

// ---------------------------------------------------------------------------
// nextWave
// ---------------------------------------------------------------------------

interface Candidate {
  id: string;
  fileScope: string[];
  depth: number;
  degenerate: boolean;
}

/**
 * Compute the next parallel wave (§4.2). Returns the maximal set of item ids
 * that are dependency-ready, pairwise scope-disjoint (conservative; a degenerate
 * scope conflicts with all), unblocked/undeferred, not already PUBLISHED, and
 * within config.parallel.maxImplementers — in DAG-depth-then-id order, which is
 * invariant under input reordering. `rationale` is always a non-empty string.
 */
export function nextWave(
  queue: ScheduleQueue,
  items: ScheduleItem[],
  config: ScheduleConfig,
): WavePlan {
  const byQueueId = new Map<string, ScheduleQueueItem>();
  for (const q of queue.items) byQueueId.set(q.id, q);

  const runtimeById = new Map<string, ScheduleItem>();
  const publishedIds = new Set<string>();
  for (const it of items) {
    runtimeById.set(it.id, it);
    if (it.state === PUBLISHED) publishedIds.add(it.id);
  }

  const depthMemo = new Map<string, number>();
  const inProgress = new Set<string>();

  // Gather candidates: a queue item with a runtime record that is open
  // (not PUBLISHED, not blocked, not deferred) and dependency-ready.
  const candidates: Candidate[] = [];
  for (const q of queue.items) {
    const runtime = runtimeById.get(q.id);
    if (runtime === undefined) continue; // no runtime facts -> cannot schedule
    if (runtime.state === PUBLISHED) continue; // already done, never a member
    if (runtime.blocked !== null) continue; // §4.2 (c): blocked excluded
    if (runtime.deferred !== null) continue; // §4.2 (c): deferred excluded

    let depsReady = true;
    for (const dep of q.dependsOn) {
      if (!publishedIds.has(dep)) {
        depsReady = false; // nothing below PUBLISHED unlocks (§4.2 (a))
        break;
      }
    }
    if (!depsReady) continue;

    candidates.push({
      id: q.id,
      fileScope: q.fileScope,
      depth: computeDepth(q.id, byQueueId, depthMemo, inProgress),
      degenerate: isDegenerateScope(q.fileScope),
    });
  }

  // Deterministic order: DAG depth ascending, then id ascending. This is the
  // order the wave is emitted in and the order greedy selection walks, so the
  // wave is a pure function of the inputs' content, not their arrangement.
  candidates.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const cap = config.parallel.maxImplementers;
  const parallel: string[] = [];
  const selected: Candidate[] = [];
  for (const cand of candidates) {
    if (parallel.length >= cap) break; // §4.2 (d): maxImplementers cap
    let conflicts = false;
    for (const chosen of selected) {
      // Two items may share a wave only if BOTH scopes are concrete and
      // genuinely disjoint. A degenerate scope on either side, or a
      // conservative scopesIntersect hit, forces serialization (§4.2 (b)).
      if (
        cand.degenerate ||
        chosen.degenerate ||
        scopesIntersect(cand.fileScope, chosen.fileScope)
      ) {
        conflicts = true;
        break;
      }
    }
    if (conflicts) continue;
    parallel.push(cand.id);
    selected.push(cand);
  }

  const rationale =
    parallel.length > 0
      ? `Scheduled ${parallel.length} item(s) [${parallel.join(", ")}] this wave from ${candidates.length} dependency-ready candidate(s): pairwise scope-disjoint (degenerate scopes serialized), capped at maxImplementers=${cap}, ordered by DAG depth then id.`
      : `No items schedulable this wave: none are simultaneously dependency-ready (deps PUBLISHED), unblocked/undeferred, and scope-free of the already-selected set within maxImplementers=${cap}.`;

  return { parallel, rationale };
}

// ---------------------------------------------------------------------------
// readFanout
// ---------------------------------------------------------------------------

// The configured reader count for a stage (§4.3): the stage vocabulary maps
// exactly onto four workflow counts. Exhaustive over ReadStage.
function stageCount(stage: ReadStage, config: ScheduleConfig): number {
  switch (stage) {
    case "planReview":
      return config.workflow.planReviewers;
    case "itemReview":
      return config.workflow.itemReviewers;
    case "vet":
      return config.workflow.vetCritics;
    case "skeptics":
      return config.workflow.skepticsPerFinding;
  }
}

/**
 * The per-stage read fan-out (§4.3): the stage's configured reader count clamped
 * to the parallel.maxReaders ceiling — min(stageCount, maxReaders). "Up to
 * maxReaders" readers dispatch for that stage.
 */
export function readFanout(stage: ReadStage, config: ScheduleConfig): number {
  const configured = stageCount(stage, config);
  const ceiling = config.parallel.maxReaders;
  return configured < ceiling ? configured : ceiling;
}
