// conductor/tools/observation.ts — the run-state snapshot, the strain signals and
// the breakdown thresholds an observer reads a live or finished run through.
//
// WHY THIS EXISTS. The campaign's purpose is that a stronger model watches this
// harness work at increasing scope and says where it breaks. Most of the data
// already exists: the orchestrator's stream is captured per cell, every
// sub-session is journaled with its own id, and the gate, FSM and evidence layers
// are journaled in full. What was missing is assembly — and, before Task 21.1,
// the sub-sessions where most of the work happens were invisible in the session
// an observer was watching.
//
// READ-ONLY BY CONSTRUCTION. The observer must not be able to perturb the run it
// is watching, and the strongest form of that is structural rather than
// disciplinary. Everything here is a PURE function of records that already exist,
// driven from a separate process that only reads the run directory. There is no
// conductor code path an observer can enter, so there is nothing to be careful
// about — which is the property a rule about being careful cannot deliver.
//
// It lives under tools/ rather than core/ for the same reason conductor/tools/atlas.ts
// does: nothing in the running harness consumes it. It is pure and imports nothing, but
// a pure module in core/ with no core caller is the dead-export shape the reachability
// audit exists to refuse, and an observation derivation is an observation tool.

// ---------------------------------------------------------------------------
// Inputs — the shapes a reader parses out of a run directory.
// ---------------------------------------------------------------------------

export interface ObservedItem {
  id: string;
  state: string;
  blocked: unknown;
  deferred: unknown;
  taint: readonly unknown[];
  attempts: { overridesUsed: number };
}

export interface ObservedQuestion {
  id: string;
  question: string;
  answerPath: string;
}

// One journal line, parsed. Deliberately loose: a reader must survive a torn
// tail line and a record written by a newer conductor than it knows about.
export interface ObservedRecord {
  level?: unknown;
  component?: unknown;
  event?: unknown;
  data?: Record<string, unknown>;
  runId?: unknown;
  itemId?: unknown;
  sessionID?: unknown;
  tsMs?: unknown;
}

export interface ObservationInput {
  runId: string;
  run: {
    state: string;
    classification: { kind: string } | null;
    stop: unknown;
    counters: { overridesUsed: number; waves?: number };
  };
  items: readonly ObservedItem[];
  openQuestions: readonly ObservedQuestion[];
  // The trees a live verify has frozen. A held write-capable job is otherwise
  // indistinguishable from a hung one.
  liveVerifyTrees: readonly string[];
  journal: readonly ObservedRecord[];
  // config.workflow.reviewMaxRounds — the cap the fix loop is measured against.
  reviewMaxRounds: number;
  // scripts/conductor_wiring.py PER_SLOT_CONTEXT_TOKENS. The EFFECTIVE per-slot
  // window is this, not the context the model preset declares: `parallel_server_args`
  // emits --ctx-size per_slot * count when slots > 1, so the declared 65,536 is
  // shared out.
  perSlotContextTokens: number;
  // How many trailing journal events the snapshot carries.
  tailEvents?: number;
}

// ---------------------------------------------------------------------------
// 22B.1 — the snapshot: where is this run, and why is it there.
// ---------------------------------------------------------------------------

export interface InFlightSession {
  sessionID: string;
  role: string;
  itemId: string;
}

export interface RunSnapshot {
  runId: string;
  runState: string;
  classification: string | null;
  stopped: boolean;
  items: readonly {
    id: string;
    state: string;
    blocked: unknown;
    deferred: unknown;
    tainted: boolean;
    overridesUsed: number;
  }[];
  openQuestions: readonly ObservedQuestion[];
  liveVerifyTrees: readonly string[];
  inFlight: readonly InFlightSession[];
  overridesUsed: number;
  recentEvents: readonly ObservedRecord[];
}

const DEFAULT_TAIL = 20;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isEvent(record: ObservedRecord, component: string, event: string): boolean {
  return record.component === component && record.event === event;
}

/**
 * The run as it stands, from records alone.
 *
 * `inFlight` is dispatched-minus-settled rather than a count: an observer
 * watching a wave needs to know WHICH sub-sessions are still out, because that is
 * the difference between a wave that is working and one that is stuck on one job.
 */
export function deriveSnapshot(input: ObservationInput): RunSnapshot {
  const live = new Map<string, InFlightSession>();
  for (const record of input.journal) {
    const sessionID = str(record.sessionID);
    if (sessionID.length === 0) continue;
    const data = record.data ?? {};
    if (isEvent(record, "fanout", "subsession.dispatched")) {
      // A dispatch record carrying no role is the clamp WARNING, not a dispatch
      // (adapter/tools.ts emits both under this name), so it starts no session.
      const role = str(data["role"]);
      if (role.length === 0) continue;
      live.set(sessionID, { sessionID, role, itemId: str(data["itemId"]) });
      continue;
    }
    if (
      isEvent(record, "fanout", "subsession.complete") ||
      isEvent(record, "fanout", "subsession.abort")
    ) {
      live.delete(sessionID);
    }
  }

  const tail = input.tailEvents ?? DEFAULT_TAIL;

  return {
    runId: input.runId,
    runState: input.run.state,
    classification: input.run.classification?.kind ?? null,
    stopped: input.run.stop !== null && input.run.stop !== undefined,
    items: input.items.map((item) => ({
      id: item.id,
      state: item.state,
      blocked: item.blocked,
      deferred: item.deferred,
      tainted: item.taint.length > 0,
      overridesUsed: item.attempts.overridesUsed,
    })),
    openQuestions: [...input.openQuestions],
    liveVerifyTrees: [...input.liveVerifyTrees],
    inFlight: [...live.values()],
    overridesUsed: input.run.counters.overridesUsed,
    recentEvents: input.journal.slice(Math.max(0, input.journal.length - tail)),
  };
}

// ---------------------------------------------------------------------------
// 22B.2 — strain signals: the measurements that say the PROCESS is failing
// rather than the task being hard.
// ---------------------------------------------------------------------------

export interface StrainSignals {
  // Gate pressure. Which gate is refusing is the finding, so the breakdown is by
  // gate and not merely a total.
  deniesByGate: Record<string, number>;
  denies: number;
  allowedCalls: number;
  denyRate: number;
  // The hatch. Minted and spent are separate numbers because a grant minted and
  // never spent is a different story from one converted into a write.
  overridesMinted: number;
  overridesSpent: number;
  // The fix loop, per item, against the configured cap. A ROUND is one review
  // wave, however many reviewers `workflow.itemReviewers` sends into it: counting
  // the reviewers would measure a config value, and any campaign whose config
  // exceeds the threshold would cross it in every cell before any item had been
  // sent back even once.
  reviewRoundsByItem: Record<string, number>;
  reviewMaxRounds: number;
  // Items that stopped moving, named rather than counted.
  blockedItems: readonly string[];
  taintedItems: readonly string[];
  // Sub-session health.
  receiptRetries: number;
  subsessionAborts: number;
  subsessionHolds: number;
  // The §3.7 continuation engine, which exists because a local model stopping
  // mid-run is the normal case. How often it has to act is a strain measure.
  idleContinuations: number;
  disengages: number;
  reprompts: number;
  // Wave composition. `waves` is how many the scheduler dispatched and
  // `serializedWaves` how many of those carried a single job — a wave of one is
  // the scheduler finding nothing it could run alongside, which against a task
  // with disjoint scopes is the conservative scopesIntersect over-approximating.
  waves: number;
  serializedWaves: number;
  // Verification pressure.
  verifyRuns: number;
  redEvents: number;
  greenEvents: number;
  // Gate crashes: a fail-closed decision nobody chose.
  gateCrashes: number;
  // Brief size against the effective window. Retrieval or a long brief that
  // displaces source degrades quality while looking like added capability, and
  // nothing else in the system would notice.
  largestBriefChars: number;
  largestBriefWindowFraction: number;
}

// Four characters per token is the conventional rough English ratio. It is used
// here only to turn a character count into a window FRACTION for a threshold —
// an exact tokenizer would give a false precision this signal does not have.
const CHARS_PER_TOKEN = 4;

/** Every strain signal, derived from records alone. */
export function deriveStrainSignals(input: ObservationInput): StrainSignals {
  const deniesByGate: Record<string, number> = {};
  const reviewRoundsByItem: Record<string, number> = {};
  let denies = 0;
  let allowedCalls = 0;
  let overridesMinted = 0;
  let overridesSpent = 0;
  let receiptRetries = 0;
  let subsessionAborts = 0;
  let subsessionHolds = 0;
  let idleContinuations = 0;
  let disengages = 0;
  let reprompts = 0;
  let verifyRuns = 0;
  let redEvents = 0;
  let greenEvents = 0;
  let gateCrashes = 0;
  let largestBriefChars = 0;
  let waves = 0;
  let serializedWaves = 0;

  for (const record of input.journal) {
    const data = record.data ?? {};

    if (isEvent(record, "gates", "deny")) {
      denies += 1;
      const gate = str(data["gate"]);
      const key = gate.length > 0 ? gate : "unnamed";
      deniesByGate[key] = (deniesByGate[key] ?? 0) + 1;
      continue;
    }
    if (isEvent(record, "gates", "allow")) {
      // `gates: allow` fires in two circumstances and only one is an ordinary
      // permitted call. A grant spend carries `via` and is counted as a SPEND, or
      // a bypassed deny would inflate the allow rate and hide itself.
      if (str(data["via"]) === "override-grant") overridesSpent += 1;
      else allowedCalls += 1;
      continue;
    }
    if (isEvent(record, "gates", "override-granted")) {
      overridesMinted += 1;
      continue;
    }
    if (isEvent(record, "gates", "gate-crash")) {
      gateCrashes += 1;
      continue;
    }
    if (isEvent(record, "fanout", "subsession.dispatched")) {
      const role = str(data["role"]);
      if (role.length === 0) continue; // the clamp warning, not a dispatch
      const promptChars = num(data["promptChars"]);
      if (promptChars > largestBriefChars) largestBriefChars = promptChars;
      continue;
    }
    if (isEvent(record, "fanout", "wave")) {
      waves += 1;
      if (num(data["jobs"]) === 1) serializedWaves += 1;
      // The wave names the items it sent to review, which is what makes a round a
      // round: a run-level plan review names none, and its four reviewers are not
      // any item's second look.
      const reviewItems = data["reviewItems"];
      if (Array.isArray(reviewItems)) {
        for (const entry of reviewItems) {
          const itemId = typeof entry === "string" ? entry : "";
          if (itemId.length === 0) continue;
          reviewRoundsByItem[itemId] = (reviewRoundsByItem[itemId] ?? 0) + 1;
        }
      }
      continue;
    }
    if (isEvent(record, "fanout", "subsession.retry")) receiptRetries += 1;
    else if (isEvent(record, "fanout", "subsession.abort")) subsessionAborts += 1;
    else if (isEvent(record, "fanout", "subsession.hold")) subsessionHolds += 1;
    else if (isEvent(record, "continuation", "idle")) idleContinuations += 1;
    else if (isEvent(record, "continuation", "disengage")) disengages += 1;
    else if (isEvent(record, "continuation", "reprompt")) reprompts += 1;
    else if (isEvent(record, "evidence", "verify")) verifyRuns += 1;
    else if (isEvent(record, "evidence", "red")) redEvents += 1;
    else if (isEvent(record, "evidence", "green")) greenEvents += 1;
  }

  const adjudicated = denies + allowedCalls;
  const windowChars = input.perSlotContextTokens * CHARS_PER_TOKEN;

  return {
    deniesByGate,
    denies,
    allowedCalls,
    // 0/0 is 0: an observer must be handed a number, not NaN.
    denyRate: adjudicated === 0 ? 0 : denies / adjudicated,
    overridesMinted,
    overridesSpent,
    reviewRoundsByItem,
    reviewMaxRounds: input.reviewMaxRounds,
    blockedItems: input.items
      .filter((item) => item.blocked !== null && item.blocked !== undefined)
      .map((item) => item.id),
    taintedItems: input.items.filter((item) => item.taint.length > 0).map((item) => item.id),
    receiptRetries,
    subsessionAborts,
    subsessionHolds,
    idleContinuations,
    disengages,
    reprompts,
    verifyRuns,
    redEvents,
    greenEvents,
    gateCrashes,
    waves,
    serializedWaves,
    largestBriefChars,
    largestBriefWindowFraction: windowChars === 0 ? 0 : largestBriefChars / windowChars,
  };
}

// ---------------------------------------------------------------------------
// 22B.3 — the thresholds, declared BEFORE the campaign.
//
// These are hypotheses about where the harness stops working, written down ahead
// of the data so the analysis cannot be fitted to it afterwards. A threshold
// chosen after seeing results is a description of those results, not a claim
// about the system.
//
// A crossed threshold is a FINDING TO INVESTIGATE, never a stop. Nothing here
// halts a run, and `crossedThresholds` returns names — there is no shape a caller
// could use to make it do more.
// ---------------------------------------------------------------------------

// scripts/conductor_wiring.py PER_SLOT_CONTEXT_TOKENS, the window each slot is
// served by default. Two copies of one number in two languages; the parity test
// in tests/observation.test.ts is what keeps them equal.
export const DEFAULT_PER_SLOT_CONTEXT_TOKENS = 32768;

export const BREAKDOWN_THRESHOLDS = {
  // Above this share of adjudicated calls refused, the session is spending its
  // turns arguing with the gates rather than working. Chosen at a third because
  // a healthy run's denies are occasional corrections, not the median outcome.
  denyRate: 0.33,
  // A grant minted per item is the configured budget; more than two across a run
  // means the scopes the planner wrote do not match the work.
  overridesMinted: 2,
  // Any spend is worth an investigation: it is a deny that was bypassed, and the
  // item carries permanent taint for it.
  overridesSpent: 1,
  // ONE item sent back through review this many times means the fix loop is not
  // converging, which is the failure the cap exists to bound. Rounds, never
  // reviewers: the reviewer count per round is a config value.
  reviewRoundsPerItem: 3,
  // A single blocked item is a legitimate surfaced question. Two is a pattern.
  blockedItems: 2,
  // Receipts that fail schema validation and retry: the sub-session is not
  // producing the shape the protocol asked for, which is a briefing failure.
  receiptRetries: 3,
  // The watchdog killing a sub-session is never routine.
  subsessionAborts: 1,
  // The continuation engine acting repeatedly means the model is disengaging
  // rather than finishing.
  disengages: 2,
  idleContinuations: 5,
  // A gate crashing is a defect in conductor, not in the work.
  gateCrashes: 1,
  // A brief filling more than half the effective per-slot window leaves the
  // sub-session too little room for the source it is supposed to read.
  largestBriefWindowFraction: 0.5,
} as const;

/**
 * The thresholds this run crossed, by name.
 *
 * Returns names rather than a verdict, and always in the same order, so two runs
 * are comparable and a report can be diffed.
 */
export function crossedThresholds(signals: StrainSignals): string[] {
  const crossed: string[] = [];
  if (signals.denyRate > BREAKDOWN_THRESHOLDS.denyRate) crossed.push("denyRate");
  if (signals.overridesMinted > BREAKDOWN_THRESHOLDS.overridesMinted) crossed.push("overridesMinted");
  if (signals.overridesSpent >= BREAKDOWN_THRESHOLDS.overridesSpent) crossed.push("overridesSpent");
  const worstReview = Math.max(0, ...Object.values(signals.reviewRoundsByItem));
  if (worstReview >= BREAKDOWN_THRESHOLDS.reviewRoundsPerItem) {
    crossed.push("reviewRoundsPerItem");
  }
  if (signals.blockedItems.length >= BREAKDOWN_THRESHOLDS.blockedItems) crossed.push("blockedItems");
  if (signals.receiptRetries >= BREAKDOWN_THRESHOLDS.receiptRetries) crossed.push("receiptRetries");
  if (signals.subsessionAborts >= BREAKDOWN_THRESHOLDS.subsessionAborts) crossed.push("subsessionAborts");
  if (signals.disengages >= BREAKDOWN_THRESHOLDS.disengages) crossed.push("disengages");
  if (signals.idleContinuations >= BREAKDOWN_THRESHOLDS.idleContinuations) {
    crossed.push("idleContinuations");
  }
  if (signals.gateCrashes >= BREAKDOWN_THRESHOLDS.gateCrashes) crossed.push("gateCrashes");
  if (signals.largestBriefWindowFraction > BREAKDOWN_THRESHOLDS.largestBriefWindowFraction) {
    crossed.push("largestBriefWindowFraction");
  }
  return crossed;
}
