// Task 1.3 red tests — lives at conductor/tests/stops.test.ts.
// Subject: conductor/core/stops.ts (must not exist when this goes red; the
// failure is Cannot find module '../core/stops.ts' — the missing-subject
// shape, a legal red per §2.6.1).
//
// Spec: plan §2.9 stop-kind taxonomy (closed vocabulary, lines 888-917), §2.3
// run.json + the SINGLE terminality definition (lines 671-711), §3.7
// continuation/futile-re-prompt rule (lines 1456-1476 — shouldTerminate's noop
// is IDENTICAL to it: futileRePrompts reaching 3 is the ONLY wedge detector),
// §2.1 workflow.maxOverridesPerRun (line 578), Task 1.3 interfaces
// (lines 2100-2128).
// Assertions: 1.3-stops, 1.3-terminal.

import { test } from "node:test";
import assert from "node:assert/strict";

import { STOP_KINDS, isTerminal, shouldTerminate } from "../core/stops.ts";

// ---------------------------------------------------------------------------
// Minimal §2.3 fixtures: only the fields these pure functions may consume.
// ---------------------------------------------------------------------------

interface StopFixture {
  kind: string;
  reasonDisplay: string;
  tsMs: number;
}

interface RunFixture {
  state: string;
  stop: StopFixture | null;
}

interface CountersFixture {
  idleRePrompts: number;
  futileRePrompts: number;
  overridesUsed: number;
}

interface ItemsSummaryFixture {
  open: number;
  blocked: number;
  deferred: number;
  surfacedQuestions: number;
}

interface ConfigFixture {
  workflow: { maxOverridesPerRun: number };
}

const executingRun = (): RunFixture => ({ state: "EXECUTING", stop: null });
const config = (): ConfigFixture => ({ workflow: { maxOverridesPerRun: 2 } });
const counters = (over: Partial<CountersFixture> = {}): CountersFixture => ({
  idleRePrompts: 0,
  futileRePrompts: 0,
  overridesUsed: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// §2.9 closed vocabulary — core/stops.ts "exports the vocabulary".
// ---------------------------------------------------------------------------

test("[1.3-stops] STOP_KINDS is exactly the closed §2.9 vocabulary (done, noop, blocked, surfaced, env, interrupt)", () => {
  assert.deepEqual(
    [...STOP_KINDS].sort(),
    ["blocked", "done", "env", "interrupt", "noop", "surfaced"],
    "§2.9's vocabulary is closed: nothing missing, nothing extra",
  );
});

// ---------------------------------------------------------------------------
// shouldTerminate(run, counters, itemsSummary, config) -> {stop, kind?}
//   noop:    futileRePrompts reaching 3 (§3.7's rule, verbatim — the SINGLE
//            wedge detector; 2 is not enough).
//   blocked: no open item remains and blocked items remain (itemsSummary
//            counts only).
//   surfaced: no open and no blocked item remains, surfaced questions pending
//            (deferred items are not actionable work).
//   env:     override budget exhausted (overridesUsed >= maxOverridesPerRun).
//   interrupt: NEVER computed here — recorded directly by halt handling.
// ---------------------------------------------------------------------------

interface TerminateRow {
  name: string;
  counters: CountersFixture;
  summary: ItemsSummaryFixture;
  expected: { stop: boolean; kind?: string };
}

const terminateRows: TerminateRow[] = [
  {
    name: "actionable open items with quiet counters => no stop",
    counters: counters(),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: false },
  },
  {
    name: "noop fires exactly at futileRePrompts === 3 (§3.7: the single wedge detector), even with open items",
    counters: counters({ idleRePrompts: 5, futileRePrompts: 3 }),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: true, kind: "noop" },
  },
  {
    name: "noop does NOT fire at futileRePrompts === 2 (threshold is 3, not 2)",
    counters: counters({ idleRePrompts: 5, futileRePrompts: 2 }),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: false },
  },
  {
    name: "noop still holds past the threshold (futileRePrompts === 4)",
    counters: counters({ idleRePrompts: 7, futileRePrompts: 4 }),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: true, kind: "noop" },
  },
  {
    name: "blocked: every remaining item blocked (open=0, blocked=2), surfaced question pending => blocked",
    counters: counters(),
    summary: { open: 0, blocked: 2, deferred: 0, surfacedQuestions: 1 },
    expected: { stop: true, kind: "blocked" },
  },
  {
    name: "blocked wins over deferred counts: open=0, blocked=1, deferred=3 => blocked (deferred items are settled, not actionable)",
    counters: counters(),
    summary: { open: 0, blocked: 1, deferred: 3, surfacedQuestions: 0 },
    expected: { stop: true, kind: "blocked" },
  },
  {
    name: "surfaced: only human-territory questions remain (open=0, blocked=0, surfacedQuestions=2, deferred=1) => surfaced",
    counters: counters(),
    summary: { open: 0, blocked: 0, deferred: 1, surfacedQuestions: 2 },
    expected: { stop: true, kind: "surfaced" },
  },
  {
    name: "an open item keeps the run alive despite blocked items and surfaced questions => no stop",
    counters: counters(),
    summary: { open: 1, blocked: 2, deferred: 0, surfacedQuestions: 2 },
    expected: { stop: false },
  },
  {
    name: "env on override-budget exhaustion: overridesUsed === maxOverridesPerRun (2) => env, even with open items",
    counters: counters({ overridesUsed: 2 }),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: true, kind: "env" },
  },
  {
    name: "env holds past exhaustion: overridesUsed === 3 over a budget of 2 => env",
    counters: counters({ overridesUsed: 3 }),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: true, kind: "env" },
  },
  {
    name: "overridesUsed under budget (1 of 2) => no env stop",
    counters: counters({ overridesUsed: 1 }),
    summary: { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    expected: { stop: false },
  },
];

for (const row of terminateRows) {
  test(`[1.3-stops] ${row.name}`, () => {
    const res = shouldTerminate(executingRun(), row.counters, row.summary, config());
    assert.equal(res.stop, row.expected.stop, `stop flag for: ${row.name}`);
    // kind is present exactly when stopping (and undefined when not) —
    // {stop:boolean, kind?} per Task 1.3's interface.
    assert.equal(res.kind, row.expected.kind, `stop kind for: ${row.name}`);
  });
}

test("[1.3-stops] interrupt is NEVER computed by shouldTerminate for any input (it is recorded directly by halt handling)", () => {
  const summaries: ItemsSummaryFixture[] = [
    { open: 0, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    { open: 2, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    { open: 0, blocked: 2, deferred: 0, surfacedQuestions: 1 },
    { open: 0, blocked: 0, deferred: 1, surfacedQuestions: 2 },
    { open: 1, blocked: 1, deferred: 1, surfacedQuestions: 1 },
  ];
  let combos = 0;
  for (const futileRePrompts of [0, 2, 3, 5]) {
    for (const overridesUsed of [0, 1, 2, 3]) {
      for (const summary of summaries) {
        const res = shouldTerminate(
          executingRun(),
          counters({ idleRePrompts: futileRePrompts, futileRePrompts, overridesUsed }),
          summary,
          config(),
        );
        combos += 1;
        assert.notEqual(
          res.kind,
          "interrupt",
          `interrupt computed for futile=${futileRePrompts} overrides=${overridesUsed} summary=${JSON.stringify(summary)}`,
        );
      }
    }
  }
  assert.equal(combos, 4 * 4 * summaries.length, "the sweep must cover the full grid");
});

test("[1.3-stops][E-1] a zero override budget at rest (max=0, used=0) does NOT env-stop before any override is used, while open work remains => no stop", () => {
  const res = shouldTerminate(
    executingRun(),
    counters({ overridesUsed: 0 }),
    { open: 5, blocked: 0, deferred: 0, surfacedQuestions: 0 },
    { workflow: { maxOverridesPerRun: 0 } },
  );
  assert.deepEqual(res, { stop: false });
});

test("[1.3-stops][E-1] with a zero override budget and no open work, the run resolves via the OTHER stop rules, never env (max=0, used=0, blocked>0 => blocked)", () => {
  const res = shouldTerminate(
    executingRun(),
    counters({ overridesUsed: 0 }),
    { open: 0, blocked: 1, deferred: 0, surfacedQuestions: 0 },
    { workflow: { maxOverridesPerRun: 0 } },
  );
  assert.deepEqual(res, { stop: true, kind: "blocked" });
});

// ---------------------------------------------------------------------------
// isTerminal(run) — §2.3's SINGLE definition, referenced everywhere:
// terminal iff state ∈ {ANSWERED, REPORTED, TRIVIAL_DONE} OR stop !== null.
// ---------------------------------------------------------------------------

interface TerminalRow {
  name: string;
  run: RunFixture;
  terminal: boolean;
}

const noopStop: StopFixture = { kind: "noop", reasonDisplay: "3 futile idle re-prompts", tsMs: 1754560000000 };
const interruptStop: StopFixture = { kind: "interrupt", reasonDisplay: "halt file present", tsMs: 1754560100000 };

const terminalRows: TerminalRow[] = [
  { name: "EXECUTING with stop:null is NOT terminal", run: { state: "EXECUTING", stop: null }, terminal: false },
  { name: "INTAKE with stop:null is NOT terminal", run: { state: "INTAKE", stop: null }, terminal: false },
  { name: "PLANNED with stop:null is NOT terminal", run: { state: "PLANNED", stop: null }, terminal: false },
  { name: "ANSWERED is terminal", run: { state: "ANSWERED", stop: null }, terminal: true },
  { name: "REPORTED is terminal", run: { state: "REPORTED", stop: null }, terminal: true },
  { name: "TRIVIAL_DONE is terminal", run: { state: "TRIVIAL_DONE", stop: null }, terminal: true },
  {
    name: "EXECUTING with a recorded stop IS terminal (stop !== null, non-terminal state — the case three subsystems used to disagree on)",
    run: { state: "EXECUTING", stop: noopStop },
    terminal: true,
  },
  {
    name: "INTAKE with a recorded interrupt stop IS terminal (any state with a stop is terminal)",
    run: { state: "INTAKE", stop: interruptStop },
    terminal: true,
  },
];

for (const row of terminalRows) {
  test(`[1.3-terminal] ${row.name}`, () => {
    assert.equal(isTerminal(row.run), row.terminal, `isTerminal for: ${row.name}`);
  });
}
