// conductor/tests/observation.test.ts — Task 22B RED tests for the run-state
// snapshot, the strain signals and the breakdown thresholds
// (tools/observation.ts) and the reader over them (tools/observe.ts).
//
// WHY THIS EXISTS. The stated purpose of the campaign is that a stronger model
// watches this harness work at increasing scope and identifies where it breaks.
// The data mostly exists already — the orchestrator's stream is captured per
// cell, every sub-session is journaled with its own id, and the gate, FSM and
// evidence layers are journaled in full. What is missing is assembly.
//
// READ-ONLY BY CONSTRUCTION. The observer must not be able to perturb the run it
// is watching, and the strongest form of that is structural rather than
// disciplinary: this derivation is a PURE function of records that already
// exist, driven from a separate process that only reads the run directory. There
// is no conductor code path an observer can enter, so there is nothing to be
// careful about.
//
// THRESHOLDS ARE DECLARED HERE, BEFORE THE CAMPAIGN. That is the whole point of
// 22B.3: a threshold chosen after seeing the data is a description of the data,
// not a hypothesis about the system.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PER_SLOT_CONTEXT_TOKENS,
  BREAKDOWN_THRESHOLDS,
  crossedThresholds,
  deriveSnapshot,
  deriveStrainSignals,
} from "../tools/observation.ts";
import type { ObservationInput } from "../tools/observation.ts";
import { observeRunDir, renderReport, writeBundle } from "../tools/observe.ts";

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

function record(
  component: string,
  event: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { level: "info", component, event, data, runId: "r1", ...extra };
}

const EMPTY: ObservationInput = {
  runId: "r1",
  run: { state: "EXECUTING", classification: { kind: "work" }, stop: null, counters: { overridesUsed: 0 } },
  items: [],
  openQuestions: [],
  liveVerifyTrees: [],
  journal: [],
  reviewMaxRounds: 3,
  perSlotContextTokens: 8192,
};

// ---------------------------------------------------------------------------
// 22B.1 — the snapshot
// ---------------------------------------------------------------------------

test("[22B.1-snapshot-answers-where-and-why] the snapshot carries run position, item positions and what is blocking", () => {
  const snapshot = deriveSnapshot({
    ...EMPTY,
    items: [
      { id: "I1", state: "GREEN", blocked: null, deferred: null, taint: [], attempts: { overridesUsed: 0 } },
      { id: "I2", state: "RED", blocked: "waiting on a question", deferred: null, taint: [], attempts: { overridesUsed: 1 } },
    ],
    openQuestions: [{ id: "q1", question: "which rounding?", answerPath: ".conductor/answers/q1.md" }],
    liveVerifyTrees: ["/repo"],
  });

  assert.equal(snapshot.runState, "EXECUTING");
  assert.equal(snapshot.classification, "work");
  assert.deepEqual(
    snapshot.items.map((i) => [i.id, i.state]),
    [["I1", "GREEN"], ["I2", "RED"]],
  );
  assert.equal(snapshot.items[1].blocked, "waiting on a question");
  assert.deepEqual(snapshot.openQuestions.map((q) => q.id), ["q1"]);
  assert.deepEqual(snapshot.liveVerifyTrees, ["/repo"], "a frozen tree is why a write-capable job is held");
});

test("[22B.1-snapshot-carries-the-wave] the sub-sessions in flight are visible, which is where most of a run happens", () => {
  const snapshot = deriveSnapshot({
    ...EMPTY,
    journal: [
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "I1" }, { sessionID: "ses_a" }),
      record("fanout", "subsession.dispatched", { role: "skeptic", itemId: "I1" }, { sessionID: "ses_b" }),
      record("fanout", "subsession.complete", { ok: true }, { sessionID: "ses_a" }),
    ],
  });
  assert.deepEqual(
    snapshot.inFlight.map((s) => s.sessionID),
    ["ses_b"],
    "a completed sub-session is not in flight; an observer watching the wave needs the difference",
  );
  assert.equal(snapshot.inFlight[0].role, "skeptic");
});

test("[22B.1-snapshot-tail] the last N journal events are carried, newest last, so an observer sees momentum", () => {
  const journal = Array.from({ length: 40 }, (_, i) => record("fsm", "transition", { n: i }));
  const snapshot = deriveSnapshot({ ...EMPTY, journal, tailEvents: 5 });
  assert.equal(snapshot.recentEvents.length, 5);
  assert.equal((snapshot.recentEvents[4].data as { n: number }).n, 39, "newest last");
});

// ---------------------------------------------------------------------------
// 22B.2 — the strain signals
// ---------------------------------------------------------------------------

test("[22B.2-deny-rate-by-gate] denies are counted per gate, because which gate is refusing is the finding", () => {
  const signals = deriveStrainSignals({
    ...EMPTY,
    journal: [
      record("gates", "deny", { gate: "edit" }),
      record("gates", "deny", { gate: "edit" }),
      record("gates", "deny", { gate: "git" }),
      record("gates", "allow", { toolName: "read" }),
    ],
  });
  assert.deepEqual(signals.deniesByGate, { edit: 2, git: 1 });
  assert.equal(signals.allowedCalls, 1);
  assert.ok(signals.denyRate > 0.7 && signals.denyRate < 0.8, `deny rate was ${String(signals.denyRate)}`);
});

test("[22B.2-overrides-minted-and-spent] both meters are reported, because a minted grant that is never spent is a different story", () => {
  const signals = deriveStrainSignals({
    ...EMPTY,
    journal: [
      record("gates", "override-granted", { gate: "edit", itemId: "I1" }),
      record("gates", "override-granted", { gate: "edit", itemId: "I2" }),
      record("gates", "allow", { via: "override-grant", gate: "edit", itemId: "I1" }),
    ],
  });
  assert.equal(signals.overridesMinted, 2);
  assert.equal(signals.overridesSpent, 1);
  assert.equal(signals.allowedCalls, 0, "a grant spend is not an ordinary allowed call and must not inflate the rate");
});

test("[22B.2-fix-rounds-against-the-cap] review rounds per item are reported against reviewMaxRounds", () => {
  // A ROUND is one wave, however many reviewers config sends into it. Counting the
  // reviewers instead measures `workflow.itemReviewers`, which is a config value and
  // not a strain signal: with the bench's itemReviewers of 6 the first round of the
  // first item would cross a threshold of 3 in every cell of every campaign.
  const signals = deriveStrainSignals({
    ...EMPTY,
    reviewMaxRounds: 3,
    journal: [
      record("fanout", "wave", { jobs: 3, roles: ["reviewer", "reviewer", "reviewer"], items: ["I1"], reviewItems: ["I1"] }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "I1" }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "I1" }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "I1" }),
      record("fanout", "wave", { jobs: 1, roles: ["reviewer"], items: ["I2"], reviewItems: ["I2"] }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "I2" }),
    ],
  });
  assert.equal(signals.reviewRoundsByItem["I1"], 1, "three reviewers in one wave are ONE round");
  assert.equal(signals.reviewRoundsByItem["I2"], 1);
});

test("[smoke-F18] a run-level plan-review wave contributes no per-item review round, and rounds cross the threshold only when an item is sent back", () => {
  // Plan review is a run-level stage: its jobs carry no itemId, so it belongs to no
  // item's fix loop. A signal that buckets those reviewers under a placeholder item
  // reports non-convergence for a run whose first item has not been reviewed once.
  const planReviewOnly = deriveStrainSignals({
    ...EMPTY,
    reviewMaxRounds: 3,
    journal: [
      record("fanout", "wave", {
        jobs: 4,
        roles: ["reviewer", "reviewer", "reviewer", "reviewer"],
        items: [""],
        reviewItems: [],
      }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "" }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "" }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "" }),
      record("fanout", "subsession.dispatched", { role: "reviewer", itemId: "" }),
    ],
  });
  assert.deepEqual(planReviewOnly.reviewRoundsByItem, {}, "a plan review is not an item's review round");
  assert.ok(
    !crossedThresholds(planReviewOnly).includes("reviewRoundsPerItem"),
    "and it crosses nothing: " + JSON.stringify(crossedThresholds(planReviewOnly)),
  );

  const sentBackThrice = deriveStrainSignals({
    ...EMPTY,
    reviewMaxRounds: 3,
    journal: [
      record("fanout", "wave", { jobs: 6, roles: ["reviewer"], items: ["I1"], reviewItems: ["I1"] }),
      record("fanout", "wave", { jobs: 6, roles: ["reviewer"], items: ["I1"], reviewItems: ["I1"] }),
      record("fanout", "wave", { jobs: 6, roles: ["reviewer"], items: ["I1"], reviewItems: ["I1"] }),
    ],
  });
  assert.equal(sentBackThrice.reviewRoundsByItem["I1"], 3, "three trips through review is three rounds");
  assert.ok(
    crossedThresholds(sentBackThrice).includes("reviewRoundsPerItem"),
    "and THAT is the non-convergence the threshold exists to catch",
  );
});

test("[22B.2-stuck-items] items reaching blocked or stuck are named, not merely counted", () => {
  const signals = deriveStrainSignals({
    ...EMPTY,
    items: [
      { id: "I1", state: "RED", blocked: "no test could be written", deferred: null, taint: [], attempts: { overridesUsed: 0 } },
      { id: "I2", state: "GREEN", blocked: null, deferred: null, taint: [], attempts: { overridesUsed: 0 } },
    ],
  });
  assert.deepEqual(signals.blockedItems, ["I1"], "a count tells you something is wrong; the name tells you where");
});

test("[22B.2-retries-and-disengage] receipt retries, aborts, idles and disengages are each their own number", () => {
  const signals = deriveStrainSignals({
    ...EMPTY,
    journal: [
      record("fanout", "subsession.retry", {}),
      record("fanout", "subsession.retry", {}),
      record("fanout", "subsession.abort", {}),
      record("continuation", "idle", {}),
      record("continuation", "disengage", {}),
      record("continuation", "reprompt", {}),
      record("evidence", "verify", {}),
      record("evidence", "verify", {}),
    ],
  });
  assert.equal(signals.receiptRetries, 2);
  assert.equal(signals.subsessionAborts, 1);
  assert.equal(signals.idleContinuations, 1);
  assert.equal(signals.disengages, 1);
  assert.equal(signals.reprompts, 1);
  assert.equal(signals.verifyRuns, 2);
});

test("[22B.2-brief-size-against-the-window] the largest brief is reported against the EFFECTIVE per-slot window", () => {
  // A deliberately small 8192-token window for the fixture (not the served default), so the
  // effective window is 8,192 tokens and not the 65,536 the model preset
  // declares. A brief that displaces the source it is about degrades quality
  // while looking like added capability.
  const signals = deriveStrainSignals({
    ...EMPTY,
    perSlotContextTokens: 8192,
    journal: [
      record("fanout", "subsession.dispatched", { role: "implementer", itemId: "I1", promptChars: 4000 }),
      record("fanout", "subsession.dispatched", { role: "implementer", itemId: "I2", promptChars: 24000 }),
    ],
  });
  assert.equal(signals.largestBriefChars, 24000);
  assert.ok(
    signals.largestBriefWindowFraction > 0.7,
    `24k chars is roughly 6k tokens against an 8,192-token window: ${String(signals.largestBriefWindowFraction)}`,
  );
});

test("[22B.2-empty-run] a run with no journal produces zeros, not NaN or a crash", () => {
  const signals = deriveStrainSignals(EMPTY);
  assert.equal(signals.denyRate, 0, "0/0 is 0 here, and an observer must not be handed NaN");
  assert.equal(signals.overridesMinted, 0);
  assert.deepEqual(signals.blockedItems, []);
});

// ---------------------------------------------------------------------------
// 22B.3 — thresholds, declared before the campaign
// ---------------------------------------------------------------------------

test("[22B.3-thresholds-are-declared] every strain signal with a threshold has one, and each is a number", () => {
  assert.ok(Object.keys(BREAKDOWN_THRESHOLDS).length >= 6, "a threshold set this small is not a hypothesis");
  for (const [name, value] of Object.entries(BREAKDOWN_THRESHOLDS)) {
    assert.equal(typeof value, "number", `${name} must be a number`);
    assert.ok(Number.isFinite(value), `${name} must be finite`);
  }
});

test("[22B.3-crossing-is-a-finding-not-a-stop] crossed thresholds are reported by name", () => {
  const signals = deriveStrainSignals({
    ...EMPTY,
    journal: Array.from({ length: 20 }, () => record("gates", "deny", { gate: "edit" })),
  });
  const crossed = crossedThresholds(signals);
  assert.ok(crossed.includes("denyRate"), `a 100% deny rate must cross: ${JSON.stringify(crossed)}`);
  // The contract is that this REPORTS. Nothing here stops a run, and the type
  // gives a caller no way to make it do so.
  assert.ok(Array.isArray(crossed));
});

test("[22B.3-quiet-run-crosses-nothing] a healthy run reports an empty crossing list", () => {
  const signals = deriveStrainSignals({
    ...EMPTY,
    journal: [record("gates", "allow", { toolName: "read" }), record("evidence", "green", {})],
  });
  assert.deepEqual(crossedThresholds(signals), []);
});

test("[22B.2-waves] waves are counted, and a wave of one is counted separately", () => {
  // A wave carrying a single job is the scheduler finding nothing it could run
  // alongside. Against a task whose items have disjoint scopes that is the
  // conservative scopesIntersect over-approximating (HONEST-LIMITS limit 6), and
  // it is the difference between "conductor is slow" and "conductor serialized
  // work that could have run in parallel".
  const signals = deriveStrainSignals({
    ...EMPTY,
    journal: [
      record("fanout", "wave", { jobs: 6 }),
      record("fanout", "wave", { jobs: 1 }),
      record("fanout", "wave", { jobs: 1 }),
    ],
  });
  assert.equal(signals.waves, 3);
  assert.equal(signals.serializedWaves, 2);
});

// ---------------------------------------------------------------------------
// 22B.4 — the reader and the bundle, against a real run directory on disk.
//
// These rows exist because the derivation being correct is not the same as the
// reader working: a reader that dies on a torn journal line, or that needs a file
// a real run does not always have, is a reader nobody can leave running against a
// live campaign.
// ---------------------------------------------------------------------------

test("[22B.4-reads-a-run-dir] the reader derives a report from files alone, and writes nothing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-observe-"));
  mkdirSync(path.join(dir, "items"), { recursive: true });
  writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({
      runId: "r-obs",
      state: "EXECUTING",
      classification: { kind: "work" },
      stop: null,
      counters: { idleRePrompts: 0, futileRePrompts: 0, overridesUsed: 1 },
    }),
  );
  writeFileSync(
    path.join(dir, "items", "I1.json"),
    JSON.stringify({ id: "I1", state: "RED", blocked: "needs a decision", taint: [], attempts: { overridesUsed: 0 } }),
  );
  writeFileSync(
    path.join(dir, "journal.jsonl"),
    [
      JSON.stringify({ component: "gates", event: "deny", data: { gate: "edit" } }),
      JSON.stringify({ component: "fanout", event: "wave", data: { jobs: 1 } }),
      JSON.stringify({ component: "fanout", event: "subsession.dispatched", sessionID: "ses_x", data: { role: "reviewer", itemId: "I1" } }),
      // A torn tail line: the normal state of a file being appended to.
      '{"component":"gates","event":"de',
    ].join("\n"),
  );

  const before = readdirSync(dir).sort();
  const report = observeRunDir(dir);

  assert.equal(report.runId, "r-obs");
  assert.equal(report.snapshot.runState, "EXECUTING");
  assert.deepEqual(report.snapshot.items.map((i) => i.id), ["I1"]);
  assert.equal(report.snapshot.items[0].blocked, "needs a decision");
  assert.deepEqual(report.snapshot.inFlight.map((s) => s.role), ["reviewer"]);
  assert.equal(report.signals.denies, 1, "the torn line is skipped, the whole one is not");
  assert.equal(report.signals.waves, 1);

  assert.deepEqual(readdirSync(dir).sort(), before, "the reader must not write into the run it observes");
  rmSync(dir, { recursive: true, force: true });
});

test("[22B.4-survives-a-thin-run] a run directory with only run.json yields a report, not a throw", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-observe-thin-"));
  writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({ runId: "r-thin", state: "INTAKE", classification: null, stop: null, counters: { overridesUsed: 0 } }),
  );
  const report = observeRunDir(dir);
  assert.equal(report.snapshot.runState, "INTAKE");
  assert.deepEqual(report.snapshot.items, []);
  assert.deepEqual(report.crossed, []);
  rmSync(dir, { recursive: true, force: true });
});

test("[22B.4-render-leads-with-position] the human form answers 'where is this run and why' before anything else", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-observe-render-"));
  mkdirSync(path.join(dir, "items"), { recursive: true });
  writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({ runId: "r-r", state: "EXECUTING", classification: { kind: "work" }, stop: null, counters: { overridesUsed: 0 } }),
  );
  writeFileSync(
    path.join(dir, "items", "I1.json"),
    JSON.stringify({ id: "I1", state: "RED", blocked: "waiting on q1", taint: [], attempts: { overridesUsed: 0 } }),
  );
  const text = renderReport(observeRunDir(dir));
  const firstLine = text.split("\n")[0];
  assert.match(firstLine, /^run r-r — EXECUTING/, "position first");
  assert.match(text, /waiting on q1/, "and what is blocking, without needing the JSON");
  assert.match(text, /no gate decisions are recorded at all/, "a run with no gate records says why that might be");
  rmSync(dir, { recursive: true, force: true });
});

test("[22B.4-bundle-is-self-contained] the bundle carries the derivation and the records it came from", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-observe-bundle-"));
  const out = mkdtempSync(path.join(tmpdir(), "conductor-bundle-out-"));
  mkdirSync(path.join(dir, "items"), { recursive: true });
  writeFileSync(
    path.join(dir, "run.json"),
    JSON.stringify({ runId: "r-b", state: "REPORTED", classification: { kind: "work" }, stop: null, counters: { overridesUsed: 0 } }),
  );
  writeFileSync(path.join(dir, "items", "I1.json"), JSON.stringify({ id: "I1", state: "PUBLISHED", taint: [], attempts: { overridesUsed: 0 } }));
  writeFileSync(path.join(dir, "journal.jsonl"), JSON.stringify({ component: "evidence", event: "green" }) + "\n");

  const written = writeBundle(dir, out, observeRunDir(dir));
  assert.ok(written.includes("run.json"), "the source records travel with the derivation");
  assert.ok(written.includes("journal.jsonl"));
  assert.ok(written.includes(path.join("items", "I1.json")));
  assert.ok(written.includes("observation.json"), "and the derivation itself");
  assert.ok(written.includes("observation.txt"), "in both the machine and the human form");
  assert.ok(
    !written.includes("questions.jsonl"),
    "a file the run never produced is absent rather than invented empty — an empty ledger and no " +
      "ledger say different things",
  );

  const round = JSON.parse(readFileSync(path.join(out, "observation.json"), "utf8")) as { runId: string };
  assert.equal(round.runId, "r-b");
  rmSync(dir, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

test("observation: the observer's default per-slot window is the one scripts/conductor_wiring.py serves", () => {
  // Two copies of one number in two languages; this is the only thing that keeps
  // them equal. The smoke measured an 8192-token slot refusing the orchestrator's
  // 11,441-token first request, so a stale default here would report brief
  // fractions against a window nobody serves.
  const py = readFileSync(new URL("../../scripts/conductor_wiring.py", import.meta.url), "utf8");
  const match = /^PER_SLOT_CONTEXT_TOKENS = (\d+)$/m.exec(py);
  assert.ok(match, "conductor_wiring.py must declare PER_SLOT_CONTEXT_TOKENS on its own line");
  assert.equal(DEFAULT_PER_SLOT_CONTEXT_TOKENS, Number(match![1]));
  assert.ok(DEFAULT_PER_SLOT_CONTEXT_TOKENS > 11441, "the default window must hold the measured first request");
});
