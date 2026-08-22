import test from "node:test";
import assert from "node:assert/strict";

import { formatCivilDate } from "../src/civil.ts";
import { expandEvent, validateEvent } from "../src/recurrence.ts";
import type { Occurrence } from "../src/types.ts";
import { civil, event, localStamp } from "./helpers.ts";

function localDates(occurrences: Occurrence[]): string[] {
  return occurrences.map((occurrence) => formatCivilDate(occurrence.localStart));
}

test("an event with no recurrence yields exactly one occurrence", () => {
  const occurrences = expandEvent(
    event({ id: "one-off", timeZone: "America/New_York", start: civil(2026, 4, 2, 14, 0) }),
  );
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].startUtc, Date.UTC(2026, 3, 2, 18, 0));
  assert.equal(occurrences[0].endUtc - occurrences[0].startUtc, 60 * 60 * 1000);
});

test("a count-bounded daily series returns exactly count occurrences", () => {
  const occurrences = expandEvent(
    event({
      id: "every-third-day",
      start: civil(2026, 2, 2, 8, 0),
      recurrence: { frequency: "DAILY", interval: 3, count: 4 },
    }),
  );
  assert.equal(occurrences.length, 4);
  assert.deepEqual(localDates(occurrences), [
    "2026-02-02",
    "2026-02-05",
    "2026-02-08",
    "2026-02-11",
  ]);
});

test("a weekly series expands the listed weekdays in calendar order", () => {
  const occurrences = expandEvent(
    event({
      id: "standup",
      start: civil(2026, 1, 5, 9, 0),
      recurrence: { frequency: "WEEKLY", byDay: ["MO", "WE", "FR"], count: 6 },
    }),
  );
  assert.deepEqual(localDates(occurrences), [
    "2026-01-05",
    "2026-01-07",
    "2026-01-09",
    "2026-01-12",
    "2026-01-14",
    "2026-01-16",
  ]);
});

test("a fortnightly series skips the intervening week", () => {
  const occurrences = expandEvent(
    event({
      id: "pairing",
      start: civil(2026, 1, 5, 15, 0),
      recurrence: { frequency: "WEEKLY", interval: 2, byDay: ["TU", "TH"], count: 4 },
    }),
  );
  assert.deepEqual(localDates(occurrences), [
    "2026-01-06",
    "2026-01-08",
    "2026-01-20",
    "2026-01-22",
  ]);
});

test("a weekly series never emits an occurrence before its start", () => {
  const occurrences = expandEvent(
    event({
      id: "late-start",
      start: civil(2026, 1, 8, 9, 0),
      recurrence: { frequency: "WEEKLY", byDay: ["MO", "TH"], count: 3 },
    }),
  );
  assert.deepEqual(localDates(occurrences), ["2026-01-08", "2026-01-12", "2026-01-15"]);
});

test("exception dates drop the matching occurrences and nothing else", () => {
  const occurrences = expandEvent(
    event({
      id: "with-holiday",
      start: civil(2026, 2, 2, 10, 0),
      recurrence: { frequency: "DAILY", count: 5 },
      exceptionDates: ["2026-02-04"],
    }),
  );
  assert.deepEqual(localDates(occurrences), [
    "2026-02-02",
    "2026-02-03",
    "2026-02-05",
    "2026-02-06",
  ]);
});

test("a monthly series anchored on the 31st has an occurrence in every month", () => {
  const occurrences = expandEvent(
    event({
      id: "month-end",
      start: civil(2026, 1, 31, 16, 0),
      recurrence: { frequency: "MONTHLY", count: 5 },
    }),
  );
  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.localStart.month),
    [1, 2, 3, 4, 5],
    `expanded to ${occurrences.map((o) => localStamp(o.localStart)).join(", ")}`,
  );
});

test("a monthly series anchored on the 31st lands on the last day of shorter months", () => {
  const occurrences = expandEvent(
    event({
      id: "month-end",
      start: civil(2026, 1, 31, 16, 0),
      recurrence: { frequency: "MONTHLY", count: 5 },
    }),
  );
  assert.deepEqual(localDates(occurrences), [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
    "2026-05-31",
  ]);
});

test("a monthly series anchored on the 29th reaches 29 February in a leap year", () => {
  const occurrences = expandEvent(
    event({
      id: "leap-month-end",
      start: civil(2028, 1, 29, 12, 0),
      recurrence: { frequency: "MONTHLY", count: 3 },
    }),
  );
  assert.deepEqual(localDates(occurrences), ["2028-01-29", "2028-02-29", "2028-03-29"]);
});

test("a monthly series with an interval keeps its day of month", () => {
  const occurrences = expandEvent(
    event({
      id: "quarterly",
      start: civil(2026, 1, 15, 9, 0),
      recurrence: { frequency: "MONTHLY", interval: 3, count: 4 },
    }),
  );
  assert.deepEqual(localDates(occurrences), [
    "2026-01-15",
    "2026-04-15",
    "2026-07-15",
    "2026-10-15",
  ]);
});

test("an evening series stops before the first occurrence past its cutoff instant", () => {
  const occurrences = expandEvent(
    event({
      id: "evening-check",
      timeZone: "America/New_York",
      start: civil(2026, 1, 1, 20, 0),
      durationMinutes: 30,
      recurrence: { frequency: "DAILY", until: "2026-01-05T00:00:00Z" },
    }),
  );
  assert.deepEqual(localDates(occurrences), ["2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.equal(occurrences[occurrences.length - 1].startUtc, Date.UTC(2026, 0, 4, 1, 0));
});

test("an early-morning series in a zone ahead of UTC keeps its final occurrence", () => {
  const occurrences = expandEvent(
    event({
      id: "berlin-open",
      timeZone: "Europe/Berlin",
      start: civil(2026, 1, 1, 0, 30),
      durationMinutes: 30,
      recurrence: { frequency: "DAILY", until: "2026-01-05T00:00:00Z" },
    }),
  );
  assert.deepEqual(localDates(occurrences), [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
    "2026-01-05",
  ]);
  assert.equal(occurrences[occurrences.length - 1].startUtc, Date.UTC(2026, 0, 4, 23, 30));
});

test("a daily series keeps its wall-clock time across a DST transition", () => {
  const occurrences = expandEvent(
    event({
      id: "morning-sync",
      timeZone: "America/New_York",
      start: civil(2026, 3, 6, 9, 0),
      recurrence: { frequency: "DAILY", count: 5 },
    }),
  );
  for (const occurrence of occurrences) {
    assert.equal(occurrence.localStart.hour, 9, localStamp(occurrence.localStart));
    assert.equal(occurrence.localStart.minute, 0);
  }
  assert.equal(occurrences[0].startUtc, Date.UTC(2026, 2, 6, 14, 0));
  assert.equal(occurrences[4].startUtc, Date.UTC(2026, 2, 10, 13, 0));
});

test("a window filters occurrences by start instant, half-open at the end", () => {
  const definition = event({
    id: "windowed",
    start: civil(2026, 2, 1, 12, 0),
    recurrence: { frequency: "DAILY", count: 10 },
  });
  const occurrences = expandEvent(definition, {
    rangeStart: Date.UTC(2026, 1, 3, 12, 0),
    rangeEnd: Date.UTC(2026, 1, 6, 12, 0),
  });
  assert.deepEqual(localDates(occurrences), ["2026-02-03", "2026-02-04", "2026-02-05"]);
});

test("invalid rules and events are rejected before expansion", () => {
  assert.throws(
    () => expandEvent(event({ id: "bad-interval", recurrence: { frequency: "DAILY", interval: 0 } })),
    RangeError,
  );
  assert.throws(
    () =>
      expandEvent(
        event({ id: "bad-byday", recurrence: { frequency: "DAILY", byDay: ["MO"], count: 2 } }),
      ),
    RangeError,
  );
  assert.throws(
    () =>
      expandEvent(
        event({
          id: "over-bounded",
          recurrence: { frequency: "DAILY", count: 2, until: "2026-01-05T00:00:00Z" },
        }),
      ),
    RangeError,
  );
  assert.throws(() => validateEvent(event({ id: "bad-zone", timeZone: "Nowhere/Special" })), RangeError);
  assert.throws(() => validateEvent(event({ id: "bad-duration", durationMinutes: 0 })), RangeError);
});
