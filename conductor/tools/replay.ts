// conductor/tools/replay.ts — Task 15.0 (plan lines 3028-3035) implementing
// §7.3 (plan lines 1946-1953): the journal -> human timeline renderer.
//
//   node conductor/tools/replay.ts <run dir> [--component …] [--level …] [--item I3]
//
// Two layers, in the tools/export-schemas.ts mould: PURE derivations (journal
// records -> swimlane / fan-out-duration / review-round rows) plus a text
// renderer over them, and exactly one I/O function (readRunJournal) with a thin
// argv/stdout shell at the bottom, guarded by an argv[1] suffix so importing
// this module does nothing at all. G1: node built-ins only. G2: erasable
// TypeScript. G3-adjacent: the derivations and the renderer read no clock, so
// two machines in two timezones render one journal identically.
//
// What it reads and what it never reads: the journal is the whole input —
// <runDir>/journal.jsonl plus its rotated archives <runDir>/journal.N.jsonl.gz
// (§7.1, plan lines 1919-1921). Nothing else in the run dir is opened, nothing
// anywhere is written, and no sub-session is dispatched. The §1.2 layout lists
// reviews/<itemId|plan>-r<N>.json, but nothing writes that file, so replay does
// not read it: a renderer reports what the journal recorded and nothing else.
//
// Ordering is SOURCE order — archives by ascending numeric index, then the
// active journal, and within a file its line order. It is never a sort by seq
// or ts: rotation truncates journal.jsonl, so seq restarts at 1 and the same
// seq legitimately occurs twice in one run's history. The rendered row prints
// the recorded seq verbatim, duplicates and all, because that is what a grep of
// the file will match.
//
// The vocabulary is not restated here. The eight components, the closed event
// list and the §7.1 severity order come from core; a line's conformance is
// decided by the core validator over SCHEMAS.JournalRecord.

import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";

import { COMPONENTS, isKnownEvent } from "../core/journal-events.ts";
import { LOG_LEVELS, validate } from "../core/types.ts";
import type { JournalRecord, LogLevel } from "../core/types.ts";

// A line that could not become a record. `line` is 1-based within its own
// source file; `raw` is the text verbatim, so a human can read what was on disk
// (§7.4: never silently lose a record).
export interface Malformed {
  line: number;
  raw: string;
  reason: string;
}

// The three §7.3 flags, already parsed. Absent means "filters nothing".
export interface ReplayFilters {
  components?: string[];
  level?: LogLevel;
  items?: string[];
}

// One swimlane. `itemId` null is the run-level lane.
export interface Lane {
  itemId: string | null;
  rows: JournalRecord[];
}

// One sub-session in the fan-out duration table.
export interface FanoutRow {
  sessionID: string | null;
  role: string | null;
  itemId: string | null;
  tree: string | null;
  model: string | null;
  lens: string | null;
  attempts: number;
  durationMs: number | null;
  outcome: string;
}

// One review round. The journal records no per-finding verdict at HEAD, so this
// table reports rounds — what was raised, what survived, who was dispatched —
// and invents no uphold/overturn column.
export interface ReviewRoundRow {
  subject: string;
  round: number;
  max: number | null;
  findings: number | null;
  findingsRaised: { major: number; minor: number; nit: number } | null;
  survivingMajors: number;
  lenses: string[];
  why: string | null;
  outcome: string;
  reviewers: number;
  skeptics: number;
}

// One file readRunJournal tried to read, in the order it tried. A source that
// could not be inflated is reported with ok:false rather than omitted: a silent
// omission would make the timeline lie about what happened.
export interface JournalSource {
  file: string;
  ok: boolean;
  error?: string;
}

// Plain-ASCII markers (no ANSI anywhere): a render piped into a file, a diff or
// a bug report stays byte-clean, and each marker is a bare uppercase token that
// greps on its own.
const MARK_DENY = "DENY";
const MARK_CRASH = "CRASH";
const MARK_TRUNCATED = "TRUNCATED";
const MARK_UNKNOWN_EVENT = "UNKNOWN-EVENT";
const MARK_UNTERMINATED = "UNTERMINATED";
const MARK_NO_SESSION = "NO-SESSION";
const MARK_UNKNOWN_LENS = "UNKNOWN-LENS";
const MARK_NO_RECORDS = "NO-RECORDS";
const EMPTY_SECTION = "(none)";

const SEC_SOURCES = "SOURCES";
const SEC_SWIMLANES = "SWIMLANES";
const SEC_DENIALS = "DENIALS";
const SEC_FANOUT = "FAN-OUT";
const SEC_REVIEW = "REVIEW ROUNDS";
const SEC_MALFORMED = "MALFORMED";

const FANOUT = "fanout";
const EV_DISPATCHED = "subsession.dispatched";
const EV_RETRY = "subsession.retry";
const EV_HOLD = "subsession.hold";
const EV_COMPLETE = "subsession.complete";
const EV_ABORT = "subsession.abort";
const TERMINAL_EVENTS: readonly string[] = [EV_COMPLETE, EV_ABORT];

const GATES = "gates";
const EV_DENY = "deny";
const EV_GATE_CRASH = "gate-crash";

const FSM = "fsm";
const EV_TRANSITION = "transition";
const EV_GUARD_REJECT = "guard-reject";

const ARCHIVE_PATTERN = /^journal\.(\d+)\.jsonl\.gz$/;
const ACTIVE_JOURNAL = "journal.jsonl";

// The largest instant a Date can represent; beyond it toISOString throws.
const MAX_TIME_VALUE = 8.64e15;

// ---------------------------------------------------------------------------
// Small readers over untyped payloads
// ---------------------------------------------------------------------------

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A non-empty string, or null. The empty string is treated as absence
// throughout: the fan-out engine initialises sessionID to "" before
// session.create returns, and the plan-review lens jobs carry itemId "", so ""
// is a value that means "not set yet" rather than a session or an item.
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function findingsRaisedOf(value: unknown): { major: number; minor: number; nit: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raised = value as Record<string, unknown>;
  const major = numberOrNull(raised.major);
  const minor = numberOrNull(raised.minor);
  const nit = numberOrNull(raised.nit);
  if (major === null || minor === null || nit === null) return null;
  return { major, minor, nit };
}

// The record's own session id, or null when it carries none or carries "".
function sessionOf(record: JournalRecord): string | null {
  return stringOrNull(record.sessionID);
}

// The record's own item, or null for a run-level record.
function itemOf(record: JournalRecord): string | null {
  return stringOrNull(record.itemId);
}

function isoOf(ts: number): string {
  if (!Number.isFinite(ts) || Math.abs(ts) > MAX_TIME_VALUE) return `ts:${String(ts)}`;
  return new Date(ts).toISOString();
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// One record per well-formed line, in FILE order. Blank and whitespace-only
// lines are skipped silently (a blank line is not a malformed record). Every
// other line that fails becomes a Malformed entry carrying its 1-based line
// number, its raw text and the reason — a torn fragment left by a crash
// mid-append is reported, never dropped and never fatal. Conformance is decided
// by the core validator, so replay and the writer can never disagree about what
// a journal record is.
export function parseJournalText(text: string): { records: JournalRecord[]; malformed: Malformed[] } {
  const records: JournalRecord[] = [];
  const malformed: Malformed[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      malformed.push({ line: i + 1, raw, reason: `JSON parse error: ${messageOf(error)}` });
      continue;
    }
    const result = validate("JournalRecord", parsed);
    if (!result.ok) {
      malformed.push({ line: i + 1, raw, reason: `not a journal record: ${result.errors.join("; ")}` });
      continue;
    }
    records.push(parsed as JournalRecord);
  }
  return { records, malformed };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

// The three flags compose as AND. --component and --item are set membership.
// --level is a THRESHOLD over the single core severity order (error most
// severe), matching §7.1's sink semantics: --level warn keeps error and warn.
// --item selects records whose itemId is in the set, which EXCLUDES run-level
// records — they belong to the run lane, not to an item.
export function applyFilters(
  records: readonly JournalRecord[],
  filters: ReplayFilters,
): JournalRecord[] {
  const components = filters.components;
  const items = filters.items;
  const threshold = filters.level === undefined ? -1 : LOG_LEVELS.indexOf(filters.level);
  const kept: JournalRecord[] = [];
  for (const record of records) {
    if (components !== undefined && !components.includes(record.component)) continue;
    if (items !== undefined) {
      const itemId = itemOf(record);
      if (itemId === null || !items.includes(itemId)) continue;
    }
    if (threshold >= 0 && LOG_LEVELS.indexOf(record.level) > threshold) continue;
    kept.push(record);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Swimlanes
// ---------------------------------------------------------------------------

// The run lane (itemId null, every record carrying no item) first, then one
// lane per distinct itemId in FIRST-APPEARANCE order, each holding its records
// in input order. Every record lands in exactly one lane.
export function deriveSwimlanes(records: readonly JournalRecord[]): Lane[] {
  const runLane: Lane = { itemId: null, rows: [] };
  const byItem = new Map<string, Lane>();
  const itemLanes: Lane[] = [];
  for (const record of records) {
    const itemId = itemOf(record);
    if (itemId === null) {
      runLane.rows.push(record);
      continue;
    }
    let lane = byItem.get(itemId);
    if (lane === undefined) {
      lane = { itemId, rows: [] };
      byItem.set(itemId, lane);
      itemLanes.push(lane);
    }
    lane.rows.push(record);
  }
  return runLane.rows.length === 0 ? itemLanes : [runLane, ...itemLanes];
}

// ---------------------------------------------------------------------------
// Fan-out durations
// ---------------------------------------------------------------------------

// A row plus the index of the record that produced it, so the renderer can ask
// which review round a dispatch sat inside without re-deriving the pairing.
interface FanoutEntry {
  row: FanoutRow;
  index: number;
}

// The terminal record's own account of how the sub-session ended.
function outcomeOf(terminal: JournalRecord): string {
  const reason = stringOrNull(terminal.data.reason);
  if (reason !== null) return reason;
  if (terminal.data.ok === true) return "ok";
  if (terminal.event === EV_ABORT) return "aborted";
  return "failed";
}

function isFanoutEvent(record: JournalRecord, event: string): boolean {
  return record.component === FANOUT && record.event === event;
}

function fanoutEntries(records: readonly JournalRecord[]): FanoutEntry[] {
  const entries: FanoutEntry[] = [];
  // Terminal records already claimed by an earlier dispatch, so a second
  // dispatch cannot pair with someone else's completion.
  const paired = new Set<number>();

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.component !== FANOUT) continue;
    const session = sessionOf(record);

    if (record.event === EV_DISPATCHED) {
      // Pair with the NEXT unclaimed terminal record for the SAME session. A
      // dispatch with no session id cannot be correlated at all, so it stays
      // unpaired rather than borrowing an unrelated sub-session's ending.
      let terminalIndex = -1;
      if (session !== null) {
        for (let j = i + 1; j < records.length; j += 1) {
          const candidate = records[j];
          if (candidate.component !== FANOUT) continue;
          if (!TERMINAL_EVENTS.includes(candidate.event)) continue;
          if (paired.has(j)) continue;
          if (sessionOf(candidate) !== session) continue;
          terminalIndex = j;
          paired.add(j);
          break;
        }
      }
      const terminal = terminalIndex === -1 ? null : records[terminalIndex];
      // The schema-retry loop journals one subsession.retry per re-prompt, so
      // the attempt count is 1 + the retries between dispatch and terminal.
      let attempts = 1;
      if (terminal !== null && session !== null) {
        for (let j = i + 1; j < terminalIndex; j += 1) {
          const between = records[j];
          if (isFanoutEvent(between, EV_RETRY) && sessionOf(between) === session) attempts += 1;
        }
      }
      entries.push({
        index: i,
        row: {
          sessionID: session,
          role: stringOrNull(record.data.role),
          itemId: stringOrNull(record.data.itemId) ?? itemOf(record),
          tree: stringOrNull(record.data.tree),
          model: stringOrNull(record.data.model),
          lens: stringOrNull(record.data.lens),
          attempts,
          // The engine's own timings are returned to its caller and never
          // journaled, so the duration is the ts delta of the two records that
          // ARE on disk — and an unpaired dispatch gets none at all rather than
          // a 0 that would read as "completed instantly".
          durationMs: terminal === null ? null : terminal.ts - record.ts,
          outcome: terminal === null ? "unterminated" : outcomeOf(terminal),
        },
      });
      continue;
    }

    if (record.event === EV_HOLD) {
      // A held write-capable job never became a session: it is its own row, not
      // a dispatch and not an unterminated one.
      entries.push({
        index: i,
        row: {
          sessionID: session,
          role: stringOrNull(record.data.role),
          itemId: stringOrNull(record.data.itemId) ?? itemOf(record),
          tree: stringOrNull(record.data.tree),
          model: stringOrNull(record.data.model),
          lens: stringOrNull(record.data.lens),
          attempts: 1,
          durationMs: null,
          outcome: "hold",
        },
      });
      continue;
    }

    if (TERMINAL_EVENTS.includes(record.event) && !paired.has(i)) {
      // A terminal record no dispatch claimed — the create-phase watchdog abort
      // and the session-create failure both look like this. Each keeps its own
      // item and its own reason; they are never merged into one synthetic row.
      entries.push({
        index: i,
        row: {
          sessionID: session,
          role: stringOrNull(record.data.role),
          itemId: stringOrNull(record.data.itemId) ?? itemOf(record),
          tree: stringOrNull(record.data.tree),
          model: stringOrNull(record.data.model),
          lens: stringOrNull(record.data.lens),
          attempts: numberOrNull(record.data.attempts) ?? 1,
          durationMs: null,
          outcome: outcomeOf(record),
        },
      });
    }
  }
  return entries;
}

// One row per dispatched sub-session, plus one for every hold and every terminal
// record that paired with nothing.
export function deriveFanoutRows(records: readonly JournalRecord[]): FanoutRow[] {
  return fanoutEntries(records).map((entry) => entry.row);
}

// ---------------------------------------------------------------------------
// Review rounds
// ---------------------------------------------------------------------------

// A round row plus the record window it closes, so the renderer can attribute a
// dispatch (and its lens roster) to the round it ran inside.
interface RoundEntry {
  row: ReviewRoundRow;
  start: number;
  end: number;
}

// A round boundary is a record that states how a review round ENDED:
//   fsm/guard-reject with data.stage AND data.survivingMajors — a round that
//     did not pass. Both keys are required: the planner-revision reject shares
//     the stage key but reports no surviving majors, and counting it would
//     duplicate the round and claim zero survivors for a round where majors
//     demonstrably survived.
//   fsm/transition with data.survivingMajors — the transition that closes the
//     sequence. An ordinary transition carries none and is not a review round.
function roundKind(record: JournalRecord): "re-round" | "accepted" | null {
  if (record.component !== FSM) return null;
  if (numberOrNull(record.data.survivingMajors) === null) return null;
  if (record.event === EV_GUARD_REJECT && record.data.stage !== undefined) return "re-round";
  if (record.event === EV_TRANSITION) return "accepted";
  return null;
}

function countDispatchedRole(
  records: readonly JournalRecord[],
  start: number,
  end: number,
  role: string,
): number {
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    const record = records[i];
    if (isFanoutEvent(record, EV_DISPATCHED) && stringOrNull(record.data.role) === role) count += 1;
  }
  return count;
}

function reviewRoundEntries(records: readonly JournalRecord[]): RoundEntry[] {
  const entries: RoundEntry[] = [];
  let start = 0;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const kind = roundKind(record);
    if (kind === null) continue;
    const data = record.data;
    // The two producers spell the same facts differently — `round` vs `rounds`,
    // `findings` vs `findingsRaised` — so both spellings are read.
    entries.push({
      start,
      end: i,
      row: {
        subject: itemOf(record) ?? "plan",
        round: numberOrNull(data.round) ?? numberOrNull(data.rounds) ?? 0,
        max: numberOrNull(data.max),
        findings: numberOrNull(data.findings),
        findingsRaised: findingsRaisedOf(data.findingsRaised),
        survivingMajors: numberOrNull(data.survivingMajors) ?? 0,
        lenses: stringsOf(data.lenses),
        why: stringOrNull(data.why),
        outcome: kind,
        reviewers: countDispatchedRole(records, start, i, "reviewer"),
        skeptics: countDispatchedRole(records, start, i, "skeptic"),
      },
    });
    start = i + 1;
  }
  return entries;
}

// One row per review round, subject = the record's itemId or "plan", with the
// reviewer/skeptic dispatch counts from that round's own window.
export function deriveReviewRounds(records: readonly JournalRecord[]): ReviewRoundRow[] {
  return reviewRoundEntries(records).map((entry) => entry.row);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function quoted(value: string): string {
  return JSON.stringify(value);
}

function sectionOf(name: string, body: readonly string[]): string[] {
  return [`== ${name} ==`, ...(body.length === 0 ? [EMPTY_SECTION] : body)];
}

function filtersLine(filters: ReplayFilters): string {
  const parts: string[] = [];
  if (filters.components !== undefined) parts.push(`components=${filters.components.join(",")}`);
  if (filters.items !== undefined) parts.push(`items=${filters.items.join(",")}`);
  if (filters.level !== undefined) parts.push(`level=${filters.level}`);
  return `filters: ${parts.length === 0 ? "none" : parts.join(" ")}`;
}

function sourceLines(sources: readonly JournalSource[], filters: ReplayFilters): string[] {
  const lines = sources.map((source) => {
    const status = source.ok ? "ok" : "FAILED";
    const detail = source.ok || source.error === undefined ? "" : ` error=${quoted(source.error)}`;
    return `  ${status.padEnd(6)} ${source.file}${detail}`;
  });
  lines.push(filtersLine(filters));
  return lines;
}

// The markers a single record's line carries. A truncated payload says so (a
// blank data field would read as "nothing happened" when in fact the payload
// was too big to keep), and an event outside the closed vocabulary is shown
// rather than hidden — production retains such a record precisely so a human
// can see it.
function markersOf(record: JournalRecord): string[] {
  const marks: string[] = [];
  if (record.component === GATES && record.event === EV_DENY) marks.push(MARK_DENY);
  if (record.component === GATES && record.event === EV_GATE_CRASH) marks.push(MARK_CRASH);
  if (record.data.truncated === true) marks.push(MARK_TRUNCATED);
  if (!isKnownEvent(record.component, record.event)) marks.push(MARK_UNKNOWN_EVENT);
  return marks;
}

function recordLine(record: JournalRecord): string {
  const parts = [
    `#${record.seq}`,
    isoOf(record.ts),
    record.level,
    `${record.component}/${record.event}`,
  ];
  const session = sessionOf(record);
  if (session !== null) parts.push(`ses=${session}`);
  parts.push(...markersOf(record));
  parts.push(JSON.stringify(record.data));
  return `  ${parts.join(" ")}`;
}

function swimlaneLines(lanes: readonly Lane[], recordCount: number): string[] {
  if (recordCount === 0) return [`${EMPTY_SECTION} ${MARK_NO_RECORDS}`];
  const lines: string[] = [];
  for (const lane of lanes) {
    lines.push(lane.itemId === null ? "-- run --" : `-- item ${lane.itemId} --`);
    for (const record of lane.rows) lines.push(recordLine(record));
  }
  return lines;
}

// Both gate records a reader must not miss, in one section under two distinct
// markers: the gate that refused, and the gate that never got to decide.
function denialLines(records: readonly JournalRecord[]): string[] {
  const lines: string[] = [];
  for (const record of records) {
    if (record.component !== GATES) continue;
    const data = record.data;
    if (record.event === EV_DENY) {
      const parts = [MARK_DENY, `#${record.seq}`];
      const toolName = stringOrNull(data.toolName);
      if (toolName !== null) parts.push(`tool=${toolName}`);
      const itemId = itemOf(record);
      if (itemId !== null) parts.push(`item=${itemId}`);
      const reason = stringOrNull(data.reason);
      if (reason !== null) parts.push(`reason=${quoted(reason)}`);
      const command = stringOrNull(data.command);
      if (command !== null) parts.push(`command=${quoted(command)}`);
      const editPath = stringOrNull(data.editPath);
      if (editPath !== null) parts.push(`editPath=${editPath}`);
      lines.push(`  ${parts.join(" ")}`);
      continue;
    }
    if (record.event === EV_GATE_CRASH) {
      const parts = [MARK_CRASH, `#${record.seq}`];
      const toolName = stringOrNull(data.toolName);
      if (toolName !== null) parts.push(`tool=${toolName}`);
      if (data.guarded === true) parts.push("guarded=true");
      const error = stringOrNull(data.error);
      if (error !== null) parts.push(`error=${quoted(error)}`);
      lines.push(`  ${parts.join(" ")}`);
    }
  }
  return lines;
}

// Which round's window a record index sat inside, or null when it sat after the
// last closed round (or in a journal with no rounds at all).
function roundForIndex(rounds: readonly RoundEntry[], index: number): RoundEntry | null {
  for (const entry of rounds) {
    if (index >= entry.start && index <= entry.end) return entry;
  }
  return null;
}

// The lens is data.lens when the dispatch recorded one; failing that, the lens
// roster of the round it ran inside — the whole roster, since which lens this
// session held is simply unrecorded; failing that, the unknown marker. A lens
// name is never invented.
function lensCell(entry: FanoutEntry, rounds: readonly RoundEntry[]): string {
  if (entry.row.lens !== null) return entry.row.lens;
  const round = roundForIndex(rounds, entry.index);
  if (round !== null && round.row.lenses.length > 0) return round.row.lenses.join(",");
  return MARK_UNKNOWN_LENS;
}

function fanoutLines(entries: readonly FanoutEntry[], rounds: readonly RoundEntry[]): string[] {
  return entries.map((entry) => {
    const row = entry.row;
    const parts = [
      (row.sessionID ?? MARK_NO_SESSION).padEnd(12),
      (row.role ?? "-").padEnd(12),
      (row.itemId ?? "-").padEnd(6),
      (row.tree ?? "-").padEnd(8),
      (row.model ?? "-").padEnd(14),
      lensCell(entry, rounds).padEnd(14),
      `attempts=${String(row.attempts)}`,
      row.durationMs === null ? "dur=-" : `dur=${String(row.durationMs)}ms`,
      row.outcome,
    ];
    if (row.outcome === "unterminated") parts.push(MARK_UNTERMINATED);
    return `  ${parts.join(" ")}`;
  });
}

function reviewLines(rounds: readonly RoundEntry[]): string[] {
  return rounds.map((entry) => {
    const row = entry.row;
    const parts = [
      row.subject.padEnd(8),
      `round=${String(row.round)}/${row.max === null ? "-" : String(row.max)}`,
      `findings=${row.findings === null ? "-" : String(row.findings)}`,
      `raised=${
        row.findingsRaised === null
          ? "-"
          : `major:${String(row.findingsRaised.major)},minor:${String(row.findingsRaised.minor)},nit:${String(row.findingsRaised.nit)}`
      }`,
      `survivingMajors=${String(row.survivingMajors)}`,
      `lenses=${row.lenses.length === 0 ? "-" : row.lenses.join(",")}`,
      `reviewers=${String(row.reviewers)}`,
      `skeptics=${String(row.skeptics)}`,
      row.outcome,
    ];
    if (row.why !== null) parts.push(`why=${quoted(row.why)}`);
    return `  ${parts.join(" ")}`;
  });
}

function malformedLines(malformed: readonly Malformed[]): string[] {
  return malformed.map(
    (entry) => `  line=${String(entry.line)} reason=${quoted(entry.reason)} raw=${entry.raw}`,
  );
}

// The whole timeline as deterministic plain-ASCII text. The filters are applied
// exactly ONCE, here, and every section derives from that one set — two halves
// of one render disagreeing about which records exist would be worse than
// either alone. Every section is present even when empty, because an omitted
// section and an empty one must not look alike. Timestamps come from record.ts
// alone, so the same journal renders the same bytes on any machine.
export function renderTimeline(input: {
  records: readonly JournalRecord[];
  malformed: readonly Malformed[];
  filters: ReplayFilters;
  sources: readonly JournalSource[];
}): string {
  const records = applyFilters(input.records, input.filters);
  const lanes = deriveSwimlanes(records);
  const fanEntries = fanoutEntries(records);
  const rounds = reviewRoundEntries(records);

  const lines: string[] = [
    ...sectionOf(SEC_SOURCES, sourceLines(input.sources, input.filters)),
    ...sectionOf(SEC_SWIMLANES, swimlaneLines(lanes, records.length)),
    ...sectionOf(SEC_DENIALS, denialLines(records)),
    ...sectionOf(SEC_FANOUT, fanoutLines(fanEntries, rounds)),
    ...sectionOf(SEC_REVIEW, reviewLines(rounds)),
    ...sectionOf(SEC_MALFORMED, malformedLines(input.malformed)),
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

// Exit codes, which Task 15.1 documents: 0 rendered (an empty journal renders
// the zero-record notice and is still a 0); 2 usage error, message on stderr
// and nothing on stdout; 1 the run dir holds no readable journal source at all.
const EXIT_USAGE = 2;

interface ArgsOk {
  ok: true;
  runDir: string;
  filters: ReplayFilters;
}

interface ArgsErr {
  ok: false;
  error: string;
  exitCode: number;
}

function usageError(message: string): ArgsErr {
  return { ok: false, error: message, exitCode: EXIT_USAGE };
}

// Union of a repeated flag's values, order-preserving and de-duplicated, so
// `--item I1 --item I2` and `--item I1,I2` are the same request.
function addValues(into: string[], value: string): void {
  for (const part of value.split(",")) {
    if (!into.includes(part)) into.push(part);
  }
}

// argv is the ARGUMENT list only (process.argv.slice(2)). The run dir is the
// first non-flag positional. An unknown flag or an unknown --component/--level
// value is a usage error naming the offending value: a typo must never render a
// silently empty timeline.
export function parseArgs(argv: readonly string[]): ArgsOk | ArgsErr {
  let runDir: string | null = null;
  const components: string[] = [];
  const items: string[] = [];
  let level: LogLevel | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (runDir !== null) {
        return usageError(`replay: unexpected extra argument ${quoted(arg)}; expected one run dir`);
      }
      runDir = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    let value: string | null = eq === -1 ? null : arg.slice(eq + 1);
    if (name !== "--component" && name !== "--level" && name !== "--item") {
      return usageError(
        `replay: unknown flag ${name}; the flags are --component, --level and --item`,
      );
    }
    if (value === null) {
      i += 1;
      if (i >= argv.length) return usageError(`replay: ${name} needs a value`);
      value = argv[i];
    }
    if (name === "--component") {
      for (const part of value.split(",")) {
        if (!(COMPONENTS as readonly string[]).includes(part)) {
          return usageError(
            `replay: unknown --component value ${quoted(part)}; the components are ${COMPONENTS.join(", ")}`,
          );
        }
      }
      addValues(components, value);
      continue;
    }
    if (name === "--item") {
      addValues(items, value);
      continue;
    }
    if (!(LOG_LEVELS as readonly string[]).includes(value)) {
      return usageError(
        `replay: unknown --level value ${quoted(value)}; the levels are ${LOG_LEVELS.join(", ")}`,
      );
    }
    level = value as LogLevel;
  }

  if (runDir === null) {
    return usageError(
      "replay: no run dir given; usage: node conductor/tools/replay.ts <run dir> " +
        "[--component C] [--level L] [--item I]",
    );
  }
  const filters: ReplayFilters = {};
  if (components.length > 0) filters.components = components;
  if (items.length > 0) filters.items = items;
  if (level !== null) filters.level = level;
  return { ok: true, runDir, filters };
}

// ---------------------------------------------------------------------------
// The one I/O function
// ---------------------------------------------------------------------------

// Read a run dir's whole journal history: every journal.N.jsonl.gz in ASCENDING
// NUMERIC index (so journal.10 follows journal.2, which a lexicographic sort
// would get backwards), then the active journal.jsonl. Read-only: nothing is
// created, modified or removed, and no other file in the run dir is opened.
// A source that cannot be read or inflated is reported ok:false with its error
// and the remaining sources still render.
export function readRunJournal(runDir: string): {
  records: JournalRecord[];
  malformed: Malformed[];
  sources: JournalSource[];
} {
  const records: JournalRecord[] = [];
  const malformed: Malformed[] = [];
  const sources: JournalSource[] = [];

  let names: string[];
  try {
    names = readdirSync(runDir);
  } catch {
    return { records, malformed, sources };
  }

  const archives: { name: string; index: number }[] = [];
  for (const name of names) {
    const matched = ARCHIVE_PATTERN.exec(name);
    if (matched !== null) archives.push({ name, index: Number(matched[1]) });
  }
  archives.sort((a, b) => (a.index === b.index ? (a.name < b.name ? -1 : 1) : a.index - b.index));

  const ordered = archives.map((archive) => archive.name);
  if (names.includes(ACTIVE_JOURNAL)) ordered.push(ACTIVE_JOURNAL);

  for (const name of ordered) {
    const file = path.join(runDir, name);
    let text: string;
    try {
      text = name.endsWith(".gz")
        ? gunzipSync(readFileSync(file)).toString("utf8")
        : readFileSync(file, "utf8");
    } catch (error) {
      sources.push({ file, ok: false, error: messageOf(error) });
      continue;
    }
    sources.push({ file, ok: true });
    const parsed = parseJournalText(text);
    for (const record of parsed.records) records.push(record);
    for (const entry of parsed.malformed) malformed.push(entry);
  }
  return { records, malformed, sources };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// `node conductor/tools/replay.ts <run dir> [flags]`. Guarded by an argv[1]
// suffix check, the committed tools/ convention: Node type-stripping exposes no
// entry-point flag of its own, and the same file must load under both supported
// runtimes. Importing this module therefore does nothing — no output, no file
// touched.
if (process.argv[1] !== undefined && process.argv[1].endsWith("replay.ts")) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = parsed.exitCode;
  } else {
    const read = readRunJournal(parsed.runDir);
    if (read.sources.length === 0 || read.sources.every((source) => !source.ok)) {
      process.stderr.write(
        `replay: no readable journal source in ${parsed.runDir} ` +
          `(expected ${ACTIVE_JOURNAL} or journal.N.jsonl.gz)\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        renderTimeline({
          records: read.records,
          malformed: read.malformed,
          filters: parsed.filters,
          sources: read.sources,
        }),
      );
    }
  }
}
