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
  // The writer's own stamp and counter (adapter/journal.ts). `tsMs` above is the
  // shape an older reader coerced records into, and both spellings are read.
  ts?: unknown;
  seq?: unknown;
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

// ---------------------------------------------------------------------------
// The live console — what a human watches while the run is still moving.
//
// WHY A SECOND VIEW. The snapshot above answers "where is this run"; the strain
// signals answer "is the process failing". Neither answers the question a person
// sitting in front of a 45-minute run actually asks, which is "is it still
// getting anywhere, and if not, what is it doing instead". One preserved run
// makes the gap concrete: its FSM transitioned once, 465 seconds in, and then
// held the same position for 36 minutes while the model generated continuously.
// Every counter above stayed healthy throughout. The four derivations below are
// the ones that name that failure while it is happening:
//
//   the STALL CLOCK    — seconds since anything actually advanced, which is a
//                        different quantity from seconds since the last record.
//   RECOMMENDED vs ACTUAL — the state block names one next tool per request; the
//                        model called something else sixteen times running.
//   REFUSALS           — a handler-level refusal and a gate deny are the two
//                        ways a call fails, and both must be unmissable.
//   the COMPACTION shape — an inject with no tool call before the next inject.
//                        Two of those cost that run 472.9 seconds invisibly.
//
// Everything here is a pure function of records. The wall clock is a PARAMETER
// (`nowMs`), never a read: a watcher's terminal must keep counting while the
// journal is silent, and two watchers handed the same records and the same
// instant must agree exactly.
// ---------------------------------------------------------------------------

// One record of the router's per-request ledger, coerced. The C++ router writes
// far more per request; these are the fields a per-turn cost column needs.
export interface LedgerEntry {
  group: string | null;
  role: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  upstreamMs: number | null;
  status: number | null;
}

// What a gate record says happened to the call. "none" is a turn whose session
// has not called anything since its request was built — which, while a run is
// live, is the ordinary state of the turn in flight.
export const TURN_DECISIONS = ["allow", "deny", "refused", "gate-crash", "none"] as const;
export type TurnDecision = (typeof TURN_DECISIONS)[number];

// One model turn: the request that was built for a session, and what that
// session did with it.
export interface TurnRow {
  turn: number;
  seq: number | null;
  tsMs: number | null;
  offsetMs: number | null;
  sessionID: string | null;
  role: string;
  // The single next tool the injected state block named, when the record carries
  // it. Null is "not recorded", never "none recommended".
  recommended: string | null;
  recommendedItem: string | null;
  actual: string | null;
  alsoCalled: string[];
  decision: TurnDecision;
  // A turn is settled once what it did is known: it called something, or the
  // next request for its session proved it called nothing. The newest turn of a
  // live session is unsettled, and a row printed for it would be a claim about a
  // model that is still generating.
  settled: boolean;
  refused: boolean;
  mismatch: boolean;
  noToolCall: boolean;
  compactionSuspected: boolean;
  // Request built -> first tool call, or -> the next request when no tool was
  // called. The time the model spent generating.
  generationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  upstreamMs: number | null;
}

export const REFUSAL_KINDS = ["deny", "refused", "gate-crash"] as const;
export type RefusalKind = (typeof REFUSAL_KINDS)[number];

export interface RefusalRow {
  seq: number | null;
  tsMs: number | null;
  offsetMs: number | null;
  kind: RefusalKind;
  gate: string | null;
  toolName: string | null;
  itemId: string | null;
  sessionID: string | null;
  reason: string | null;
  detail: string | null;
}

// What a sub-session row IS. A dispatch went out; a hold never became a session
// at all; an unpaired end is a terminal record no dispatch claimed. All three
// belong in the list, and rendering the last two as dispatches would report a
// frozen wave and a failed session-create as jobs in flight.
export const EXCHANGE_KINDS = ["dispatch", "hold", "unpaired-end"] as const;
export type ExchangeKind = (typeof EXCHANGE_KINDS)[number];

// One sub-session, from the brief it was handed to the answer it gave back.
export interface ExchangeRow {
  kind: ExchangeKind;
  sessionID: string | null;
  role: string;
  itemId: string | null;
  tree: string | null;
  model: string | null;
  promptChars: number | null;
  prompt: string | null;
  promptTruncated: boolean;
  response: string | null;
  responseTruncated: boolean;
  dispatchedTsMs: number | null;
  dispatchedOffsetMs: number | null;
  durationMs: number | null;
  attempts: number;
  outcome: string;
}

export const STALL_LEVELS = ["ok", "notice", "warn", "alarm"] as const;
export type StallLevel = (typeof STALL_LEVELS)[number];

// How long "nothing has advanced" has to run before a watcher should look. Two
// minutes is a long generation; five is a long one that has gone wrong; a
// quarter of an hour without the run moving is the shape of the deadlock in the
// preserved evidence, which held one position for thirty-six.
export const STALL_THRESHOLDS_MS = {
  notice: 120_000,
  warn: 300_000,
  alarm: 900_000,
} as const;

// A silent turn shorter than this is the pair of injects a session create emits
// back to back, not an auto-compaction. A real compaction costs minutes.
export const COMPACTION_MIN_GAP_MS = 30_000;

// The records that CAN mean the run moved. Everything else — a request built, a
// file read, a token generated — is activity, and activity is what a stalled run
// has no shortage of.
//
// state/decision.recorded is deliberately absent, and state/item.updated is a
// candidate rather than a verdict (see advanceStateOf). Recording a decision is a
// note; so is annotating an item with an inline claim. The preserved run wrote
// both, one second apart, over an item that stayed at PENDING for its whole life,
// and a clock that took them for movement read 28 minutes on a 36-minute stall
// and crossed into ALARM ten minutes late.
export const STATE_ADVANCE_EVENTS: readonly { component: string; event: string }[] = [
  { component: "fsm", event: "transition" },
  { component: "state", event: "item.updated" },
];

export interface StallClock {
  stallMs: number;
  level: StallLevel;
  lastAdvanceEvent: string | null;
  lastAdvanceDetail: string | null;
  lastAdvanceTsMs: number | null;
  lastAdvanceOffsetMs: number | null;
  latestRecordTsMs: number | null;
  // Wall-clock silence, available only when the caller supplies the instant.
  sinceLastRecordMs: number | null;
}

// The turn whose response has not arrived: who the run is waiting on, and for
// how long. A stall clock says nothing has advanced; this says who is silent.
export interface WaitingOn {
  turn: number;
  role: string;
  sessionID: string | null;
  waitingMs: number | null;
}

export interface LiveConsole {
  runRoot: string | null;
  firstTsMs: number | null;
  latestTsMs: number | null;
  turns: TurnRow[];
  refusals: RefusalRow[];
  exchanges: ExchangeRow[];
  stall: StallClock;
  waitingOn: WaitingOn | null;
  mismatchCount: number;
  recommendationsRecorded: number;
  refusalCount: number;
  compactionCount: number;
  compactionMs: number;
  promptTokensTotal: number;
  completionTokensTotal: number;
  ledgerJoined: boolean;
  // The roles whose cost the ledger could not account for, so the totals above
  // are a floor rather than a figure. Empty when every role's traffic was
  // attributable.
  ledgerPartialRoles: string[];
  malformedRecords: number;
  malformedBytes: number;
}

export interface LiveConsoleInput {
  records: readonly ObservedRecord[];
  ledger?: readonly LedgerEntry[];
  // The instant the caller considers "now". Absent means the newest record is as
  // recent as the world gets, which is what a post-hoc render wants.
  nowMs?: number;
  malformedRecords?: number;
  malformedBytes?: number;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tsOf(record: ObservedRecord): number | null {
  return numOrNull(record.ts) ?? numOrNull(record.tsMs);
}

function dataOf(record: ObservedRecord): Record<string, unknown> {
  return record.data ?? {};
}

/**
 * Every complete JSON object in a text, whatever the separator.
 *
 * The journal is one compact object per line; the router's ledger and the
 * preserved evidence journal are pretty-printed objects concatenated with no
 * separator at all. A line reader sees the second shape as a file of garbage, so
 * this scans brace depth (respecting strings and escapes) instead of lines. A
 * torn trailing object — the normal state of a file being appended to — costs
 * the tail alone and is COUNTED, never silently dropped. Damage is reported as
 * both a region count and a BYTE span: a scan that resyncs on the next line
 * beginning with `{`, and gives up when there is none, can swallow the whole
 * remainder of a file under a count of one.
 */
export function parseConcatenatedJson(text: string): {
  values: Record<string, unknown>[];
  malformed: number;
  malformedBytes: number;
} {
  const values: Record<string, unknown>[] = [];
  let malformed = 0;
  let malformedBytes = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch !== "{") {
      malformed += 1;
      const next = text.indexOf("\n{", i);
      // The damage runs to the next line that starts an object, or to the end of
      // the file when there is none. Its SIZE is the honest report: one resync
      // event can stand for one stray byte or for every byte that follows it.
      malformedBytes += (next === -1 ? text.length : next + 1) - i;
      if (next === -1) break;
      i = next + 1;
      continue;
    }
    const end = objectEndAt(text, i);
    if (end === -1) {
      malformed += 1;
      malformedBytes += text.length - i;
      break;
    }
    try {
      const parsed: unknown = JSON.parse(text.slice(i, end));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        values.push(parsed as Record<string, unknown>);
      } else {
        malformed += 1;
        malformedBytes += end - i;
      }
    } catch {
      malformed += 1;
      malformedBytes += end - i;
    }
    i = end;
  }
  return { values, malformed, malformedBytes };
}

// The index one past the object that starts at `start`, or -1 when the text ends
// inside it. String contents are skipped whole, so a brace inside a shell command
// or an embedded JSON blob cannot close the record early.
function objectEndAt(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** The router ledger's own record shape, coerced to the fields a cost column needs. */
export function ledgerEntriesOf(values: readonly Record<string, unknown>[]): LedgerEntry[] {
  return values.map((value) => ({
    group: strOrNull(value["group"]),
    role: strOrNull(value["role"]),
    promptTokens: numOrNull(value["promptTokens"]),
    completionTokens: numOrNull(value["completionTokens"]),
    upstreamMs: numOrNull(value["upstreamMs"]),
    status: numOrNull(value["status"]),
  }));
}

/** Which band a stall has escalated into. */
export function stallLevelOf(stallMs: number): StallLevel {
  if (stallMs >= STALL_THRESHOLDS_MS.alarm) return "alarm";
  if (stallMs >= STALL_THRESHOLDS_MS.warn) return "warn";
  if (stallMs >= STALL_THRESHOLDS_MS.notice) return "notice";
  return "ok";
}

function isAdvanceCandidate(record: ObservedRecord): boolean {
  return STATE_ADVANCE_EVENTS.some(
    (entry) => record.component === entry.component && record.event === entry.event,
  );
}

/**
 * Whether this record MOVED the run, given the item states seen so far.
 *
 * An fsm/transition always moves. A state/item.updated moves only when it carries
 * an FSM state the item was not already in: the same record name also carries the
 * §2.5 annotations (an inline claim, a taint entry, an assignee), and an item that
 * gained an annotation is an item that is exactly where it was. `seen` is read AND
 * written here, so the caller's only job is to walk the records in order.
 */
function advancesRun(record: ObservedRecord, seen: Map<string, string>): boolean {
  if (!isAdvanceCandidate(record)) return false;
  if (record.component === "fsm") return true;
  const data = dataOf(record);
  const itemId = strOrNull(data["itemId"]) ?? strOrNull(record.itemId);
  const state = strOrNull(data["state"]);
  if (itemId === null || state === null) return false;
  const previous = seen.get(itemId);
  seen.set(itemId, state);
  return previous !== state;
}

// What the advance was, LABELLED by kind: an FSM state and an item id are
// different facts, and one unlabelled arrow makes "-> I1" read as a state the run
// reached.
function advanceDetailOf(record: ObservedRecord): string | null {
  const data = dataOf(record);
  const to = strOrNull(data["to"]);
  if (to !== null) return "state " + to;
  const itemId = strOrNull(data["itemId"]) ?? strOrNull(record.itemId);
  return itemId === null ? null : "item " + itemId;
}

function refusalKindOf(record: ObservedRecord): RefusalKind | null {
  if (record.component !== "gates") return null;
  for (const kind of REFUSAL_KINDS) {
    if (record.event === kind) return kind;
  }
  return null;
}

// A gate record is a call's OUTCOME, whichever way it went.
function decisionOf(record: ObservedRecord): TurnDecision | null {
  if (record.component !== "gates") return null;
  if (record.event === "allow") return "allow";
  return refusalKindOf(record);
}

// A turn under construction, plus the bookkeeping the derivation needs and the
// row does not carry.
interface TurnBuild {
  row: TurnRow;
  gateCount: number;
}

/**
 * The whole live view, derived from records alone.
 *
 * Turns are threaded PER SESSION rather than by arrival order: a sub-session's
 * requests and tool calls interleave with the orchestrator's in one journal, and
 * threading by arrival would hand the orchestrator's turn a reviewer's bash call
 * and call it a mismatch.
 */
export function deriveLiveConsole(input: LiveConsoleInput): LiveConsole {
  const records = input.records;

  let firstTsMs: number | null = null;
  let latestTsMs: number | null = null;
  for (const record of records) {
    const ts = tsOf(record);
    if (ts === null) continue;
    if (firstTsMs === null) firstTsMs = ts;
    if (latestTsMs === null || ts > latestTsMs) latestTsMs = ts;
  }
  const offsetOf = (ts: number | null): number | null =>
    ts === null || firstTsMs === null ? null : ts - firstTsMs;

  let runRoot: string | null = null;
  const builds: TurnBuild[] = [];
  const openBySession = new Map<string, TurnBuild>();
  const refusals: RefusalRow[] = [];
  let lastAdvance: ObservedRecord | null = null;
  // The FSM state each item was last SEEN in, so an item.updated that re-states a
  // position is not mistaken for reaching one.
  const seenItemStates = new Map<string, string>();

  for (const record of records) {
    const data = dataOf(record);
    const ts = tsOf(record);
    const sessionID = strOrNull(record.sessionID);

    if (record.component === "state" && record.event === "run.created" && runRoot === null) {
      runRoot = strOrNull(data["root"]);
    }
    if (advancesRun(record, seenItemStates)) lastAdvance = record;

    if (record.component === "inject" && record.event === "system-append") {
      const build: TurnBuild = {
        gateCount: 0,
        row: {
          turn: builds.length + 1,
          seq: numOrNull(record.seq),
          tsMs: ts,
          offsetMs: offsetOf(ts),
          sessionID,
          role: str(data["role"]),
          recommended: strOrNull(data["recommended"]) ?? strOrNull(data["recommendedTool"]),
          recommendedItem: strOrNull(data["recommendedItem"]) ?? strOrNull(data["recommendedItemId"]),
          actual: null,
          alsoCalled: [],
          decision: "none",
          settled: false,
          refused: false,
          mismatch: false,
          noToolCall: true,
          compactionSuspected: false,
          generationMs: null,
          promptTokens: null,
          completionTokens: null,
          upstreamMs: null,
        },
      };
      // A turn belongs to a session, so the previous turn of THAT session closes
      // here — and its silent gap is measured against this request.
      if (sessionID !== null) {
        const previous = openBySession.get(sessionID);
        if (previous !== undefined && previous.gateCount === 0) {
          previous.row.settled = true;
          if (previous.row.tsMs !== null && ts !== null) {
            previous.row.generationMs = ts - previous.row.tsMs;
            previous.row.compactionSuspected = previous.row.generationMs >= COMPACTION_MIN_GAP_MS;
          }
        }
        openBySession.set(sessionID, build);
      }
      builds.push(build);
      continue;
    }

    // A sub-session ending settles its open turn: that request produced no
    // further tool call and never will, and its generation is measured to the
    // moment the session returned. Without this a session that finishes after one
    // request stays unsettled forever and holds every later row behind it.
    const sessionEnded =
      isEvent(record, "fanout", "subsession.complete") ||
      isEvent(record, "fanout", "subsession.abort");
    if (sessionEnded && sessionID !== null) {
      const ending = openBySession.get(sessionID);
      if (ending !== undefined && !ending.row.settled) {
        ending.row.settled = true;
        if (ending.row.tsMs !== null && ts !== null) ending.row.generationMs = ts - ending.row.tsMs;
      }
      openBySession.delete(sessionID);
    }

    const kind = refusalKindOf(record);
    if (kind !== null) {
      refusals.push({
        seq: numOrNull(record.seq),
        tsMs: ts,
        offsetMs: offsetOf(ts),
        kind,
        gate: strOrNull(data["gate"]),
        toolName: strOrNull(data["toolName"]),
        itemId: strOrNull(data["itemId"]) ?? strOrNull(record.itemId),
        sessionID,
        reason: strOrNull(data["reason"]) ?? strOrNull(data["error"]),
        detail: strOrNull(data["editPath"]) ?? strOrNull(data["command"]),
      });
    }

    const decision = decisionOf(record);
    if (decision === null || sessionID === null) continue;
    const open = openBySession.get(sessionID);
    if (open === undefined) continue;
    const toolName = strOrNull(data["toolName"]);
    if (open.gateCount === 0) {
      open.row.decision = decision;
      open.row.actual = toolName;
      open.row.noToolCall = false;
      open.row.settled = true;
      if (open.row.tsMs !== null && ts !== null) open.row.generationMs = ts - open.row.tsMs;
    } else if (decision === "allow") {
      if (toolName !== null) open.row.alsoCalled.push(toolName);
    } else {
      // A handler-level refusal arrives AFTER the gates/allow for the same call —
      // the gate stack did allow it, and something past the gates refused it. The
      // refusal is what happened to the turn; the allow it followed is not a
      // second tool call and must not be counted as one.
      open.row.decision = decision;
      if (open.row.actual === null) open.row.actual = toolName;
    }
    if (decision !== "allow") open.row.refused = true;
    open.gateCount += 1;
  }

  let mismatchCount = 0;
  let recommendationsRecorded = 0;
  let compactionCount = 0;
  let compactionMs = 0;
  for (const build of builds) {
    const row = build.row;
    if (row.recommended !== null) {
      recommendationsRecorded += 1;
      // An unrecorded recommendation cannot be mismatched, and neither can a
      // turn that has not called anything yet: both would be an accusation made
      // from no evidence.
      if (row.actual !== null && row.actual !== row.recommended) {
        row.mismatch = true;
        mismatchCount += 1;
      }
    }
    if (row.compactionSuspected) {
      compactionCount += 1;
      compactionMs += row.generationMs ?? 0;
    }
  }

  const turns = builds.map((build) => build.row);
  const join = joinLedger(turns, input.ledger ?? [], runRoot);

  let promptTokensTotal = 0;
  let completionTokensTotal = 0;
  let ledgerJoined = false;
  for (const row of turns) {
    if (row.promptTokens !== null || row.completionTokens !== null || row.upstreamMs !== null) {
      ledgerJoined = true;
    }
    promptTokensTotal += row.promptTokens ?? 0;
    completionTokensTotal += row.completionTokens ?? 0;
  }

  return {
    runRoot,
    firstTsMs,
    latestTsMs,
    turns,
    refusals,
    exchanges: deriveExchanges(records, firstTsMs),
    stall: deriveStall(lastAdvance, firstTsMs, latestTsMs, input.nowMs),
    waitingOn: deriveWaitingOn(turns, input.nowMs, latestTsMs),
    mismatchCount,
    recommendationsRecorded,
    refusalCount: refusals.length,
    compactionCount,
    compactionMs,
    promptTokensTotal,
    completionTokensTotal,
    ledgerJoined,
    ledgerPartialRoles: join.partialRoles,
    malformedRecords: input.malformedRecords ?? 0,
    malformedBytes: input.malformedBytes ?? 0,
  };
}

/**
 * The newest turn still in flight. There can be more than one — a wave has a
 * session per job — and the newest is the one a watcher is looking at.
 *
 * `waitingMs` is null when nothing measured it. Without a caller-supplied clock
 * the baseline is the newest record, and the newest record is normally the very
 * request this turn was opened by — so the difference is zero by construction
 * rather than by measurement, and "generating for 0s" would read as reassurance
 * about a sub-session that never came back.
 */
function deriveWaitingOn(
  turns: readonly TurnRow[],
  nowMs: number | undefined,
  latestTsMs: number | null,
): WaitingOn | null {
  const baseline = nowMs ?? latestTsMs;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.settled) continue;
    const measured = baseline === null || turn.tsMs === null ? null : baseline - turn.tsMs;
    return {
      turn: turn.turn,
      role: turn.role,
      sessionID: turn.sessionID,
      waitingMs: measured === null || (nowMs === undefined && measured <= 0) ? null : Math.max(0, measured),
    };
  }
  return null;
}

function deriveStall(
  lastAdvance: ObservedRecord | null,
  firstTsMs: number | null,
  latestTsMs: number | null,
  nowMs: number | undefined,
): StallClock {
  const advanceTs = lastAdvance === null ? null : tsOf(lastAdvance);
  // With nothing having advanced yet, the run has been where it is since it
  // started: the origin is the first record, and the clock still runs.
  const origin = advanceTs ?? firstTsMs;
  const baseline = nowMs ?? latestTsMs;
  const stallMs = origin === null || baseline === null ? 0 : Math.max(0, baseline - origin);
  return {
    stallMs,
    level: stallLevelOf(stallMs),
    lastAdvanceEvent:
      lastAdvance === null ? null : `${str(lastAdvance.component)}/${str(lastAdvance.event)}`,
    lastAdvanceDetail: lastAdvance === null ? null : advanceDetailOf(lastAdvance),
    lastAdvanceTsMs: advanceTs,
    lastAdvanceOffsetMs:
      advanceTs === null || firstTsMs === null ? null : advanceTs - firstTsMs,
    latestRecordTsMs: latestTsMs,
    sinceLastRecordMs:
      nowMs === undefined || latestTsMs === null ? null : Math.max(0, nowMs - latestTsMs),
  };
}

function isTerminalFanout(record: ObservedRecord): boolean {
  return (
    isEvent(record, "fanout", "subsession.complete") || isEvent(record, "fanout", "subsession.abort")
  );
}

/**
 * The run's sub-sessions, one row each, in the order they left.
 *
 * A dispatch pairs with the NEXT unclaimed terminal record for the SAME session,
 * so a second dispatch cannot borrow another sub-session's ending. Two shapes are
 * not dispatches and are rows all the same (replay.ts fanoutEntries pairs the same
 * way and reports the same three):
 *
 *   a HOLD — a write-capable job whose tree is frozen never became a session at
 *            all. It is neither in flight nor finished, and a console that omits
 *            it renders a frozen wave as an idle one.
 *   an UNPAIRED TERMINAL — the create-phase watchdog abort and the session-create
 *            failure both end a session no dispatch record ever opened.
 *
 * `attempts` is COUNTED from the subsession.retry records between the pair. The
 * terminal record does not always carry the field, and reading it off there
 * reports one clean attempt for a job that was re-prompted twice.
 */
function deriveExchanges(
  records: readonly ObservedRecord[],
  firstTsMs: number | null,
): ExchangeRow[] {
  const rows: ExchangeRow[] = [];
  const claimed = new Set<number>();
  const offsetOf = (ts: number | null): number | null =>
    ts === null || firstTsMs === null ? null : ts - firstTsMs;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.component !== "fanout") continue;
    const data = dataOf(record);
    const sessionID = strOrNull(record.sessionID);
    const tsMs = tsOf(record);
    const itemId = strOrNull(data["itemId"]) ?? strOrNull(record.itemId);

    if (isEvent(record, "fanout", "subsession.hold")) {
      rows.push({
        kind: "hold",
        sessionID,
        role: str(data["role"]),
        itemId,
        tree: strOrNull(data["tree"]),
        model: strOrNull(data["model"]),
        promptChars: null,
        prompt: null,
        promptTruncated: false,
        response: null,
        responseTruncated: false,
        dispatchedTsMs: tsMs,
        dispatchedOffsetMs: offsetOf(tsMs),
        durationMs: null,
        attempts: 1,
        outcome: "hold",
      });
      continue;
    }

    if (isTerminalFanout(record)) {
      // Claimed terminals are reported by the dispatch that claimed them; this
      // arm reports the ones no dispatch did. The scan below runs ahead of this
      // point for every earlier dispatch, so `claimed` is already decided here.
      if (claimed.has(i)) continue;
      rows.push({
        kind: "unpaired-end",
        sessionID,
        role: str(data["role"]),
        itemId,
        tree: strOrNull(data["tree"]),
        model: strOrNull(data["model"]),
        promptChars: null,
        prompt: null,
        promptTruncated: false,
        response: strOrNull(data["response"]),
        responseTruncated: data["truncated"] === true,
        dispatchedTsMs: tsMs,
        dispatchedOffsetMs: offsetOf(tsMs),
        durationMs: null,
        attempts: numOrNull(data["attempts"]) ?? 1,
        outcome: outcomeOfSettlement(record, data),
      });
      continue;
    }

    if (!isEvent(record, "fanout", "subsession.dispatched")) continue;
    const role = str(data["role"]);
    // A dispatch record with no role is the clamp warning, not a dispatch.
    if (role.length === 0) continue;
    const dispatchedTsMs = tsMs;

    let settled: ObservedRecord | null = null;
    let attempts = 1;
    if (sessionID !== null) {
      for (let j = i + 1; j < records.length; j += 1) {
        const candidate = records[j];
        if (strOrNull(candidate.sessionID) !== sessionID) continue;
        if (isEvent(candidate, "fanout", "subsession.retry")) {
          attempts += 1;
          continue;
        }
        if (!isTerminalFanout(candidate) || claimed.has(j)) continue;
        claimed.add(j);
        settled = candidate;
        break;
      }
    }
    const settledData = settled === null ? {} : dataOf(settled);
    const settledTs = settled === null ? null : tsOf(settled);

    rows.push({
      kind: "dispatch",
      sessionID,
      role,
      itemId,
      tree: strOrNull(data["tree"]),
      model: strOrNull(data["model"]),
      promptChars: numOrNull(data["promptChars"]),
      prompt: strOrNull(data["prompt"]),
      promptTruncated: data["truncated"] === true,
      response: strOrNull(settledData["response"]),
      responseTruncated: settledData["truncated"] === true,
      dispatchedTsMs,
      dispatchedOffsetMs: offsetOf(dispatchedTsMs),
      durationMs:
        settledTs === null || dispatchedTsMs === null ? null : settledTs - dispatchedTsMs,
      attempts,
      outcome: outcomeOfSettlement(settled, settledData),
    });
  }
  return rows;
}

function outcomeOfSettlement(
  settled: ObservedRecord | null,
  data: Record<string, unknown>,
): string {
  if (settled === null) return "in flight";
  const reason = strOrNull(data["reason"]);
  if (reason !== null) return reason;
  if (data["ok"] === true) return "ok";
  if (settled.event === "subsession.abort") return "aborted";
  return "failed";
}

/**
 * Per-turn tokens and latency, from the router's append-only ledger.
 *
 * The ledger carries no timestamp and no run id, so the join is POSITIONAL: the
 * run's own traffic is the entries whose `group` is the run root, and within
 * that, a role's Nth request is that role's Nth turn. Per role rather than
 * globally, because a wave's sub-session requests interleave with the
 * orchestrator's in the ledger exactly as they do in the journal.
 *
 * Positional means FRAGILE, and the fragility is one-directional: every request
 * the filter drops shifts that role's remaining turns by one, so a role short of
 * entries is a role whose every printed cost belongs to a different turn. The
 * router records a request with no group at all whenever the session had neither a
 * worktree nor an item id (adapter/inject.ts groupOf), which is the ordinary shape
 * of a planning-phase mechanical or skeptic session — so the shortfall is not a
 * hypothetical.
 *
 * The rule here is therefore: a role gets its cost column only when the group
 * carries at least one entry per SETTLED turn of that role. A role that does not
 * is named in `partialRoles` and gets nothing, and the caller prints the total as
 * partial. A turn beyond the entries at the tail of a covered role keeps null —
 * that is a live run's newest request, not a gap.
 */
function joinLedger(
  turns: readonly TurnRow[],
  ledger: readonly LedgerEntry[],
  runRoot: string | null,
): { partialRoles: string[] } {
  if (ledger.length === 0 || runRoot === null) return { partialRoles: [] };
  const byRole = new Map<string, LedgerEntry[]>();
  for (const entry of ledger) {
    if (entry.group !== runRoot) continue;
    const role = entry.role;
    if (role === null) continue;
    const bucket = byRole.get(role);
    if (bucket === undefined) byRole.set(role, [entry]);
    else bucket.push(entry);
  }
  const turnsByRole = new Map<string, TurnRow[]>();
  for (const turn of turns) {
    const bucket = turnsByRole.get(turn.role);
    if (bucket === undefined) turnsByRole.set(turn.role, [turn]);
    else bucket.push(turn);
  }
  const partialRoles: string[] = [];
  for (const [role, roleTurns] of turnsByRole) {
    const entries = byRole.get(role) ?? [];
    const settled = roleTurns.filter((turn) => turn.settled).length;
    if (entries.length < settled) {
      partialRoles.push(role);
      continue;
    }
    for (let i = 0; i < entries.length && i < roleTurns.length; i += 1) {
      roleTurns[i].promptTokens = entries[i].promptTokens;
      roleTurns[i].completionTokens = entries[i].completionTokens;
      roleTurns[i].upstreamMs = entries[i].upstreamMs;
    }
  }
  return { partialRoles: partialRoles.sort() };
}

// ---------------------------------------------------------------------------
// Follow mode — an append-only stream, not a repainted screen.
// ---------------------------------------------------------------------------

// Which rows of each kind have already been printed. A watcher left running
// overnight prints each row exactly once, so its scrollback is the run's history
// and piping it to a file yields a log rather than a flip-book.
//
// Turns and settlements are SETS of indices rather than high-water marks. A wave
// runs one session per job, and a single monotonic cursor stopping at the first
// unsettled turn hands one hung job the power to silence every other job's rows
// for the rest of the run — in the one mode whose whole purpose is watching a run
// that might hang. Dispatches and refusals stay counts: both are printable the
// moment they exist, so neither can ever be blocked.
export interface FollowCursor {
  turns: readonly number[];
  refusals: number;
  dispatches: number;
  settlements: readonly number[];
}

export const FOLLOW_START: FollowCursor = { turns: [], refusals: 0, dispatches: 0, settlements: [] };

// A row waiting to be printed, with the instant that orders it against the rows
// of the other two kinds.
interface StreamRow {
  tsMs: number;
  text: string;
}

/**
 * Everything that arrived since the caller's cursor, in time order.
 *
 * Pure: the caller owns the cursor, so the same view and cursor always yield the
 * same text, and a frame with nothing new is the empty string rather than a
 * repeat of the screen.
 */
export function nextFollowFrame(
  view: LiveConsole,
  cursor: FollowCursor,
): { text: string; cursor: FollowCursor } {
  const rows: StreamRow[] = [];
  // A turn streams once it has SETTLED — a row printed into an append-only stream
  // can never be corrected. Order WITHIN a session is preserved for free: opening
  // a session's next turn is what settles its previous one, so a session's
  // unsettled turn is always its last. Across sessions there is no order to
  // preserve, and the rows are stamped and sorted by time before emission.
  const printedTurns = new Set(cursor.turns);
  for (let i = 0; i < view.turns.length; i += 1) {
    const turn = view.turns[i];
    if (printedTurns.has(i) || !turn.settled) continue;
    rows.push({ tsMs: turn.tsMs ?? 0, text: turnLine(turn) });
    printedTurns.add(i);
  }
  for (let i = cursor.refusals; i < view.refusals.length; i += 1) {
    const refusal = view.refusals[i];
    rows.push({ tsMs: refusal.tsMs ?? 0, text: refusalLine(refusal) });
  }
  // A sub-session streams twice: the brief when it goes out, the answer when it
  // comes back. One row at settlement would hide a job that has been out for six
  // minutes, which is exactly the state a watcher needs to see.
  for (let i = cursor.dispatches; i < view.exchanges.length; i += 1) {
    const exchange = view.exchanges[i];
    rows.push({ tsMs: exchange.dispatchedTsMs ?? 0, text: dispatchLines(exchange).join("\n") });
  }
  const printedSettlements = new Set(cursor.settlements);
  for (let i = 0; i < view.exchanges.length; i += 1) {
    const exchange = view.exchanges[i];
    if (printedSettlements.has(i) || exchange.durationMs === null) continue;
    const settledTs = (exchange.dispatchedTsMs ?? 0) + (exchange.durationMs ?? 0);
    rows.push({ tsMs: settledTs, text: settlementLines(exchange).join("\n") });
    printedSettlements.add(i);
  }
  rows.sort((a, b) => a.tsMs - b.tsMs);
  return {
    text: rows.length === 0 ? "" : rows.map((row) => row.text).join("\n") + "\n",
    cursor: {
      turns: [...printedTurns].sort((a, b) => a - b),
      refusals: view.refusals.length,
      dispatches: view.exchanges.length,
      settlements: [...printedSettlements].sort((a, b) => a - b),
    },
  };
}

// ---------------------------------------------------------------------------
// Row formatting. Plain ASCII markers, no ANSI: a console piped into a file, a
// diff or a bug report stays byte-clean, and each marker greps on its own.
// ---------------------------------------------------------------------------

export const MARK_MISMATCH = "MISMATCH";
export const MARK_REFUSED = "REFUSED";
export const MARK_COMPACTION = "COMPACTION?";
export const MARK_NO_TOOL = "no-tool-call";
export const MARK_HELD = "!! HELD";

/** `t+123.4s`, the offset every row is stamped with. */
export function stamp(offsetMs: number | null): string {
  if (offsetMs === null) return "t+?";
  return `t+${(offsetMs / 1000).toFixed(1)}s`;
}

/** `12m34s`, for durations a reader has to judge rather than diff. */
export function humanMs(ms: number | null): string {
  if (ms === null) return "-";
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m${String(seconds).padStart(2, "0")}s`;
}

function tokenCell(turn: TurnRow): string {
  if (turn.promptTokens === null && turn.completionTokens === null) return "";
  const prompt = turn.promptTokens === null ? "-" : String(turn.promptTokens);
  const completion = turn.completionTokens === null ? "-" : String(turn.completionTokens);
  const upstream = turn.upstreamMs === null ? "" : ` up=${humanMs(turn.upstreamMs)}`;
  return ` tok=${prompt}/${completion}${upstream}`;
}

/** One turn, as a watcher reads it: what was asked for, what happened. */
export function turnLine(turn: TurnRow): string {
  const recommended =
    turn.recommended === null
      ? "rec=(unrecorded)"
      : `rec=${turn.recommended}${turn.recommendedItem === null ? "" : `/${turn.recommendedItem}`}`;
  const actual = turn.actual ?? (turn.noToolCall ? MARK_NO_TOOL : "-");
  const marks: string[] = [];
  if (turn.mismatch) marks.push(MARK_MISMATCH);
  if (turn.refused) marks.push(MARK_REFUSED);
  if (turn.compactionSuspected) marks.push(MARK_COMPACTION);
  const extra = turn.alsoCalled.length === 0 ? "" : ` +${String(turn.alsoCalled.length)} more`;
  return (
    `${stamp(turn.offsetMs).padEnd(11)} #${String(turn.turn).padEnd(4)} ${turn.role.padEnd(13)} ` +
    `${recommended.padEnd(34)} -> ${(actual + extra).padEnd(26)} ` +
    `gen=${humanMs(turn.generationMs).padEnd(7)}${tokenCell(turn)}` +
    `${marks.length === 0 ? "" : `  ${marks.join(" ")}`}`
  );
}

/** One refusal, which must be impossible to scroll past. */
export function refusalLine(refusal: RefusalRow): string {
  const parts = [`!! ${MARK_REFUSED}`, refusal.kind];
  if (refusal.gate !== null) parts.push(`gate=${refusal.gate}`);
  if (refusal.toolName !== null) parts.push(`tool=${refusal.toolName}`);
  if (refusal.itemId !== null) parts.push(`item=${refusal.itemId}`);
  parts.push(`reason=${refusal.reason ?? "(none recorded)"}`);
  if (refusal.detail !== null) parts.push(`at=${refusal.detail}`);
  return `${stamp(refusal.offsetMs).padEnd(11)} ${parts.join(" ")}`;
}

// How much of a brief or an answer a row shows before it stops being a row.
const EXCERPT_CHARS = 400;

function excerpt(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= EXCERPT_CHARS ? oneLine : `${oneLine.slice(0, EXCERPT_CHARS)} …`;
}

/**
 * A sub-session going out: who was sent where, and the brief they were handed.
 *
 * A HELD job and an unclaimed ending get their own opening line instead. A hold
 * rendered as a dispatch says a job is in flight when the truth is that its tree
 * is frozen and it has not started — the exact confusion renderReport names when
 * it prints "a write-capable job here is HELD, not hung".
 */
export function dispatchLines(exchange: ExchangeRow): string[] {
  if (exchange.kind === "hold") {
    return [
      `${stamp(exchange.dispatchedOffsetMs).padEnd(11)} ${MARK_HELD} ${exchange.role} ` +
        `on ${exchange.itemId ?? "(run)"}` +
        `${exchange.tree === null ? "" : ` tree=${exchange.tree}`} ` +
        `— write-capable job waiting for the tree to clear; no session exists yet`,
    ];
  }
  if (exchange.kind === "unpaired-end") {
    return [
      `${stamp(exchange.dispatchedOffsetMs).padEnd(11)} << ${exchange.role} ` +
        `on ${exchange.itemId ?? "(run)"} ${exchange.sessionID ?? "(no session)"} ` +
        `ended with no dispatch record: ${exchange.outcome}`,
    ];
  }
  const lines = [
    `${stamp(exchange.dispatchedOffsetMs).padEnd(11)} >> ${exchange.role} ` +
      `on ${exchange.itemId ?? "(run)"} ${exchange.sessionID ?? "(no session)"} ` +
      `${exchange.model === null ? "" : `model=${exchange.model} `}` +
      `brief=${exchange.promptChars === null ? "?" : String(exchange.promptChars)}chars`,
  ];
  if (exchange.prompt !== null) {
    lines.push(`               ask: ${excerpt(exchange.prompt)}${exchange.promptTruncated ? " [TRUNCATED]" : ""}`);
  }
  return lines;
}

/** A sub-session coming back: how long it took, how it ended, what it said. */
export function settlementLines(exchange: ExchangeRow): string[] {
  const lines = [
    `${stamp(
      exchange.dispatchedOffsetMs === null || exchange.durationMs === null
        ? null
        : exchange.dispatchedOffsetMs + exchange.durationMs,
    ).padEnd(11)} << ${exchange.role} on ${exchange.itemId ?? "(run)"} ` +
      `dur=${humanMs(exchange.durationMs)} attempts=${String(exchange.attempts)} ${exchange.outcome}`,
  ];
  if (exchange.response !== null) {
    lines.push(`               say: ${excerpt(exchange.response)}${exchange.responseTruncated ? " [TRUNCATED]" : ""}`);
  }
  return lines;
}

/** Both halves of one exchange, for a one-shot render that has both already. */
export function exchangeLines(exchange: ExchangeRow): string[] {
  return exchange.durationMs === null
    ? dispatchLines(exchange)
    : [...dispatchLines(exchange), ...settlementLines(exchange)];
}

/** Who the run is waiting on, and since when — or that nothing measured it. */
export function waitingLine(waiting: WaitingOn): string {
  return (
    `waiting on turn #${String(waiting.turn)} ${waiting.role}` +
    `${waiting.sessionID === null ? "" : ` (${waiting.sessionID})`}` +
    (waiting.waitingMs === null
      ? " — unsettled; no record has arrived since the request was built"
      : ` — generating for ${humanMs(waiting.waitingMs)}`)
  );
}

/** The stall banner: the one line a watcher can read from across the room. */
export function stallBanner(stall: StallClock): string {
  const level = stall.level.toUpperCase();
  const bar = stall.level === "ok" ? "" : ` ${"!".repeat(STALL_LEVELS.indexOf(stall.level) * 3)}`;
  const since =
    stall.lastAdvanceEvent === null
      ? "nothing has advanced yet in this run"
      : `since ${stall.lastAdvanceEvent}` +
        `${stall.lastAdvanceDetail === null ? "" : ` -> ${stall.lastAdvanceDetail}`}` +
        ` at ${stamp(stall.lastAdvanceOffsetMs)}`;
  const silence =
    stall.sinceLastRecordMs === null
      ? ""
      : `  (journal silent ${humanMs(stall.sinceLastRecordMs)})`;
  return `STALL ${humanMs(stall.stallMs).padEnd(8)} [${level}]${bar} ${since}${silence}`;
}
