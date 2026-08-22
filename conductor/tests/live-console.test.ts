// conductor/tests/live-console.test.ts — the live run console: the derivations a
// watcher reads a run through while it is still running, and the renderer that
// puts them on a terminal.
//
// WHY THESE ROWS AND NOT OTHERS. Every assertion here is anchored to one
// preserved 45-minute run (.data/analysis/evidence, run r-20260821-0a31) that
// timed out. In that run the FSM made exactly ONE transition and then sat at the
// same position for 36 minutes while the model generated continuously; the state
// block recommended one tool on all 16 orchestrator requests of the EXECUTING
// phase and the model called something else every time; two auto-compactions ate
// 472.9 seconds; and two of three tool failures were refusals that wrote no
// journal record at all. A console that renders a timeline and nothing else
// would have shown that run as healthy. So the derivations under test are the
// four signals that would have named the deadlock: the stall clock, the
// recommendation against the tool actually called, refusals, and the compaction
// shape — plus the sub-session exchanges (what a sub-agent was asked and what it
// answered) and the per-turn cost joined from the router ledger.
//
// The subject splits the way the two tools already split: PURE derivations in
// conductor/tools/observation.ts, which imports nothing and reads no clock, and
// the I/O plus formatting in conductor/tools/observe.ts. Every derivation test
// below therefore runs on synthetic records with no filesystem at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPACTION_MIN_GAP_MS,
  stallBanner,
  waitingLine,
  STALL_THRESHOLDS_MS,
  deriveLiveConsole,
  exchangeLines,
  ledgerEntriesOf,
  FOLLOW_START,
  nextFollowFrame,
  parseConcatenatedJson,
  stallLevelOf,
} from "../tools/observation.ts";
import type { LedgerEntry, LiveConsole, ObservedRecord } from "../tools/observation.ts";
import { followRun, observeRunDir, readItems, readLedgerFile, readRunRecords, renderConsole } from "../tools/observe.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const observePath = path.resolve(testsDir, "..", "tools", "observe.ts");

const T0 = 1787347799904;
const SES = "ses_orchestrator";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "conductor-live-console-"));
}

// A journal record in the shape adapter/journal.ts writes.
function record(
  offsetSeconds: number,
  component: string,
  event: string,
  data: Record<string, unknown>,
  extra: { sessionID?: string; itemId?: string; level?: string; seq?: number } = {},
): ObservedRecord {
  return {
    seq: extra.seq ?? 0,
    ts: T0 + Math.round(offsetSeconds * 1000),
    level: extra.level ?? "info",
    component,
    runId: "r-test",
    event,
    data,
    ...(extra.sessionID === undefined ? {} : { sessionID: extra.sessionID }),
    ...(extra.itemId === undefined ? {} : { itemId: extra.itemId }),
  } as ObservedRecord;
}

function inject(offsetSeconds: number, role: string, extra: Record<string, unknown> = {}): ObservedRecord {
  return record(offsetSeconds, "inject", "system-append", { role, stateBlock: true, ...extra }, {
    sessionID: SES,
  });
}

function allow(offsetSeconds: number, toolName: string): ObservedRecord {
  return record(offsetSeconds, "gates", "allow", { toolName, toolClass: "read" }, {
    sessionID: SES,
    level: "debug",
  });
}

// ===========================================================================
// [console-parse] the reader survives both on-disk shapes
// ===========================================================================

test("[console-parse] parseConcatenatedJson reads one-object-per-line JSONL and pretty-printed concatenated objects alike, and a torn tail costs the tail alone", () => {
  const compact = '{"a":1}\n{"a":2}\n';
  const flat = parseConcatenatedJson(compact);
  assert.deepEqual(
    flat.values,
    [{ a: 1 }, { a: 2 }],
    "the shape adapter/journal.ts writes — one compact object per line — parses to those objects in file order",
  );
  assert.equal(flat.malformed, 0);

  // The shape the preserved evidence journal and the C++ router's own ledger are
  // on disk in: pretty-printed objects concatenated with no separator. A
  // line-oriented reader sees every line of this as garbage.
  const pretty = '{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n{\n  "a": 2\n}\n';
  const nested = parseConcatenatedJson(pretty);
  assert.deepEqual(
    nested.values,
    [{ a: 1, b: { c: 2 } }, { a: 2 }],
    "a pretty-printed object spanning six lines is ONE record, not six malformed ones",
  );
  assert.equal(nested.malformed, 0);

  // A brace inside a string must not close the object, or every record carrying
  // a shell command or a JSON blob in its data would tear.
  const braces = parseConcatenatedJson('{"cmd":"echo {\\"x\\": 1}"}\n');
  assert.deepEqual(braces.values, [{ cmd: 'echo {"x": 1}' }]);

  // The normal state of a file being appended to right now.
  const torn = parseConcatenatedJson('{"a":1}\n{"a":2}\n{"a":');
  assert.deepEqual(torn.values, [{ a: 1 }, { a: 2 }], "the complete records survive a torn tail");
  assert.equal(torn.malformed, 1, "the torn fragment is counted, never silently dropped");

  assert.deepEqual(parseConcatenatedJson("").values, [], "empty text is zero records, not a throw");
  assert.deepEqual(parseConcatenatedJson("   \n\n").values, [], "whitespace is zero records");
  assert.deepEqual(
    parseConcatenatedJson('[1,2]\n{"a":1}\n').values,
    [{ a: 1 }],
    "a non-object value is not a record",
  );
});

// ===========================================================================
// [console-turns] a turn is an inject, threaded per session
// ===========================================================================

test("[console-turns] each inject/system-append opens a turn for ITS OWN session, the first gate decision inside that session's window is the tool actually called, and a second call in the same turn is counted rather than lost", () => {
  const other = "ses_skeptic";
  const view = deriveLiveConsole({
    records: [
      record(0, "state", "run.created", { runId: "r-test", root: "/repo" }, { sessionID: SES }),
      inject(1, "orchestrator"),
      // A sub-session's inject and its tool calls interleave with the
      // orchestrator's. Threading by arrival order alone would hand the
      // orchestrator's turn the skeptic's bash call.
      record(2, "inject", "system-append", { role: "skeptic" }, { sessionID: other }),
      record(3, "gates", "allow", { toolName: "bash" }, { sessionID: other, level: "debug" }),
      allow(4, "conductor_status"),
      allow(5, "read"),
      inject(6, "orchestrator"),
    ],
  });

  assert.deepEqual(
    view.turns.map((turn) => [turn.role, turn.actual, turn.alsoCalled]),
    [
      ["orchestrator", "conductor_status", ["read"]],
      ["skeptic", "bash", []],
      ["orchestrator", null, []],
    ],
    "turns come out in inject order, each carrying the tool ITS session called",
  );
  assert.equal(view.turns[0].turn, 1, "turns are numbered from 1 in inject order");
  assert.equal(view.turns[0].decision, "allow");
  assert.equal(view.turns[2].decision, "none", "the last turn has not called anything YET — that is not a refusal");
  assert.equal(view.turns[0].offsetMs, 1000, "the offset is measured from the run's first record");
  assert.equal(view.runRoot, "/repo", "the run root comes off state/run.created, the only record that carries it");
});

// ===========================================================================
// [console-recommendation] the one line that would have shown the deadlock
// ===========================================================================

test("[console-recommendation] a turn renders the state block's recommended next tool against the tool actually called and MARKS the mismatch; an inject that records no recommendation claims neither agreement nor mismatch", () => {
  const view = deriveLiveConsole({
    records: [
      inject(1, "orchestrator", { recommended: "conductor_submit_test", recommendedItem: "I1" }),
      allow(2, "read"),
      inject(3, "orchestrator", { recommended: "conductor_submit_test", recommendedItem: "I1" }),
      allow(4, "conductor_submit_test"),
      // Today's writer records no recommendation at all.
      inject(5, "orchestrator"),
      allow(6, "read"),
    ],
  });

  assert.equal(view.turns[0].recommended, "conductor_submit_test");
  assert.equal(view.turns[0].recommendedItem, "I1");
  assert.equal(view.turns[0].mismatch, true, "recommended submit_test, called read — this is the mismatch");
  assert.equal(view.turns[1].mismatch, false, "the model did what was recommended");
  assert.equal(
    view.turns[2].recommended,
    null,
    "an inject with no recorded recommendation yields null, never an invented one",
  );
  assert.equal(
    view.turns[2].mismatch,
    false,
    "an unrecorded recommendation cannot be mismatched — that would be an accusation from no evidence",
  );
  assert.equal(view.mismatchCount, 1);
  assert.equal(
    view.recommendationsRecorded,
    2,
    "the count of turns that carried a recommendation, so the renderer can say when the field is absent everywhere",
  );
});

// ===========================================================================
// [console-stall] seconds since anything ADVANCED
// ===========================================================================

test("[console-stall] the stall clock measures from the last state-CHANGING record — an fsm/transition, or a state/item.updated that carries a state the item was not already in — and generation, tool calls and injects do not reset it", () => {
  const records: ObservedRecord[] = [
    record(0, "state", "run.created", { runId: "r-test" }, { sessionID: SES }),
    inject(1, "orchestrator"),
    record(465.6, "state", "item.updated", { itemId: "I1", state: "PENDING" }),
    record(465.6, "fsm", "transition", { to: "EXECUTING" }, { sessionID: SES }),
    inject(465.7, "orchestrator"),
  ];
  // 36 minutes of continuous generation that advances nothing: exactly the
  // preserved run's shape.
  for (let i = 0; i < 16; i += 1) {
    records.push(allow(600 + i * 120, "read"));
    records.push(inject(600 + i * 120 + 0.2, "orchestrator"));
  }
  const view = deriveLiveConsole({ records });

  assert.equal(view.stall.lastAdvanceEvent, "fsm/transition", "the last thing that MOVED, named");
  assert.equal(view.stall.lastAdvanceDetail, "state EXECUTING", "and where it moved to, labelled by kind");
  assert.equal(view.stall.lastAdvanceOffsetMs, 465600);
  const lastRecordOffset = 600000 + 15 * 120000 + 200;
  assert.equal(
    view.stall.stallMs,
    lastRecordOffset - 465600,
    "the stall is measured to the newest record on disk: 29 minutes of tool calls and injects reset nothing",
  );
  assert.equal(view.stall.sinceLastRecordMs, null, "with no wall clock supplied there is nothing to measure against");

  // A watcher's terminal must keep counting while the journal is silent, so the
  // caller may hand the derivation the wall clock explicitly. It is never read
  // inside: two watchers given the same nowMs must agree exactly.
  const nowMs = T0 + lastRecordOffset + 90_000;
  const live = deriveLiveConsole({ records, nowMs });
  assert.equal(live.stall.stallMs, nowMs - (T0 + 465600), "with a wall clock the stall runs to NOW");
  assert.equal(live.stall.sinceLastRecordMs, 90_000, "and the silence since the last record is its own number");

  // An advance the moment it happens.
  const moved = deriveLiveConsole({
    records: [...records, record(2500, "state", "item.updated", { itemId: "I1", state: "RED" })],
  });
  assert.equal(moved.stall.stallMs, 0, "an item reaching a state it was not in is an advance and resets the clock");
  assert.equal(moved.stall.lastAdvanceEvent, "state/item.updated");
});

test("[console-stall-escalation] the stall level escalates through declared thresholds so a watcher sees 'nothing has advanced' without reading a single timeline row", () => {
  assert.equal(stallLevelOf(0), "ok");
  assert.equal(stallLevelOf(STALL_THRESHOLDS_MS.notice - 1), "ok");
  assert.equal(stallLevelOf(STALL_THRESHOLDS_MS.notice), "notice");
  assert.equal(stallLevelOf(STALL_THRESHOLDS_MS.warn), "warn");
  assert.equal(stallLevelOf(STALL_THRESHOLDS_MS.alarm), "alarm");
  assert.equal(stallLevelOf(36 * 60_000), "alarm", "the preserved run's 36-minute stall is an ALARM");
  assert.ok(
    STALL_THRESHOLDS_MS.notice < STALL_THRESHOLDS_MS.warn &&
      STALL_THRESHOLDS_MS.warn < STALL_THRESHOLDS_MS.alarm,
    "the thresholds are ordered, or the level function is unreadable",
  );
});

// ===========================================================================
// [console-refusals] the records that were invisible
// ===========================================================================

test("[console-refusals] a handler-level refusal (component gates, event refused), a gate deny and a gate crash each render as their own row carrying the reason text, and the turn that suffered one is marked", () => {
  const view = deriveLiveConsole({
    records: [
      inject(1, "orchestrator"),
      record(
        2,
        "gates",
        "refused",
        { toolName: "conductor_submit_test", reason: "item I1 is not in a state that accepts a test", itemId: "I1" },
        { sessionID: SES, level: "warn" },
      ),
      inject(3, "orchestrator"),
      record(
        4,
        "gates",
        "deny",
        { gate: "edit", toolName: "edit", reason: "path outside the item's file scope", editPath: "/repo/tests/c.py" },
        { sessionID: SES, level: "warn" },
      ),
      inject(5, "orchestrator"),
      record(6, "gates", "gate-crash", { toolName: "bash", error: "TypeError: x is not a function" }, { sessionID: SES, level: "error" }),
    ],
  });

  assert.deepEqual(
    view.refusals.map((row) => [row.kind, row.toolName, row.reason]),
    [
      ["refused", "conductor_submit_test", "item I1 is not in a state that accepts a test"],
      ["deny", "edit", "path outside the item's file scope"],
      ["gate-crash", "bash", "TypeError: x is not a function"],
    ],
    "all three refusal shapes, in order, each with the text that says WHY",
  );
  assert.equal(view.refusals[1].gate, "edit", "a deny names the gate that refused");
  assert.equal(view.refusals[1].detail, "/repo/tests/c.py", "and the path it refused");
  assert.deepEqual(
    view.turns.map((turn) => turn.decision),
    ["refused", "deny", "gate-crash"],
    "the turn that suffered the refusal is the one that shows it — a refusal is a turn's outcome, not a footnote",
  );
  assert.equal(view.turns[0].actual, "conductor_submit_test", "a refused call still names the tool that was attempted");
  assert.equal(view.refusalCount, 3);
});

test("[console-refusal-outranks-allow] the production shape of a handler-level refusal is a gates/allow FOLLOWED by a gates/refused for the same call — the gates did allow it — and the turn reports the refusal, not the allow that preceded it", () => {
  const view = deriveLiveConsole({
    records: [
      inject(1, "orchestrator"),
      allow(2, "conductor_inline_claim"),
      record(
        2.1,
        "gates",
        "refused",
        { toolName: "conductor_inline_claim", role: "orchestrator", reason: "item I1 is behavioral and sits at PENDING" },
        { sessionID: SES, level: "warn" },
      ),
    ],
  });
  assert.equal(
    view.turns[0].decision,
    "refused",
    "a journal that reported this turn as an allow would say a call succeeded that the caller was told it could not make",
  );
  assert.equal(view.turns[0].actual, "conductor_inline_claim");
  assert.deepEqual(view.turns[0].alsoCalled, [], "the refusal is the same call, not a second tool");
  assert.equal(view.turns[0].refused, true);
});

// ===========================================================================
// [console-exchanges] what a sub-agent was asked, and what it said back
// ===========================================================================

test("[console-exchanges] a dispatched sub-session pairs with its completion into one exchange carrying role, item, the brief it was given and the response it returned, with truncation stated; the keys being absent degrades to the exchange without them rather than to nothing", () => {
  const sub = "ses_sub";
  const view = deriveLiveConsole({
    records: [
      record(
        1,
        "fanout",
        "subsession.dispatched",
        {
          role: "testWriter",
          itemId: "I1",
          tree: "/repo",
          model: "qwen3.8-27b",
          promptChars: 2863,
          prompt: "Write the failing test for I1 first.",
          truncated: false,
        },
        { sessionID: sub, itemId: "I1" },
      ),
      record(
        271,
        "fanout",
        "subsession.complete",
        { ok: true, attempts: 1, response: "Added tests/test_p001.py; it fails on import.", truncated: true },
        { sessionID: sub, itemId: "I1" },
      ),
      // The preserved journal predates the prompt/response keys entirely.
      record(300, "fanout", "subsession.dispatched", { role: "skeptic", itemId: "", promptChars: 2543 }, { sessionID: "ses_old" }),
      record(400, "fanout", "subsession.complete", { ok: true, attempts: 1 }, { sessionID: "ses_old" }),
    ],
  });

  assert.equal(view.exchanges.length, 2);
  const first = view.exchanges[0];
  assert.equal(first.role, "testWriter");
  assert.equal(first.itemId, "I1");
  assert.equal(first.model, "qwen3.8-27b");
  assert.equal(first.prompt, "Write the failing test for I1 first.");
  assert.equal(first.promptTruncated, false);
  assert.equal(first.response, "Added tests/test_p001.py; it fails on import.");
  assert.equal(first.responseTruncated, true, "a capped response says so, or a reader takes the cut text for the whole answer");
  assert.equal(first.durationMs, 270_000);
  assert.equal(first.outcome, "ok");

  const second = view.exchanges[1];
  assert.equal(second.prompt, null, "an absent prompt key is null — the exchange still renders");
  assert.equal(second.response, null);
  assert.equal(second.promptChars, 2543, "and what IS recorded is still shown");

  const unterminated = deriveLiveConsole({
    records: [record(1, "fanout", "subsession.dispatched", { role: "reviewer", itemId: "I2" }, { sessionID: "ses_x" })],
  });
  assert.equal(unterminated.exchanges[0].outcome, "in flight");
  assert.equal(unterminated.exchanges[0].durationMs, null, "an unfinished sub-session has no duration, not a duration of 0");
});

// ===========================================================================
// [console-compaction] the invisible 472.9 seconds
// ===========================================================================

test("[console-compaction] an inject followed by another inject for the same session with no tool call between it is flagged as the auto-compaction shape once the gap is worth a watcher's attention, and the console totals what the shape cost", () => {
  const view = deriveLiveConsole({
    records: [
      // The two injects a session create emits back to back: the shape, but one
      // second of it. Flagging that as a compaction would cry wolf on every run.
      inject(0.2, "orchestrator"),
      inject(1.2, "orchestrator"),
      allow(78.6, "conductor_classify"),
      inject(1048.8, "orchestrator"),
      inject(1308.5, "orchestrator"),
      allow(1571.7, "conductor_status"),
      inject(1882.3, "orchestrator"),
      inject(2095.5, "orchestrator"),
      allow(2233.2, "conductor_queue_amend"),
    ],
  });

  assert.deepEqual(
    view.turns.map((turn) => turn.noToolCall),
    [true, false, true, false, true, false],
    "the shape itself — a turn that ended with no tool call — is reported for every occurrence",
  );
  assert.deepEqual(
    view.turns.map((turn) => turn.compactionSuspected),
    [false, false, true, false, true, false],
    `only a silent turn longer than ${String(COMPACTION_MIN_GAP_MS)}ms is worth calling a compaction`,
  );
  assert.equal(view.compactionCount, 2);
  assert.equal(
    view.compactionMs,
    Math.round((1308.5 - 1048.8) * 1000) + Math.round((2095.5 - 1882.3) * 1000),
    "the console totals the cost: the preserved run lost 472.9 seconds to exactly this shape",
  );
  assert.equal(view.turns[2].generationMs, Math.round((1308.5 - 1048.8) * 1000));
});

// ===========================================================================
// [console-cost] tokens and latency, joined from the router ledger
// ===========================================================================

test("[console-cost] per-turn tokens and upstream latency are joined from the router ledger by role within the run's group, an absent or unreadable ledger degrades to a timeline with no cost column, and no ledger record is attributed to a turn of a different role", () => {
  const ledger: LedgerEntry[] = [
    // A different cell's traffic, in the same append-only file and ahead of this
    // run's — placed first on purpose: the join walks a role's entries in order,
    // so a group filter that let this through would hand it to turn one.
    { group: "/other/repo", role: "orchestrator", promptTokens: 1, completionTokens: 1, upstreamMs: 1, status: 200 },
    { group: "/repo", role: "orchestrator", promptTokens: 2539, completionTokens: 235, upstreamMs: 73838, status: 200 },
    { group: "/repo", role: "skeptic", promptTokens: 13352, completionTokens: 350, upstreamMs: 24605, status: 200 },
    { group: "/repo", role: "orchestrator", promptTokens: 10415, completionTokens: 309, upstreamMs: 77504, status: 200 },
  ];
  const records = [
    record(0, "state", "run.created", { runId: "r-test", root: "/repo" }, { sessionID: SES }),
    inject(1, "orchestrator"),
    allow(2, "read"),
    record(3, "inject", "system-append", { role: "skeptic" }, { sessionID: "ses_skeptic" }),
    inject(4, "orchestrator"),
  ];

  const view = deriveLiveConsole({ records, ledger });
  assert.deepEqual(
    view.turns.map((turn) => [turn.role, turn.promptTokens, turn.completionTokens, turn.upstreamMs]),
    [
      ["orchestrator", 2539, 235, 73838],
      ["skeptic", 13352, 350, 24605],
      ["orchestrator", 10415, 309, 77504],
    ],
    "each role's turns take that role's ledger records in order; the other cell's group is not this run's cost",
  );
  assert.equal(view.promptTokensTotal, 2539 + 13352 + 10415);
  assert.equal(view.completionTokensTotal, 235 + 350 + 309);

  const bare = deriveLiveConsole({ records });
  assert.deepEqual(
    bare.turns.map((turn) => turn.promptTokens),
    [null, null, null],
    "no ledger is a timeline with no cost column, never a crash and never a zero that reads as free",
  );
  assert.equal(bare.ledgerJoined, false);
  assert.equal(view.ledgerJoined, true);

  // More turns than the ledger has records for that role: the surplus turns
  // simply carry no cost.
  // Fewer entries than turns: the join fills from the run's FIRST request
  // forward and the surplus turns keep null. The ledger carries no timestamp, so
  // order within the group is the only correspondence there is.
  const short = deriveLiveConsole({ records, ledger: [ledger[1]] });
  assert.deepEqual(short.turns.map((turn) => turn.promptTokens), [2539, null, null]);
});

test("[console-ledger-shape] ledgerEntriesOf coerces the router's own record shape and drops nothing it can read, and readLedgerFile answers [] for a path that is not there", () => {
  const entries = ledgerEntriesOf([
    {
      completionTokens: 64,
      group: "g5",
      model: "ornith",
      promptTokens: 17,
      role: null,
      status: 200,
      timings: { predicted_ms: 927.402 },
      upstreamMs: 1041,
    },
    { completionTokens: null, group: "/repo", promptTokens: null, role: "orchestrator", status: 400, timings: null, upstreamMs: 16213 },
  ]);
  assert.deepEqual(entries, [
    { group: "g5", role: null, promptTokens: 17, completionTokens: 64, upstreamMs: 1041, status: 200 },
    { group: "/repo", role: "orchestrator", promptTokens: null, completionTokens: null, upstreamMs: 16213, status: 400 },
  ]);
  assert.deepEqual(
    readLedgerFile(path.join(freshDir(), "no-such-metrics.jsonl")),
    [],
    "the ledger is OPTIONAL: its absence must never take the console down with it",
  );
});

test("[console-waiting] the console names the turn it is waiting on and how long that request has been generating, because a stall clock alone does not say WHO is silent", () => {
  const records = [
    inject(1, "orchestrator"),
    allow(2, "read"),
    record(3, "inject", "system-append", { role: "skeptic" }, { sessionID: "ses_skeptic" }),
    inject(4, "orchestrator"),
  ];
  const view = deriveLiveConsole({ records, nowMs: T0 + 400_000 });
  assert.notEqual(view.waitingOn, null);
  assert.equal(view.waitingOn?.turn, 3, "the newest unsettled turn is the one the run is waiting on");
  assert.equal(view.waitingOn?.role, "orchestrator");
  assert.equal(view.waitingOn?.waitingMs, 400_000 - 4000, "measured from the request that opened it");

  const settled = deriveLiveConsole({
    records: [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator"), allow(4, "read")],
  });
  assert.equal(settled.waitingOn, null, "with nothing in flight there is nobody to wait on");
});

// ===========================================================================
// [console-render] what a watcher actually sees
// ===========================================================================

test("[console-render] the rendered console leads with the stall clock and its level, marks every recommendation mismatch, makes a refusal unmissable with its reason, and names the compaction cost", () => {
  const view = deriveLiveConsole({
    records: [
      record(0, "state", "run.created", { runId: "r-test", root: "/repo" }, { sessionID: SES }),
      record(1, "fsm", "transition", { to: "EXECUTING" }, { sessionID: SES }),
      inject(2, "orchestrator", { recommended: "conductor_submit_test", recommendedItem: "I1" }),
      allow(3, "read"),
      inject(4, "orchestrator"),
      inject(400, "orchestrator"),
      record(401, "gates", "refused", { toolName: "conductor_mark_green", reason: "no red evidence for I1" }, { sessionID: SES, level: "warn" }),
      record(1900, "inject", "system-append", { role: "orchestrator" }, { sessionID: SES }),
    ],
    nowMs: T0 + 1_900_000,
  });
  const text = renderConsole(view, { runId: "r-test", runState: "EXECUTING" });

  assert.match(text, /STALL/, "the stall clock is on the screen");
  assert.match(text, /ALARM/, "31 minutes without an advance escalates visibly");
  assert.match(text, /fsm\/transition/, "and names the last thing that moved");
  assert.match(text, /MISMATCH/, "the recommendation the model ignored is marked");
  assert.match(text, /conductor_submit_test/);
  assert.match(text, /REFUSED/, "a refusal is unmissable");
  assert.match(text, /no red evidence for I1/, "with the reason text, which is the whole value of the row");
  assert.match(text, /COMPACT/, "the compaction shape is named");
  assert.equal(text.includes("\u001b"), false, "no ANSI escapes: a console piped to a file or a bug report stays byte-clean");

  const empty = renderConsole(deriveLiveConsole({ records: [] }), { runId: "r-empty", runState: "unknown" });
  assert.ok(empty.length > 0, "an empty run renders a console saying so rather than throwing");
});

// ===========================================================================
// [console-follow] new records only
// ===========================================================================

test("[console-follow] a follow frame emits only what arrived since the caller's cursor, so a terminal left running all night is an append-only stream and never a re-print of the whole run", () => {
  const before = deriveLiveConsole({ records: [inject(1, "orchestrator"), allow(2, "read")] });
  const firstFrame = nextFollowFrame(before, FOLLOW_START);
  assert.match(firstFrame.text, /read/, "the first frame carries the turns already on disk");
  assert.deepEqual(firstFrame.cursor.turns, [0], "the settled turn is marked printed by INDEX, not by a high-water mark");

  const same = nextFollowFrame(before, firstFrame.cursor);
  assert.equal(same.text, "", "nothing new is nothing printed");
  assert.deepEqual(same.cursor, firstFrame.cursor);

  const after = deriveLiveConsole({
    records: [
      inject(1, "orchestrator"),
      allow(2, "read"),
      inject(3, "orchestrator"),
      record(4, "gates", "refused", { toolName: "edit", reason: "outside scope" }, { sessionID: SES, level: "warn" }),
    ],
  });
  const next = nextFollowFrame(after, firstFrame.cursor);
  assert.match(next.text, /REFUSED/);
  assert.match(next.text, /outside scope/);
  assert.equal(
    next.text.includes("t+0.0s"),
    false,
    "the turn printed in the first frame — the one at the run's own origin — is not printed again",
  );
  assert.deepEqual(next.cursor.turns, [0, 1]);
});

test("[console-follow-settled-only] a turn is streamed only once it has SETTLED — it called something, or the next request for its session proved it called nothing — because a row printed into an append-only stream can never be corrected afterwards", () => {
  // The turn in flight: a request has been built and the model is generating.
  // Its row would read "no-tool-call gen=-", which is a lie about a turn that is
  // about to call a tool.
  const inFlight = deriveLiveConsole({ records: [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator")] });
  assert.deepEqual(
    inFlight.turns.map((turn) => turn.settled),
    [true, false],
    "the newest turn of a session is unsettled until it acts or is superseded",
  );
  const frame = nextFollowFrame(inFlight, FOLLOW_START);
  assert.match(frame.text, /read/, "the settled turn streams");
  assert.deepEqual(frame.cursor.turns, [0], "the unsettled turn is left unprinted, so the next frame reconsiders it");

  // It calls something. The row that streams now is the true one.
  const acted = deriveLiveConsole({
    records: [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator"), allow(9, "conductor_submit_test")],
  });
  const secondFrame = nextFollowFrame(acted, frame.cursor);
  assert.match(secondFrame.text, /conductor_submit_test/);
  assert.equal(
    secondFrame.text.includes("no-tool-call"),
    false,
    "the turn is never streamed as a no-tool-call it was not",
  );
  assert.deepEqual(secondFrame.cursor.turns, [0, 1]);
});

test("[console-follow-settles-on-session-end] a sub-session's last request is settled by the session ENDING, not only by a later request — a session that finishes after one request would otherwise sit unsettled forever and hold every later row behind it", () => {
  const sub = "ses_sub";
  const view = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.dispatched", { role: "mechanical", itemId: "I1" }, { sessionID: sub }),
      record(2, "inject", "system-append", { role: "mechanical" }, { sessionID: sub }),
      record(271, "fanout", "subsession.complete", { ok: true, attempts: 1 }, { sessionID: sub }),
      inject(280, "orchestrator"),
      allow(281, "conductor_status"),
    ],
  });
  assert.equal(view.turns[0].settled, true, "the completion settles the sub-session's open turn");
  assert.equal(view.turns[0].generationMs, 269_000, "and measures its generation to the moment it returned");
  assert.equal(
    view.turns[0].compactionSuspected,
    false,
    "a session ending is not the auto-compaction shape, however long it generated",
  );

  const frame = nextFollowFrame(view, FOLLOW_START);
  assert.match(frame.text, /conductor_status/, "the later orchestrator turn is not held behind a finished sub-session");
  assert.deepEqual(frame.cursor.turns, [0, 1]);
});

test("[console-follow-exchange-halves] a sub-session streams TWICE — the brief when it is dispatched, the answer when it returns — because a watcher must see a job start without waiting minutes for it to finish, and must see what it said when it does", () => {
  const sub = "ses_sub";
  const dispatched = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.dispatched", { role: "testWriter", itemId: "I1", promptChars: 2769, prompt: "Author the failing test for I1." }, { sessionID: sub }),
    ],
  });
  const out = nextFollowFrame(dispatched, FOLLOW_START);
  assert.match(out.text, />> testWriter/, "the dispatch streams the moment the job goes out");
  assert.match(out.text, /Author the failing test for I1\./, "with the brief it was handed");
  assert.equal(out.cursor.dispatches, 1);
  assert.deepEqual(out.cursor.settlements, [], "nothing has come back yet");

  const returned = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.dispatched", { role: "testWriter", itemId: "I1", promptChars: 2769, prompt: "Author the failing test for I1." }, { sessionID: sub }),
      record(271, "fanout", "subsession.complete", { ok: true, attempts: 1, response: "tests/test_p001.py fails on import." }, { sessionID: sub }),
    ],
  });
  const back = nextFollowFrame(returned, out.cursor);
  assert.match(back.text, /<< testWriter/, "the answer streams under its own marker");
  assert.match(back.text, /tests\/test_p001\.py fails on import\./);
  assert.match(back.text, /4m30s/, "and how long the job took");
  assert.equal(
    back.text.includes("Author the failing test"),
    false,
    "the brief already streamed at dispatch is not repeated",
  );
  assert.deepEqual(back.cursor.settlements, [0]);
});

// ===========================================================================
// [console-cli] the command a watcher runs in a second terminal
// ===========================================================================

test("[console-cli] `observe.ts <run-dir> --console` renders the console for a run directory whose journal is pretty-printed concatenated JSON, the shape the preserved evidence is on disk in", () => {
  const dir = freshDir();
  const runDir = path.join(dir, "r-1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ runId: "r-1", state: "EXECUTING", counters: {} }, null, 2));
  const pretty = [
    { seq: 1, ts: T0, level: "info", component: "state", runId: "r-1", event: "run.created", data: { runId: "r-1", root: "/repo" }, sessionID: SES },
    { seq: 2, ts: T0 + 1000, level: "info", component: "inject", runId: "r-1", event: "system-append", data: { role: "orchestrator" }, sessionID: SES },
    { seq: 3, ts: T0 + 2000, level: "warn", component: "gates", runId: "r-1", event: "refused", data: { toolName: "edit", reason: "outside the item file scope" }, sessionID: SES },
  ];
  writeFileSync(path.join(runDir, "journal.jsonl"), pretty.map((r) => JSON.stringify(r, null, 2)).join("\n") + "\n");

  const records = readRunRecords(runDir);
  assert.equal(records.length, 3, "the run's journal reads back whole from the pretty-printed shape");

  const out = runObserve([runDir, "--console"]);
  assert.equal(out.status, 0, `observe --console must exit 0; stderr was: ${out.stderr}`);
  assert.match(out.stdout, /REFUSED/);
  assert.match(out.stdout, /outside the item file scope/);
  rmSync(dir, { recursive: true, force: true });
});

test("[console-cli-follow] `--follow` tails a growing journal: records appended after the watcher started appear without it being restarted, and it never re-prints what it has already shown", async () => {
  const dir = freshDir();
  const runDir = path.join(dir, "r-1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ runId: "r-1", state: "EXECUTING", counters: {} }));
  const journal = path.join(runDir, "journal.jsonl");
  writeFileSync(
    journal,
    [
      JSON.stringify({ seq: 1, ts: T0, level: "info", component: "inject", runId: "r-1", event: "system-append", data: { role: "orchestrator" }, sessionID: SES }),
      // The turn's outcome, without which the turn is still in flight and is
      // correctly withheld from the stream.
      JSON.stringify({ seq: 2, ts: T0 + 1000, level: "debug", component: "gates", runId: "r-1", event: "allow", data: { toolName: "read" }, sessionID: SES }),
      "",
    ].join("\n"),
  );

  const child = spawn(process.execPath, [observePath, runDir, "--follow", "--interval", "80"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });

  const waitFor = async (needle: string, label: string): Promise<void> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (out.includes(needle)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    child.kill("SIGKILL");
    assert.fail(`--follow never showed ${label}; output so far was:\n${out}`);
  };

  await waitFor("orchestrator", "the record already on disk when it started");
  const seen = out;

  appendFileSync(
    journal,
    JSON.stringify({ seq: 3, ts: T0 + 5000, level: "warn", component: "gates", runId: "r-1", event: "refused", data: { toolName: "edit", reason: "appended while following" }, sessionID: SES }) + "\n",
  );
  await waitFor("appended while following", "a record appended AFTER it started");

  const tail = out.slice(seen.length);
  assert.equal(
    (tail.match(/t\+0\.0s/g) ?? []).length,
    0,
    "the turn printed in the first frame is not printed a second time",
  );

  child.kill("SIGTERM");
  await new Promise((resolve) => child.on("exit", resolve));
  rmSync(dir, { recursive: true, force: true });
});

// A child observe.ts run, collected synchronously.
function runObserve(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [observePath, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// The derivation must be a pure function of its input: the same records twice
// must produce the same view, or nothing rendered from it can be compared.
test("[console-deterministic] two derivations over the same records are equal, and the derivation reads no clock of its own", () => {
  const records = [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator")];
  const a: LiveConsole = deriveLiveConsole({ records });
  const b: LiveConsole = deriveLiveConsole({ records });
  assert.deepEqual(a, b);
  assert.equal(a.stall.sinceLastRecordMs, null, "without a supplied clock there is no wall-clock reading anywhere in the view");
});

// ===========================================================================
// [console-honesty] a number the harness cannot know is never printed as 0
// ===========================================================================

test("[console-mismatch-unrecorded] with no turn carrying a recommendation the header prints `mismatches (unrecorded)`, never `0` — a confident zero beside a dead column reads as 'the model did what it was told' on a run where nothing was measured at all", () => {
  const view = deriveLiveConsole({
    records: [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator"), allow(4, "bash")],
  });
  assert.equal(view.recommendationsRecorded, 0, "premise: these injects record no recommendation");

  const text = renderConsole(view, { runId: "r-1", runState: "EXECUTING" });
  assert.match(
    text,
    /mismatches \(unrecorded\)/,
    "the count is unknowable here, and an unknowable number must SAY so where it is read",
  );
  assert.doesNotMatch(text, /mismatches 0/, "and must never claim zero mismatches it did not measure");

  const measured = deriveLiveConsole({
    records: [
      inject(1, "orchestrator", { recommended: "conductor_submit_test", recommendedItem: "I1" }),
      allow(2, "bash"),
    ],
  });
  assert.equal(measured.mismatchCount, 1, "premise: one recorded recommendation, one other tool called");
  assert.match(
    renderConsole(measured, { runId: "r-1", runState: "EXECUTING" }),
    /mismatches 1\b/,
    "and where the column IS live the number is printed plainly — the narrowness of the row above",
  );
});

// ===========================================================================
// [console-stall] an annotation is not an advance
// ===========================================================================

test("[console-stall-annotation] a state/decision.recorded and a state/item.updated that carries no new FSM state are NOTES, not movement: the preserved run's inline-claim pair anchored the clock 8 minutes late and reached ALARM 8 minutes late with it", () => {
  // The preserved run's exact shape: one real transition at t+465.6s, then an
  // inline-claim annotation pair at t+956.1s that moved nothing (items/I1.json
  // held PENDING for the whole run), then 28 more minutes of generation.
  const records: ObservedRecord[] = [
    record(0, "state", "run.created", { runId: "r-test" }, { sessionID: SES }),
    record(465.6, "state", "item.updated", { itemId: "I1", state: "PENDING", origin: "trivial-synthesis" }),
    record(465.6, "fsm", "transition", { to: "EXECUTING" }, { sessionID: SES }),
    record(956.1, "state", "decision.recorded", { decisionId: "D-0001", kind: "derived", itemId: "I1" }),
    record(956.1, "state", "item.updated", { itemId: "I1", inlineClaim: true, decisionId: "D-0001" }),
    inject(2635.8, "orchestrator"),
  ];
  const view = deriveLiveConsole({ records });

  assert.equal(
    view.stall.lastAdvanceEvent,
    "fsm/transition",
    "the last thing that MOVED is the transition, not the decision note that followed it",
  );
  assert.equal(
    view.stall.stallMs,
    Math.round((2635.8 - 465.6) * 1000),
    "36m10s — the figure observation.ts's own module header states as this run's ground truth",
  );
  assert.equal(view.stall.level, "alarm");

  // An item.updated that DOES carry a new state is movement, and resets it.
  const moved = deriveLiveConsole({
    records: [...records, record(2700, "state", "item.updated", { itemId: "I1", state: "RED" })],
  });
  assert.equal(moved.stall.stallMs, 0, "an item reaching a new FSM state is exactly what advancing means");
  assert.equal(moved.stall.lastAdvanceEvent, "state/item.updated");

  // The same state, re-stated. A rewrite of an item that did not move is not a move.
  const restated = deriveLiveConsole({
    records: [...records, record(2700, "state", "item.updated", { itemId: "I1", state: "PENDING" })],
  });
  assert.equal(
    restated.stall.lastAdvanceOffsetMs,
    465600,
    "an item.updated repeating the state the item already held leaves the clock where it was",
  );
});

test("[console-stall-banner-kind] the banner labels WHAT advanced: an FSM state and an item id are different facts and a bare arrow makes them read alike", () => {
  const toState = deriveLiveConsole({
    records: [record(0, "state", "run.created", {}), record(1, "fsm", "transition", { to: "EXECUTING" })],
  });
  assert.match(stallBanner(toState.stall), /-> state EXECUTING/, "a transition names the state it reached");

  const toItem = deriveLiveConsole({
    records: [record(0, "state", "run.created", {}), record(1, "state", "item.updated", { itemId: "I1", state: "RED" })],
  });
  assert.match(stallBanner(toItem.stall), /-> item I1/, "an item advance names the item, and says that is what it is");
  assert.doesNotMatch(
    stallBanner(toItem.stall),
    /-> I1/,
    "an unlabelled arrow reads as 'the run advanced TO I1', which is not a state the run has",
  );
});

// ===========================================================================
// [console-cost] a total the join cannot vouch for is not printed bare
// ===========================================================================

test("[console-cost-partial] a role whose group-tagged ledger entries are FEWER than its settled turns has its whole cost column withheld and the header says PARTIAL — the positional join shifts every later row of that role by one, so the alternative is printing one turn's tokens against another turn's row", () => {
  // The preserved cell's exact shape: adapter/inject.ts groupOf emits no group
  // header for a sub-session with neither a worktree nor an item id, so the
  // router records those requests untagged and the filter drops them.
  const ledger: LedgerEntry[] = [
    { group: "/repo", role: "orchestrator", promptTokens: 2539, completionTokens: 235, upstreamMs: 73838, status: 200 },
    { group: null, role: "skeptic", promptTokens: 12039, completionTokens: 415, upstreamMs: 82700, status: 200 },
    { group: "/repo", role: "skeptic", promptTokens: 13352, completionTokens: 350, upstreamMs: 24605, status: 200 },
  ];
  const records = [
    record(0, "state", "run.created", { runId: "r-test", root: "/repo" }, { sessionID: SES }),
    inject(1, "orchestrator"),
    allow(2, "read"),
    record(3, "inject", "system-append", { role: "skeptic" }, { sessionID: "ses_s1" }),
    record(4, "gates", "allow", { toolName: "read" }, { sessionID: "ses_s1", level: "debug" }),
    record(5, "inject", "system-append", { role: "skeptic" }, { sessionID: "ses_s2" }),
    record(6, "gates", "allow", { toolName: "read" }, { sessionID: "ses_s2", level: "debug" }),
  ];

  const view = deriveLiveConsole({ records, ledger });
  assert.deepEqual(
    view.turns.map((turn) => [turn.role, turn.promptTokens]),
    [
      ["orchestrator", 2539],
      ["skeptic", null],
      ["skeptic", null],
    ],
    "the orchestrator's join is complete and stands; the skeptic's is one entry short of its settled " +
      "turns, and a short join is a SHIFTED join — every row would carry the next request's numbers",
  );
  assert.deepEqual(
    view.ledgerPartialRoles,
    ["skeptic"],
    "and the role whose cost was withheld is named, so the gap is attributable rather than mysterious",
  );
  assert.equal(view.promptTokensTotal, 2539, "the total counts only what was actually attributed");

  const text = renderConsole(view, { runId: "r-1", runState: "EXECUTING" });
  assert.match(
    text,
    /PARTIAL/,
    "and the header says the total is partial, because 308367 printed bare was 7.3% under the truth " +
      "with nothing on screen to say so",
  );
  assert.match(text, /skeptic/, "naming the role whose requests the ledger could not attribute");
});

// ===========================================================================
// [console-follow] one hung session blocks its own lane and nobody else's
// ===========================================================================

test("[console-follow-lanes] a wave with one hung job still streams every other job's turns and settlements — a single global cursor stops on the unsettled turn and goes permanently silent, which is exactly the run --follow exists to watch", () => {
  const view = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.dispatched", { role: "implementer", itemId: "I1", promptChars: 100 }, { sessionID: "ses_A" }),
      record(1.5, "inject", "system-append", { role: "implementer" }, { sessionID: "ses_A" }),
      record(2, "fanout", "subsession.dispatched", { role: "implementer", itemId: "I2", promptChars: 100 }, { sessionID: "ses_B" }),
      record(2.5, "inject", "system-append", { role: "implementer" }, { sessionID: "ses_B" }),
      record(3, "gates", "allow", { toolName: "edit" }, { sessionID: "ses_B", level: "debug" }),
      record(4, "fanout", "subsession.complete", { ok: true, attempts: 1, response: "I2 is green." }, { sessionID: "ses_B" }),
    ],
  });
  assert.deepEqual(
    view.turns.map((turn) => turn.settled),
    [false, true],
    "premise: job A is still generating and job B has acted and finished",
  );

  const frame = nextFollowFrame(view, FOLLOW_START);
  assert.match(frame.text, /-> edit/, "job B's turn streams while job A hangs: the lanes are independent");
  assert.match(frame.text, /<< implementer on I2/, "and so does job B's completion");
  assert.equal(
    frame.text.includes("ses_A") && frame.text.includes("-> "),
    true,
    "job A's DISPATCH still streams — a hung job must be visible, it is the thing being watched",
  );

  // The hung job's own row is still owed, and arrives when it settles.
  const later = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.dispatched", { role: "implementer", itemId: "I1", promptChars: 100 }, { sessionID: "ses_A" }),
      record(1.5, "inject", "system-append", { role: "implementer" }, { sessionID: "ses_A" }),
      record(2, "fanout", "subsession.dispatched", { role: "implementer", itemId: "I2", promptChars: 100 }, { sessionID: "ses_B" }),
      record(2.5, "inject", "system-append", { role: "implementer" }, { sessionID: "ses_B" }),
      record(3, "gates", "allow", { toolName: "edit" }, { sessionID: "ses_B", level: "debug" }),
      record(4, "fanout", "subsession.complete", { ok: true, attempts: 1, response: "I2 is green." }, { sessionID: "ses_B" }),
      record(600, "gates", "allow", { toolName: "conductor_status" }, { sessionID: "ses_A", level: "debug" }),
    ],
  });
  const second = nextFollowFrame(later, frame.cursor);
  assert.match(second.text, /conductor_status/, "job A's row arrives once job A settles, and is not lost");
  assert.equal(
    second.text.includes("-> edit"),
    false,
    "and job B's row, already streamed, is never printed twice",
  );
});

// ===========================================================================
// [console-exchanges] the two sub-session shapes the pairing must not drop
// ===========================================================================

test("[console-exchanges-hold] a HELD write-capable job is its own row: it never became a session, so it is neither a dispatch in flight nor a completion, and a console that omits it shows a frozen wave as an idle one", () => {
  const view = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.hold", { role: "implementer", itemId: "I2", tree: "/wt/I2" }),
      record(2, "fanout", "subsession.dispatched", { role: "implementer", itemId: "I1", promptChars: 10 }, { sessionID: "ses_A" }),
    ],
  });
  const held = view.exchanges.find((exchange) => exchange.outcome === "hold");
  assert.notEqual(held, undefined, "the hold is a row of its own");
  assert.equal(held?.itemId, "I2", "carrying the item whose write-capable job is waiting for a tree");
  assert.equal(held?.role, "implementer");
  assert.equal(held?.durationMs, null, "a held job has no duration: it has not started");
  assert.equal(held?.kind, "hold");
  assert.match(
    exchangeLines(held as NonNullable<typeof held>).join("\n"),
    /!! HELD implementer on I2/,
    "and it renders under its own marker: a hold printed as a `>>` dispatch says a job is in flight " +
      "when the truth is that its tree is frozen and it never started",
  );
});

test("[console-exchanges-unpaired-terminal] a terminal record no dispatch claimed — the create-phase watchdog abort, the session-create failure — is its own row rather than nothing at all", () => {
  const view = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.abort", { role: "testWriter", itemId: "I1", reason: "session create timed out" }, { sessionID: "ses_ghost" }),
    ],
  });
  assert.equal(view.exchanges.length, 1, "the abort is reported");
  assert.equal(view.exchanges[0].outcome, "session create timed out", "with the reason it carries");
  assert.equal(view.exchanges[0].itemId, "I1");
  assert.equal(view.exchanges[0].kind, "unpaired-end");
  assert.match(
    exchangeLines(view.exchanges[0]).join("\n"),
    /ended with no dispatch record: session create timed out/,
    "and it renders as an ENDING, not as a brief going out",
  );
});

test("[console-exchanges-attempts] attempts are COUNTED from the retry records between a dispatch and its ending, so a settlement that omits the field does not report a single clean attempt for three", () => {
  const view = deriveLiveConsole({
    records: [
      record(1, "fanout", "subsession.dispatched", { role: "skeptic", itemId: "I1", promptChars: 10 }, { sessionID: "ses_A" }),
      record(2, "fanout", "subsession.retry", { attempt: 2 }, { sessionID: "ses_A" }),
      record(3, "fanout", "subsession.retry", { attempt: 3 }, { sessionID: "ses_A" }),
      record(4, "fanout", "subsession.abort", { reason: "schema never conformed" }, { sessionID: "ses_A" }),
    ],
  });
  assert.equal(view.exchanges.length, 1);
  assert.equal(
    view.exchanges[0].attempts,
    3,
    "1 + the two retries on disk — the terminal record carries no attempts field, and reading one off it " +
      "reports 1 for a job that was re-prompted twice",
  );
});

// ===========================================================================
// [console-waiting] a duration that can only be zero is not a measurement
// ===========================================================================

test("[console-waiting-unsettled] in a one-shot render the newest turn is normally opened by the newest record, so `generating for 0s` is 0 by construction — the console says the turn is unsettled instead of reporting a measurement it did not make", () => {
  const view = deriveLiveConsole({ records: [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator")] });
  assert.notEqual(view.waitingOn, null);
  assert.equal(
    view.waitingOn?.waitingMs,
    null,
    "with no record after the request that opened it, the wait is UNMEASURED, not zero",
  );
  assert.match(
    waitingLine(view.waitingOn as NonNullable<typeof view.waitingOn>),
    /unsettled/,
    "and the line says so rather than printing a reassuring 0s for a session that never returned",
  );

  const live = deriveLiveConsole({
    records: [inject(1, "orchestrator"), allow(2, "read"), inject(3, "orchestrator")],
    nowMs: T0 + 400_000,
  });
  assert.equal(
    live.waitingOn?.waitingMs,
    400_000 - 3000,
    "with a real wall clock the figure is a measurement again, and is reported",
  );
});

// ===========================================================================
// [console-io] the reader degrades; it never dies, and never reads less than
// the run directory holds without saying so
// ===========================================================================

test("[console-items-unreadable] an items path that is not a directory yields no items rather than an ENOTDIR stack trace — observe.ts promises at its head that an unreadable file costs the answer and not the process, and an observer that dies on a file it caught mid-write is an observer nobody can leave running", () => {
  const dir = freshDir();
  const runDir = path.join(dir, "r-1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ runId: "r-1", state: "EXECUTING", counters: {} }));
  // The shape that crashes: `items` exists and is not a directory.
  writeFileSync(path.join(runDir, "items"), "not a directory");

  assert.deepEqual(readItems(runDir), [], "the unreadable items path costs the item list alone");
  const report = observeRunDir(runDir);
  assert.equal(report.runId, "r-1", "and the rest of the observation still lands");
});

test("[console-rotated-journal] a run whose journal has ROTATED is read from its archives first: reading only the active file renumbers turn #1 onto the middle of the run, re-bases every t+ offset and loses run.created's root, which silently disables the ledger join", () => {
  const dir = freshDir();
  const runDir = path.join(dir, "r-1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ runId: "r-1", state: "EXECUTING", counters: {} }));

  const archived = [
    record(0, "state", "run.created", { runId: "r-1", root: "/repo" }, { sessionID: SES }),
    inject(1, "orchestrator"),
    allow(2, "read"),
  ];
  const active = [inject(3, "orchestrator"), allow(4, "conductor_status")];
  writeFileSync(
    path.join(runDir, "journal.1.jsonl.gz"),
    gzipSync(Buffer.from(archived.map((entry) => JSON.stringify(entry)).join("\n") + "\n")),
  );
  writeFileSync(path.join(runDir, "journal.jsonl"), active.map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const records = readRunRecords(runDir);
  assert.equal(records.length, 5, "the archive is read ahead of the active file, in run order");
  assert.equal(records[0].event, "run.created", "so the run's own origin record is still there");

  const view = deriveLiveConsole({ records });
  assert.equal(view.runRoot, "/repo", "and run.created's root survives, which is what the ledger join keys on");
  assert.equal(view.turns.length, 2);
  assert.equal(view.turns[1].offsetMs, 3000, "t+ offsets stay relative to the run's first record, not the rotation");
});

test("[console-malformed-bytes] a corrupted region reports the BYTES it swallowed, not a count of 1: the resync scan jumps to the next line starting with `{` and gives up entirely when there is none, so `1` can mean one stray character or the whole remainder of the file", () => {
  const garbage = "x".repeat(5000);
  const parsed = parseConcatenatedJson('{"a":1}\n' + garbage);
  assert.deepEqual(parsed.values, [{ a: 1 }], "the readable record still parses");
  assert.equal(parsed.malformed, 1, "one damaged region");
  assert.equal(
    parsed.malformedBytes,
    garbage.length,
    "and its SIZE, because a region with no `\\n{` after it truncates the rest of the file to the same count of 1",
  );

  const view = deriveLiveConsole({ records: [inject(1, "orchestrator")], malformedRecords: 1, malformedBytes: 5000 });
  assert.match(
    renderConsole(view, { runId: "r-1", runState: "EXECUTING" }),
    /5000 bytes/,
    "and the console says how much of the journal it could not read",
  );
});

test("[console-follow-banner-heartbeat] the stall banner repeats on ESCALATION and on its heartbeat, and not once per productive frame: a banner interleaved between nearly every row is not the one line a watcher reads from across the room", async () => {
  const dir = freshDir();
  const runDir = path.join(dir, "r-1");
  mkdirSync(runDir, { recursive: true });
  const line = (entry: ObservedRecord): string => JSON.stringify(entry) + "\n";
  writeFileSync(
    path.join(runDir, "journal.jsonl"),
    line(record(0, "state", "run.created", { runId: "r-1" }, { sessionID: SES })) + line(inject(1, "orchestrator")),
  );

  const out: string[] = [];
  // A FROZEN clock: no heartbeat can fall due and the stall level cannot change,
  // so every banner after the first is one this frame printed for having content.
  const frozen = T0 + STALL_THRESHOLDS_MS.warn + 1000;
  const stop = followRun(runDir, {
    intervalMs: 20,
    ledgerPath: path.join(dir, "no-ledger.jsonl"),
    write: (text) => out.push(text),
    now: () => frozen,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  appendFileSync(path.join(runDir, "journal.jsonl"), line(allow(2, "read")) + line(inject(3, "orchestrator")));
  await new Promise((resolve) => setTimeout(resolve, 120));
  stop();

  const banners = out.join("").split("\n").filter((text) => text.startsWith("STALL ")).length;
  assert.ok(out.join("").includes("-> read"), "premise: the frame with content did stream");
  assert.equal(
    banners,
    1,
    "the level never escalated and the heartbeat never fell due, so exactly ONE banner is owed. Printed:\n" +
      out.join(""),
  );
});
