import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSchedule,
  detectConflicts,
  formatOccurrence,
  freeSlotsForResource,
  nextOccurrence,
  parseEvents,
  summarizeSchedule,
} from "../src/schedule.ts";
import { formatCivilDate } from "../src/civil.ts";
import { civil, event } from "./helpers.ts";

const WINDOW = {
  rangeStart: Date.UTC(2026, 3, 6, 0, 0),
  rangeEnd: Date.UTC(2026, 3, 11, 0, 0),
};

const standup = event({
  id: "standup",
  start: civil(2026, 4, 6, 9, 0),
  durationMinutes: 30,
  resource: "room-atlas",
  recurrence: { frequency: "DAILY", count: 5 },
});

const handover = event({
  id: "handover",
  start: civil(2026, 4, 6, 9, 30),
  durationMinutes: 30,
  resource: "room-atlas",
  recurrence: { frequency: "DAILY", count: 5 },
});

const overlapping = event({
  id: "vendor-call",
  start: civil(2026, 4, 6, 9, 15),
  durationMinutes: 30,
  resource: "room-atlas",
  recurrence: { frequency: "DAILY", count: 5 },
});

test("a schedule lists every occurrence of every event in start order", () => {
  const occurrences = buildSchedule([standup, handover], WINDOW);
  assert.equal(occurrences.length, 10);
  const starts = occurrences.map((occurrence) => occurrence.startUtc);
  const sorted = starts.slice().sort((a, b) => a - b);
  assert.deepEqual(starts, sorted);
  assert.equal(occurrences[0].eventId, "standup");
  assert.equal(occurrences[1].eventId, "handover");
});

test("meetings that start when the previous one ends report no conflicts", () => {
  const conflicts = detectConflicts([standup, handover], WINDOW);
  assert.deepEqual(
    conflicts.map(
      (conflict) =>
        `${formatCivilDate(conflict.first.localStart)} ` +
        `${conflict.first.eventId}/${conflict.second.eventId}`,
    ),
    [],
  );
});

test("a room double-booked every day reports one conflict per day", () => {
  const conflicts = detectConflicts([standup, overlapping], WINDOW);
  assert.equal(conflicts.length, 5);
  for (const conflict of conflicts) {
    assert.equal(conflict.resource, "room-atlas");
    assert.equal(conflict.overlapMinutes, 15);
  }
});

test("the next occurrence is the first one starting strictly after an instant", () => {
  const first = nextOccurrence(standup, Date.UTC(2026, 3, 5, 0, 0));
  assert.ok(first);
  assert.equal(first.startUtc, Date.UTC(2026, 3, 6, 9, 0));

  const later = nextOccurrence(standup, Date.UTC(2026, 3, 6, 9, 0));
  assert.ok(later);
  assert.equal(later.startUtc, Date.UTC(2026, 3, 7, 9, 0));

  assert.equal(nextOccurrence(standup, Date.UTC(2026, 4, 1, 0, 0)), null);
});

test("free slots for a resource sit between that resource's bookings", () => {
  const slots = freeSlotsForResource(
    [standup, handover],
    "room-atlas",
    { start: Date.UTC(2026, 3, 6, 8, 0), end: Date.UTC(2026, 3, 6, 12, 0) },
    30,
  );
  assert.deepEqual(slots, [
    { start: Date.UTC(2026, 3, 6, 8, 0), end: Date.UTC(2026, 3, 6, 9, 0) },
    { start: Date.UTC(2026, 3, 6, 10, 0), end: Date.UTC(2026, 3, 6, 12, 0) },
  ]);
});

test("a summary counts events, occurrences and booked minutes", () => {
  const summary = summarizeSchedule([standup], WINDOW);
  assert.deepEqual(summary, {
    events: 1,
    occurrences: 5,
    conflicts: 0,
    bookedMinutes: 150,
  });
});

test("an occurrence formats as local start, zone, event and resource", () => {
  const [first] = buildSchedule([standup], WINDOW);
  assert.equal(formatOccurrence(first), "2026-04-06T09:00:00 UTC standup [room-atlas]");
});

test("events parse from JSON with local wall-clock starts", () => {
  const events = parseEvents([
    {
      id: "weekly-sync",
      title: "Weekly sync",
      timeZone: "America/New_York",
      start: "2026-04-06T09:00",
      durationMinutes: 45,
      resource: "room-atlas",
      recurrence: { frequency: "WEEKLY", byDay: ["MO"], count: 2 },
    },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].start, civil(2026, 4, 6, 9, 0));

  const occurrences = buildSchedule(events);
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].startUtc, Date.UTC(2026, 3, 6, 13, 0));
});

test("malformed event JSON is rejected", () => {
  assert.throws(() => parseEvents({}), SyntaxError);
  assert.throws(() => parseEvents([{ id: "no-zone", start: "2026-04-06T09:00" }]), SyntaxError);
  assert.throws(() => parseEvents([{ id: "no-start", timeZone: "UTC" }]), SyntaxError);
  assert.throws(
    () => parseEvents([{ id: "bad-zone", timeZone: "Nowhere/Special", start: "2026-04-06T09:00", durationMinutes: 30 }]),
    RangeError,
  );
});
