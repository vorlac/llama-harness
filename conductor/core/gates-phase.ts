// conductor/core/gates-phase.ts — §3.4 tool-legality per FSM state (Task 3.2;
// plan lines 1064-1159, 1303-1333, 1544-1618, 2234-2260). Core module: pure —
// no I/O, no runtime globals, no wall clock. Given the run's FSM position, its
// items' FSM positions + annotations, the open-question set, and whether the
// repo is configured, it derives the ONE tool-legality verdict the phase-order
// gate, the injection, and the continuation engine all consume (one derivation,
// three consumers — they can never disagree, §3.2).
//
// The verdict has three parts:
//   legal        — Map<toolName, {itemIds?}>: every tool callable right now. A
//                  per-item stage tool carries the ids it may target, aggregated
//                  across the items at that stage; a meta tool carries {}.
//   recommended  — the single next tool to run, or null. In EXECUTING it is the
//                  §4.2 wave-order-first item's next stage tool (DAG depth then
//                  id — via nextWave, the SAME derivation the scheduler uses, so
//                  it is invariant under item-array reordering).
//   why          — a non-empty rationale.

import { nextWave } from "./schedule.ts";

// ---------------------------------------------------------------------------
// The §3.4 conductor_* tool names this gate emits (the EXACT inventory names —
// the phase-order gate, the injection, and the continuation engine all key off
// these). Only the tools this gate can legalize are named here.
// ---------------------------------------------------------------------------

const CLASSIFY = "conductor_classify";
const DECOMPOSE = "conductor_decompose";
const PLAN = "conductor_plan";
const PLAN_REVIEW = "conductor_plan_review";
const DISPATCH_WAVE = "conductor_dispatch_wave";
const SUBMIT_TEST = "conductor_submit_test";
const VET_TEST = "conductor_vet_test";
const MARK_GREEN = "conductor_mark_green";
const VALIDATE = "conductor_validate";
const ITEM_REVIEW = "conductor_item_review";
const PUBLISH = "conductor_publish";
const REPORT = "conductor_report";
const SURFACE = "conductor_surface";
const ANSWER = "conductor_answer";
const DEFER = "conductor_defer";
const DECIDE = "conductor_decide";
const STATUS = "conductor_status";
const SETUP = "conductor_setup";

// ---------------------------------------------------------------------------
// Minimal structural param shapes (this gate consumes only these fields). Kept
// narrower than the full §2.3 Run / §2.5 Item / §2.11 QuestionRecord in
// ./types.ts so the callers' real records AND the tests' minimal fixtures both
// assign under tsc --strict.
// ---------------------------------------------------------------------------

// §2.3 run, gate subset: FSM position, the terminal stop record (its PRESENCE is
// all this gate reads — §2.3 terminality), and the recorded classification
// (null until conductor_classify records it).
export interface GateRun {
  state: string;
  stop: { kind: string } | null;
  classification: { kind: string } | null;
}

// §2.5 item, gate subset: identity, FSM position, behavioral kind, the scheduler
// inputs (dependsOn + fileScope, consumed by nextWave), and the two annotations
// that veto every stage tool.
export interface GateItem {
  id: string;
  state: string;
  behavioral: boolean;
  dependsOn: string[];
  fileScope: string[];
  blocked: { reason: string } | null;
  deferred: { reason: string } | null;
  // §3.3 DEBUG-posture annotation (gate-subset view). Optional and ignored by
  // legalTools — it does not veto or select any stage tool; it is read only by the
  // injection layer to deliver debug.md to an implementer whose item is in DEBUG.
  debugging?: boolean;
}

// §2.11 question, gate subset: an unanswered question (answeredIso === null) is
// the ONLY fact that legalizes conductor_answer. `id` is carried so an inline
// question literal ({id, answeredIso}) assigns without an excess-property error.
export interface GateQuestion {
  id: string;
  answeredIso: string | null;
}

// The Map value: for a per-item stage tool, the ids it may target right now;
// meta tools carry no ids.
export interface ArgsHint {
  itemIds?: string[];
}

// The concrete arg object the recommended tool takes (§3.4): {itemId} for a
// per-item tool, {} for an argless one.
export interface RecommendedTool {
  tool: string;
  args: { itemId?: string };
}

export interface LegalToolsResult {
  legal: Map<string, ArgsHint>;
  recommended: RecommendedTool | null;
  why: string;
}

// ---------------------------------------------------------------------------
// §2.3 terminality — inlined (plan lines 705-711). A run is terminal iff its
// state is one of these OR a stop is recorded; "EXECUTING with a stop" is
// terminal for every subsystem at once. Inlined rather than imported so core
// coupling stays on the single mandated sibling (schedule.ts).
// ---------------------------------------------------------------------------

const TERMINAL_RUN_STATES: readonly string[] = ["REPORTED", "TRIVIAL_DONE", "ANSWERED"];

function isTerminalRun(run: GateRun): boolean {
  return run.stop !== null || TERMINAL_RUN_STATES.includes(run.state);
}

// §3.3 item FSM: the ONE stage tool that advances an item from its current
// position. A behavioral PENDING owes a proven red first (submit_test); a
// non-behavioral PENDING has no test to submit and goes straight to green
// (mark_green). PUBLISHED is terminal — no stage tool. (§3.4 rows, one per edge.)
function nextStageTool(item: GateItem): string | null {
  switch (item.state) {
    case "PENDING":
      return item.behavioral ? SUBMIT_TEST : MARK_GREEN;
    case "RED":
      return VET_TEST;
    case "TEST_VETTED":
      return MARK_GREEN;
    case "GREEN":
      return VALIDATE;
    case "VALIDATED":
      return ITEM_REVIEW;
    case "REVIEWED":
      return PUBLISH;
    case "PUBLISHED":
      return null;
    default:
      return null;
  }
}

// An item contributes a stage tool iff it is neither blocked nor deferred (§3.3
// annotations veto every edge, orthogonal to the FSM table) and still has a next
// stage tool (i.e. is not PUBLISHED).
function isActionable(item: GateItem): boolean {
  return item.blocked === null && item.deferred === null && nextStageTool(item) !== null;
}

// §4.2 dependency readiness — the ONE rule nextWave already applies: an item is
// ready iff EVERY id in its dependsOn names an item this run has PUBLISHED (an
// unknown id is never published, so it is never ready). Nothing below PUBLISHED
// unlocks a dependent.
//
// The 9.4a/5.3 deferred binding (ENFORCE) lands here: an item whose dependency is
// not yet PUBLISHED contributes NO stage tool, so the legal set the injection and
// the continuation engine read can never offer a stage tool the Phase-9 handler
// would refuse — gate and handler cannot disagree, and there is no recovery
// bypass. Without it, `recommended` (which is computed from nextWave, and so was
// already deps-aware) and `legal` disagreed: the gate offered
// conductor_submit_test for an item the scheduler would never schedule.
function depsReady(item: GateItem, publishedIds: Set<string>): boolean {
  for (const dep of item.dependsOn) {
    if (!publishedIds.has(dep)) return false;
  }
  return true;
}

// §3.4 conductor_report precondition: every item is PUBLISHED, blocked, or
// deferred — the dispositions a report can close on.
function isSettled(item: GateItem): boolean {
  return item.state === "PUBLISHED" || item.blocked !== null || item.deferred !== null;
}

// The items that can NEVER reach PUBLISHED in this run. `isSettled` names three
// dispositions, but the depsReady binding above creates a fourth the original rule
// had no word for: an item whose dependency chain is permanently stuck contributes no
// stage tool AND is not settled, so a single deferred dependency would leave the run
// with no legal exit at all — no stage tool for the dependents, no report,
// `recommended` null, forever.
//
// PERMANENTLY stuck means DEFERRED (a judgment this run does not revisit) or a
// dependency id no item in this run carries. A BLOCKED dependency is deliberately NOT
// included: a question can be answered and the item resumes, so a run stalled behind
// one is waiting rather than finished, conductor_answer is the way out, and
// legalizing the report there would offer an exit over work that is still live.
//
// Computed as a FIXPOINT (seed, then propagate) rather than a recursive walk: a queue
// whose dependsOn edges form a cycle — which core validateQueue rejects, but which
// the gate must not assume — terminates here instead of recursing forever.
function cannotEverPublish(items: GateItem[]): Set<string> {
  const known = new Set(items.map((item) => item.id));
  const stuck = new Set<string>();
  for (const item of items) {
    if (item.state !== "PUBLISHED" && item.deferred !== null) stuck.add(item.id);
  }
  for (;;) {
    let added = false;
    for (const item of items) {
      if (item.state === "PUBLISHED" || stuck.has(item.id)) continue;
      if (item.dependsOn.some((dep) => !known.has(dep) || stuck.has(dep))) {
        stuck.add(item.id);
        added = true;
      }
    }
    if (!added) return stuck;
  }
}

// Record a per-item stage tool into the legal map, aggregating the item id into
// the (sorted, so reorder-invariant) list of ids that tool may target.
function addStageTool(legal: Map<string, ArgsHint>, tool: string, itemId: string): void {
  const existing = legal.get(tool);
  if (existing === undefined) {
    legal.set(tool, { itemIds: [itemId] });
    return;
  }
  const ids = existing.itemIds ?? [];
  if (!ids.includes(itemId)) ids.push(itemId);
  ids.sort();
  existing.itemIds = ids;
}

/**
 * Derive the tool-legality verdict for the run's current FSM position (§3.2,
 * §3.4). `legal` is a Map from tool name to its argsHint; `recommended` is the
 * single next tool (or null); `why` is a non-empty rationale.
 *
 * `recommended` is deterministic under item-array reordering: the EXECUTING
 * recommendation is the §4.2 wave-order-first item (DAG depth then id, computed
 * by nextWave — the scheduler's own ordering), so the same content yields the
 * same recommendation regardless of the items' arrangement.
 */
export function legalTools(
  run: GateRun,
  items: GateItem[],
  questions: GateQuestion[],
  repoConfigured: boolean,
): LegalToolsResult {
  const legal = new Map<string, ArgsHint>();

  // (0) Unconfigured repo (§3.2): the ONLY legal tools are conductor_setup and
  // conductor_status, and setup is the recommendation — nothing else runs, in
  // any state, until the repo is set up.
  if (!repoConfigured) {
    legal.set(SETUP, {});
    legal.set(STATUS, {});
    return {
      legal,
      recommended: { tool: SETUP, args: {} },
      why: "Repo not configured: only conductor_setup and conductor_status are legal; run conductor_setup first (§3.2).",
    };
  }

  const hasOpenQuestion = questions.some((q) => q.answeredIso === null);

  // (1) Terminal run (§2.3): conductor_status is legal in EVERY state, terminal
  // included; conductor_answer is the human's resume path while a question is
  // open. The non-terminal meta tools (decide/surface/defer) do NOT leak in, and
  // a terminal run recommends nothing.
  if (isTerminalRun(run)) {
    legal.set(STATUS, {});
    if (hasOpenQuestion) legal.set(ANSWER, {});
    return {
      legal,
      recommended: null,
      why: hasOpenQuestion
        ? "Terminal run: conductor_status (read-only) and conductor_answer (the open question's resume path) are legal; nothing is recommended (§2.3, §3.2)."
        : "Terminal run: only conductor_status (read-only) is legal; nothing is recommended (§2.3, §3.2).",
    };
  }

  // (2) Non-terminal run: the always-available meta tools (§3.2). status is
  // universal; decide/surface/defer are legal in every non-terminal state;
  // answer is legal exactly while a question is open.
  legal.set(STATUS, {});
  legal.set(DECIDE, {});
  legal.set(SURFACE, {});
  legal.set(DEFER, {});
  if (hasOpenQuestion) legal.set(ANSWER, {});

  // (3) The stage tool(s) for the run's FSM position, plus the recommendation.
  let recommended: RecommendedTool | null = null;
  let why: string;

  switch (run.state) {
    case "INTAKE": {
      if (run.classification === null) {
        // Unclassified: conductor_classify is the sole pipeline tool and the
        // recommendation. No later pipeline tool is legal until the run is
        // classified (§3.2).
        legal.set(CLASSIFY, {});
        recommended = { tool: CLASSIFY, args: {} };
        why = "INTAKE unclassified: conductor_classify is the only pipeline tool until the run is classified (§3.2).";
      } else if (run.classification.kind === "work") {
        // Classified work stays in INTAKE with conductor_decompose the
        // recommended and only pipeline-advancing tool; the already-performed
        // classify is not re-offered (§3.2, §3.4).
        legal.set(DECOMPOSE, {});
        recommended = { tool: DECOMPOSE, args: {} };
        why = "INTAKE classified work: conductor_decompose is the recommended and only pipeline-advancing tool (§3.2).";
      } else {
        // trivial/question classifications advance the run OUT of INTAKE inside
        // conductor_classify (§3.2), so an INTAKE holding one exposes no further
        // stage tool — only the meta tools remain.
        why = `INTAKE classified "${run.classification.kind}": conductor_classify already advanced the run; only the meta tools remain here (§3.2).`;
      }
      break;
    }
    case "DECOMPOSED": {
      legal.set(PLAN, {});
      recommended = { tool: PLAN, args: {} };
      why = "DECOMPOSED: conductor_plan writes the plan and advances to PLANNED (§3.2).";
      break;
    }
    case "PLANNED": {
      legal.set(PLAN_REVIEW, {});
      recommended = { tool: PLAN_REVIEW, args: {} };
      why = "PLANNED: conductor_plan_review fans out the review and advances to PLAN_REVIEWED (§3.2).";
      break;
    }
    case "PLAN_REVIEWED": {
      legal.set(DISPATCH_WAVE, {});
      recommended = { tool: DISPATCH_WAVE, args: {} };
      why = "PLAN_REVIEWED: conductor_dispatch_wave computes the wave and advances to EXECUTING on its first call (§3.2, §4.2).";
      break;
    }
    case "EXECUTING": {
      // Per-item stage tools: every actionable item contributes its next stage
      // tool, aggregated by tool. A blocked/deferred/PUBLISHED item contributes
      // none (§3.3, §3.4).
      const itemById = new Map<string, GateItem>();
      const publishedIds = new Set<string>();
      for (const it of items) {
        itemById.set(it.id, it);
        if (it.state === "PUBLISHED") publishedIds.add(it.id);
      }
      for (const it of items) {
        if (!isActionable(it)) continue;
        // §4.2 (a), the 9.4a/5.3 binding: a dependency-unready item is not
        // offered its stage tool at all — the same predicate nextWave applies.
        if (!depsReady(it, publishedIds)) continue;
        const tool = nextStageTool(it);
        if (tool !== null) addStageTool(legal, tool, it.id);
      }

      // conductor_report is legalized ONLY when EVERY item is settled (PUBLISHED,
      // blocked, or deferred) — the §3.2 report precondition (line 1142), which
      // holds for trivial AND work runs alike. A trivial run closes report-lite
      // (EXECUTING->TRIVIAL_DONE), but only once the work is done: report is NOT
      // legal over an unsettled item merely because the run is trivial (C-018 —
      // the safe reading of the plan's 2256-vs-1142 contradiction).
      const trivial = run.classification !== null && run.classification.kind === "trivial";
      const stuck = cannotEverPublish(items);
      const allSettled = items.length > 0 && items.every((it) => isSettled(it) || stuck.has(it.id));
      const reportLegal = allSettled;
      if (reportLegal) legal.set(REPORT, {});

      // recommended: the §4.2 wave-order-first item's next stage tool. nextWave
      // orders candidates by DAG depth then id (invariant under item-array
      // reordering) and excludes blocked/deferred/unready/published items, so
      // parallel[0] is the single deterministic first actionable item. With no
      // schedulable item, close via conductor_report when it is legal.
      const wave = nextWave(
        { items },
        items,
        {
          parallel: { maxImplementers: items.length, maxReaders: items.length },
          workflow: { planReviewers: 1, itemReviewers: 1, vetCritics: 1, skepticsPerFinding: 1 },
        },
      );
      const firstId = wave.parallel[0];
      const firstItem = firstId === undefined ? undefined : itemById.get(firstId);
      const firstTool = firstItem === undefined ? null : nextStageTool(firstItem);
      if (firstId !== undefined && firstTool !== null) {
        recommended = { tool: firstTool, args: { itemId: firstId } };
        why = `EXECUTING: the §4.2 wave-order-first item ${firstId} (DAG depth then id) advances via ${firstTool}.`;
      } else if (reportLegal) {
        recommended = { tool: REPORT, args: {} };
        why = trivial
          ? "EXECUTING (trivial): no item is schedulable; conductor_report closes the run report-lite (§3.2)."
          : "EXECUTING: every item is settled; conductor_report closes the run (§3.4).";
      } else {
        why = "EXECUTING: no item is schedulable this wave and no report is due; the meta tools remain (§3.2, §4.2).";
      }
      break;
    }
    default: {
      why = `Run state "${run.state}" is non-terminal with no pipeline stage tool; the meta tools remain legal (§3.2).`;
      break;
    }
  }

  return { legal, recommended, why };
}
