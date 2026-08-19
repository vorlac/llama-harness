// conductor/tests/gate-record-completeness.test.ts — GAP-031, the record-layer
// completeness, currency, and obligation checks.
//
// The build's own record is a governed artifact, and the review found it rots
// silently: the M1-M9 gate ledger "silently ends at 11.8" with eleven COMMITTED
// tasks recordless (ISSUE-083); recorded obligations "measurably fail to land, 2
// lost : 1 landed" (MACRO-017); four record surfaces "describe four different
// presents" (ISSUE-082). None of it FAILED anything, because nothing read the
// record as a checkable object. This does.
//
// Three properties over docs/build/STATE.json and docs/build/GATES.json:
//
//   COMPLETENESS — every task STATE.json calls COMMITTED has a GATES.json
//     taskGates record, unless it is on KNOWN_MISSING_GATE_RECORD with the note
//     that its record is owed. A committed task that is neither recorded nor
//     registered is the ISSUE-083 silent-gap class and is RED.
//
//   CURRENCY — every taskGates record carries an ISO-8601 `at` stamp and all nine
//     M1-M9 legs; every phaseGates entry carries `at` and a recorded disposition.
//     A record without a freshness stamp or with a leg missing is not a record.
//
//   OBLIGATIONS — every GATES.json `rejections` entry carries a `resolution`: a
//     recorded correction that promised a follow-up must say what became of it, so
//     the MACRO-017 "recorded debt that never lands" cannot hide in the ledger.
//
// The register is the tracked-obligation shape (see tests/unreachable-exports.ts):
// STATE.json and GATES.json are under docs/ and off-limits to this layer, so the
// twelve currently-recordless committed tasks are pinned here and REPORTED to the
// orchestrator to backfill; [not-stale] fails the day one gains a record, so the
// register empties itself and can never grandfather a NEW silent gap. What this
// CANNOT check from here is the cross-surface currency stamp GAP-031(b) wants
// shared across HANDOFF/NOW/STATE/JOURNAL — those are docs/ files this layer may
// not read as a governed set; that stamp is REPORTED, not enforced here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..", "..");
const buildDir = path.join(repoRoot, "docs", "build");

interface StateJson {
  tasks: Record<string, { status?: string }>;
}
interface GatesJson {
  taskGates: Record<string, Record<string, unknown>>;
  phaseGates: Record<string, Record<string, unknown>>;
  rejections: Array<Record<string, unknown>>;
}

function loadState(): StateJson {
  return JSON.parse(readFileSync(path.join(buildDir, "STATE.json"), "utf8")) as StateJson;
}
function loadGates(): GatesJson {
  return JSON.parse(readFileSync(path.join(buildDir, "GATES.json"), "utf8")) as GatesJson;
}

function committedTasks(state: StateJson): string[] {
  return Object.entries(state.tasks)
    .filter(([, v]) => v.status === "COMMITTED")
    .map(([k]) => k)
    .sort();
}

// Committed tasks with no taskGates record at HEAD. Each is a record the
// orchestrator owes; the ledger stopped emitting M1-M9 rows after task 11.8
// (ISSUE-083) even as phases 12-15 committed. Pinned exactly, sorted.
const KNOWN_MISSING_GATE_RECORD: ReadonlySet<string> = new Set([
  "0.1",
  "12.1",
  "12.1-G5",
  "12.2",
  "13.1",
  "13.1-composition-root",
  "13.1-composition-root-CR2",
  "14.1",
  "15.0",
  "15.1",
  "15.2",
  "5.4a",
]);

const M_LEGS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;
// The keys any one of which records a phase gate's outcome. Different phases use
// different shapes (early phases `verdict`; phase 10 `finalVerdict`; phase 11
// `status`; m7CrossCutting `classification`), but every one must record SOMETHING.
const PHASE_DISPOSITION = ["verdict", "finalVerdict", "classification", "status", "stage2Verdict"] as const;

test("[gap031-committed-has-gate-record] every COMMITTED task has a taskGates record or is on the KNOWN_MISSING register — a committed task with no gate record and no registered obligation is the ISSUE-083 silent-gap class", () => {
  const state = loadState();
  const gates = loadGates();
  const committed = committedTasks(state);
  assert.ok(committed.length >= 40, `STATE.json lists only ${committed.length} committed tasks (>= 40 exist) — the read is wrong`);

  const recorded = new Set(Object.keys(gates.taskGates));
  const offenders = committed.filter((id) => !recorded.has(id) && !KNOWN_MISSING_GATE_RECORD.has(id));
  assert.deepEqual(
    offenders,
    [],
    "this COMMITTED task has no taskGates record and is not on KNOWN_MISSING_GATE_RECORD. A committed task's M1-M9 gate " +
      "must be recorded; if the record is genuinely owed, add the id to the register and REPORT the GATES.json backfill. " +
      "A committed task the ledger never mentions is the silent gap this check exists to make loud.",
  );
});

test("[gap031-register-not-stale] every KNOWN_MISSING entry is still a committed task that still lacks a gate record — a task that gained a record or is no longer committed must leave the register so it cannot rot into a standing excuse", () => {
  const state = loadState();
  const gates = loadGates();
  const committed = new Set(committedTasks(state));
  const recorded = new Set(Object.keys(gates.taskGates));

  const nowRecorded = [...KNOWN_MISSING_GATE_RECORD].filter((id) => recorded.has(id));
  assert.deepEqual(
    nowRecorded,
    [],
    "a KNOWN_MISSING task now has a taskGates record — remove it from the register; its obligation is discharged.",
  );

  const notCommitted = [...KNOWN_MISSING_GATE_RECORD].filter((id) => !committed.has(id));
  assert.deepEqual(
    notCommitted,
    [],
    "a KNOWN_MISSING task is no longer COMMITTED in STATE.json — a register of owed gate records must only name committed tasks.",
  );
});

test("[gap031-gate-record-currency] every taskGates record carries an ISO-8601 `at` stamp and all nine M1-M9 legs — a record without a freshness stamp or with a leg missing is incomplete and cannot be read as evidence", () => {
  const gates = loadGates();
  const entries = Object.entries(gates.taskGates);
  assert.ok(entries.length >= 40, `only ${entries.length} taskGates records (>= 40 exist) — the read is wrong`);

  const bad: string[] = [];
  for (const [id, rec] of entries) {
    // 'acceptance-round-1' is the acceptance ledger, not an M1-M9 task gate; it is
    // required to carry a stamp but not the nine legs.
    const at = rec["at"];
    if (typeof at !== "string" || !ISO.test(at)) {
      bad.push(`${id}: missing/invalid ISO 'at' stamp`);
      continue;
    }
    if (id === "acceptance-round-1") continue;
    const absent = M_LEGS.filter((m) => !(m in rec));
    if (absent.length > 0) bad.push(`${id}: missing legs ${absent.join(",")}`);
  }
  assert.deepEqual(bad, [], "a taskGates record is missing its currency stamp or an M-leg — every recorded gate must be complete.");
});

test("[gap031-phase-gate-currency] every phaseGates entry carries an ISO-8601 `at` stamp and a recorded disposition — a phase gate with no stamp or no verdict is a dangling record", () => {
  const gates = loadGates();
  const entries = Object.entries(gates.phaseGates);
  assert.ok(entries.length >= 10, `only ${entries.length} phaseGates entries (>= 10 exist) — the read is wrong`);

  const bad: string[] = [];
  for (const [id, rec] of entries) {
    const at = rec["at"];
    if (typeof at !== "string" || !ISO.test(at)) bad.push(`${id}: missing/invalid ISO 'at' stamp`);
    if (!PHASE_DISPOSITION.some((k) => k in rec)) bad.push(`${id}: no recorded disposition (${PHASE_DISPOSITION.join("/")})`);
  }
  assert.deepEqual(bad, [], "a phaseGates entry is missing its currency stamp or its disposition — every phase gate must record when it ran and what it decided.");
});

test("[gap031-obligations-resolved] every GATES.json rejection carries a resolution — a recorded correction that promised a follow-up must record what became of it, so debt cannot be logged and then lost (MACRO-017)", () => {
  const gates = loadGates();
  assert.ok(gates.rejections.length >= 5, `only ${gates.rejections.length} rejections recorded (>= 5 exist) — the read is wrong`);

  const dangling: string[] = [];
  for (let i = 0; i < gates.rejections.length; i += 1) {
    const r = gates.rejections[i];
    const resolution = r["resolution"];
    if (typeof resolution !== "string" || resolution.trim().length === 0) {
      dangling.push(`rejections[${i}] (${String(r["what"] ?? "?").slice(0, 40)})`);
    }
  }
  assert.deepEqual(dangling, [], "a recorded rejection has no `resolution` — an obligation logged without an outcome is exactly the debt-that-never-lands class.");
});

test("[gap031-discrimination] the checks CAN fail: a synthetic committed-but-unrecorded task, a stampless gate record, and a resolution-less rejection are each reported — a checker that cannot demonstrate a failure is decorative (ISSUE-128)", () => {
  // COMPLETENESS: a committed task absent from both records and the register.
  const committed = ["A", "B", "C"];
  const recorded = new Set(["A"]);
  const register = new Set(["B"]);
  const offenders = committed.filter((id) => !recorded.has(id) && !register.has(id));
  assert.deepEqual(offenders, ["C"], "a committed task neither recorded nor registered must be reported");

  // CURRENCY: a record without an ISO stamp is bad; one with is fine.
  assert.ok(!ISO.test("2026/08/19"), "a non-ISO stamp must fail the currency regex");
  assert.ok(ISO.test("2026-08-19T00:00:00Z"), "an ISO stamp must pass");

  // A record missing a leg is caught.
  const rec: Record<string, unknown> = { at: "2026-08-19T00:00:00Z", M1: "PASS" };
  const absent = M_LEGS.filter((m) => !(m in rec));
  assert.ok(absent.includes("M9"), "a record missing M9 must be flagged");

  // OBLIGATIONS: a rejection with an empty resolution is dangling.
  const dangling = [{ what: "x", resolution: "" }].filter((r) => r.resolution.trim().length === 0);
  assert.equal(dangling.length, 1, "a resolution-less rejection must be reported");

  // And the real register still describes the real gap: every KNOWN_MISSING id is
  // genuinely committed-and-unrecorded at HEAD, or [not-stale] would already be red.
  const gates = loadGates();
  const realRecorded = new Set(Object.keys(gates.taskGates));
  const stillMissing = [...KNOWN_MISSING_GATE_RECORD].every((id) => !realRecorded.has(id));
  assert.ok(stillMissing, "every registered task is genuinely unrecorded against the real GATES.json");
});
