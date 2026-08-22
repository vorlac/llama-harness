import test from "node:test";
import assert from "node:assert/strict";

import { MILLIS_PER_HOUR } from "../src/civil.ts";
import {
  formatOffset,
  isValidTimeZone,
  offsetAt,
  utcToZonedTime,
  zonedTimeToUtc,
} from "../src/timezone.ts";
import { civil, localStamp } from "./helpers.ts";

const NEW_YORK = "America/New_York";
const BERLIN = "Europe/Berlin";
const KOLKATA = "Asia/Kolkata";

test("offsets follow each zone's standard and summer rules", () => {
  assert.equal(offsetAt(Date.UTC(2026, 0, 15, 12, 0), NEW_YORK), -5 * MILLIS_PER_HOUR);
  assert.equal(offsetAt(Date.UTC(2026, 6, 15, 12, 0), NEW_YORK), -4 * MILLIS_PER_HOUR);
  assert.equal(offsetAt(Date.UTC(2026, 0, 15, 12, 0), BERLIN), 1 * MILLIS_PER_HOUR);
  assert.equal(offsetAt(Date.UTC(2026, 6, 15, 12, 0), BERLIN), 2 * MILLIS_PER_HOUR);
  assert.equal(offsetAt(Date.UTC(2026, 0, 15, 12, 0), KOLKATA), 5.5 * MILLIS_PER_HOUR);
  assert.equal(offsetAt(Date.UTC(2026, 0, 15, 12, 0), "UTC"), 0);
});

test("offsets format as signed hours and minutes", () => {
  assert.equal(formatOffset(-5 * MILLIS_PER_HOUR), "-05:00");
  assert.equal(formatOffset(5.5 * MILLIS_PER_HOUR), "+05:30");
  assert.equal(formatOffset(0), "+00:00");
});

test("unknown zone ids are rejected", () => {
  assert.equal(isValidTimeZone(NEW_YORK), true);
  assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  assert.throws(() => zonedTimeToUtc(civil(2026, 1, 1, 9, 0), "Mars/Olympus_Mons"), RangeError);
});

test("every wall-clock hour of an ordinary day round trips", () => {
  for (let hour = 0; hour < 24; hour++) {
    const local = civil(2026, 6, 15, hour, 30);
    const instant = zonedTimeToUtc(local, NEW_YORK);
    assert.deepEqual(
      utcToZonedTime(instant, NEW_YORK),
      local,
      `wall clock ${localStamp(local)} did not round trip`,
    );
  }
});

test("wall clocks either side of the spring-forward gap keep their own hour", () => {
  const before = zonedTimeToUtc(civil(2026, 3, 8, 1, 59), NEW_YORK);
  assert.equal(before, Date.UTC(2026, 2, 8, 6, 59));
  assert.equal(localStamp(utcToZonedTime(before, NEW_YORK)), "2026-03-08 01:59");

  const after = zonedTimeToUtc(civil(2026, 3, 8, 3, 0), NEW_YORK);
  assert.equal(after, Date.UTC(2026, 2, 8, 7, 0));
  assert.equal(localStamp(utcToZonedTime(after, NEW_YORK)), "2026-03-08 03:00");
});

test("a 02:30 wall clock on a spring-forward date reads back as 03:30 the same morning", () => {
  const instant = zonedTimeToUtc(civil(2026, 3, 8, 2, 30), NEW_YORK);
  assert.equal(
    localStamp(utcToZonedTime(instant, NEW_YORK)),
    "2026-03-08 03:30",
    "a wall clock inside the gap must not land before the transition",
  );
  assert.equal(instant, Date.UTC(2026, 2, 8, 7, 30));
});

test("a 02:30 wall clock on Berlin's spring-forward date reads back as 03:30", () => {
  const instant = zonedTimeToUtc(civil(2026, 3, 29, 2, 30), BERLIN);
  assert.equal(localStamp(utcToZonedTime(instant, BERLIN)), "2026-03-29 03:30");
  assert.equal(instant, Date.UTC(2026, 2, 29, 1, 30));
});

test("a wall clock the fall-back transition repeats resolves to its first pass", () => {
  const instant = zonedTimeToUtc(civil(2026, 11, 1, 1, 30), NEW_YORK);
  assert.equal(instant, Date.UTC(2026, 10, 1, 5, 30));
  assert.equal(offsetAt(instant, NEW_YORK), -4 * MILLIS_PER_HOUR);
  assert.equal(localStamp(utcToZonedTime(instant, NEW_YORK)), "2026-11-01 01:30");
});

test("instants convert to local time and back unchanged outside transitions", () => {
  const instants = [
    Date.UTC(2026, 0, 1, 0, 0),
    Date.UTC(2026, 5, 30, 18, 45),
    Date.UTC(2026, 10, 15, 6, 0),
  ];
  for (const zone of [NEW_YORK, BERLIN, KOLKATA, "UTC"]) {
    for (const instant of instants) {
      assert.equal(zonedTimeToUtc(utcToZonedTime(instant, zone), zone), instant);
    }
  }
});
