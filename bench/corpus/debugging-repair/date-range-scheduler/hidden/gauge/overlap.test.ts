import test from "node:test";
import assert from "node:assert/strict";

import {
  busyMillis,
  contains,
  findConflicts,
  freeSlots,
  intervalsOverlap,
  mergeIntervals,
  overlapMillis,
} from "../src/overlap.ts";
import { MILLIS_PER_MINUTE } from "../src/civil.ts";
import { at, occurrence } from "./helpers.ts";

test("intervals that share interior time overlap", () => {
  assert.equal(
    intervalsOverlap({ start: at(10), end: at(11) }, { start: at(10, 30), end: at(11, 30) }),
    true,
  );
  assert.equal(
    intervalsOverlap({ start: at(10), end: at(12) }, { start: at(10, 15), end: at(10, 45) }),
    true,
  );
  assert.equal(
    intervalsOverlap({ start: at(10), end: at(11) }, { start: at(12), end: at(13) }),
    false,
  );
});

test("an interval that ends when the next begins does not overlap it", () => {
  assert.equal(
    intervalsOverlap({ start: at(10), end: at(11) }, { start: at(11), end: at(12) }),
    false,
  );
  assert.equal(
    intervalsOverlap({ start: at(11), end: at(12) }, { start: at(10), end: at(11) }),
    false,
  );
});

test("shared time is measured in milliseconds and is zero when disjoint", () => {
  assert.equal(
    overlapMillis({ start: at(10), end: at(11) }, { start: at(10, 30), end: at(11, 30) }),
    30 * MILLIS_PER_MINUTE,
  );
  assert.equal(
    overlapMillis({ start: at(10), end: at(11) }, { start: at(11), end: at(12) }),
    0,
  );
  assert.equal(
    overlapMillis({ start: at(10), end: at(11) }, { start: at(14), end: at(15) }),
    0,
  );
});

test("membership is half-open at the end of the interval", () => {
  const interval = { start: at(10), end: at(11) };
  assert.equal(contains(interval, at(10)), true);
  assert.equal(contains(interval, at(10, 59)), true);
  assert.equal(contains(interval, at(11)), false);
  assert.equal(contains(interval, at(9, 59)), false);
});

test("merging coalesces overlapping and touching intervals", () => {
  const merged = mergeIntervals([
    { start: at(11), end: at(12) },
    { start: at(9), end: at(10) },
    { start: at(9, 30), end: at(10, 30) },
    { start: at(14), end: at(15) },
  ]);
  assert.deepEqual(merged, [
    { start: at(9), end: at(10, 30) },
    { start: at(11), end: at(12) },
    { start: at(14), end: at(15) },
  ]);
});

test("merging drops empty intervals", () => {
  assert.deepEqual(mergeIntervals([{ start: at(9), end: at(9) }]), []);
  assert.deepEqual(mergeIntervals([]), []);
});

test("free slots are the gaps between merged bookings inside the window", () => {
  const slots = freeSlots({ start: at(9), end: at(17) }, [
    { start: at(10), end: at(11) },
    { start: at(10, 30), end: at(12) },
    { start: at(15), end: at(16) },
  ]);
  assert.deepEqual(slots, [
    { start: at(9), end: at(10) },
    { start: at(12), end: at(15) },
    { start: at(16), end: at(17) },
  ]);
});

test("free slots shorter than the minimum are dropped", () => {
  const slots = freeSlots(
    { start: at(9), end: at(17) },
    [
      { start: at(9, 30), end: at(12) },
      { start: at(15), end: at(16) },
    ],
    60,
  );
  assert.deepEqual(slots, [
    { start: at(12), end: at(15) },
    { start: at(16), end: at(17) },
  ]);
});

test("busy time counts double-booked minutes once", () => {
  const total = busyMillis({ start: at(9), end: at(17) }, [
    { start: at(10), end: at(12) },
    { start: at(11), end: at(13) },
    { start: at(16), end: at(18) },
  ]);
  assert.equal(total / MILLIS_PER_MINUTE, 180 + 60);
});

test("back-to-back bookings on one resource are not reported as conflicts", () => {
  const conflicts = findConflicts([
    occurrence("standup", at(9, 15), 15, "room-atlas"),
    occurrence("design-review", at(9, 30), 60, "room-atlas"),
    occurrence("retro", at(10, 30), 30, "room-atlas"),
  ]);
  assert.deepEqual(
    conflicts.map((conflict) => `${conflict.first.eventId}/${conflict.second.eventId}`),
    [],
  );
});

test("each pair of bookings sharing a resource and a minute is reported once", () => {
  const conflicts = findConflicts([
    occurrence("alpha", at(10), 60, "room-atlas"),
    occurrence("beta", at(10, 30), 60, "room-atlas"),
    occurrence("gamma", at(10, 45), 30, "room-atlas"),
  ]);
  assert.deepEqual(
    conflicts.map((conflict) => `${conflict.first.eventId}/${conflict.second.eventId}`),
    ["alpha/beta", "alpha/gamma", "beta/gamma"],
  );
  assert.equal(conflicts[0].overlapMinutes, 30);
  assert.equal(conflicts[0].resource, "room-atlas");
});

test("bookings on different resources never conflict", () => {
  const conflicts = findConflicts([
    occurrence("alpha", at(10), 60, "room-atlas"),
    occurrence("beta", at(10), 60, "room-borealis"),
  ]);
  assert.deepEqual(conflicts, []);
});

test("occurrences with no resource share one bucket", () => {
  const conflicts = findConflicts([
    occurrence("alpha", at(10), 60),
    occurrence("beta", at(10, 15), 60),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].resource, "(unassigned)");
});
