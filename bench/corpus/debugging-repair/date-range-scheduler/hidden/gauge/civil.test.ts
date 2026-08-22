import test from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToCivil,
  civilFromUtc,
  compareCivil,
  daysInMonth,
  formatCivilDate,
  isLeapYear,
  parseCivilDateTime,
  utcFromCivil,
  weekdayIndex,
} from "../src/civil.ts";
import { civil } from "./helpers.ts";

test("month lengths follow the Gregorian leap rule", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
});

test("civil values round trip through the epoch conversion", () => {
  const samples = [
    civil(1970, 1, 1),
    civil(1969, 12, 31, 23, 59, 59),
    civil(2026, 3, 8, 2, 30),
    civil(2000, 2, 29, 12, 0, 1),
    civil(2100, 12, 31, 23, 59, 59),
  ];
  for (const sample of samples) {
    assert.deepEqual(civilFromUtc(utcFromCivil(sample)), sample);
  }
});

test("the epoch conversion agrees with Date.UTC", () => {
  assert.equal(utcFromCivil(civil(2026, 3, 8, 7, 30)), Date.UTC(2026, 2, 8, 7, 30));
  assert.equal(utcFromCivil(civil(1969, 7, 20, 20, 17)), Date.UTC(1969, 6, 20, 20, 17));
});

test("adding days crosses month and year boundaries", () => {
  assert.equal(formatCivilDate(addDaysToCivil(civil(2026, 1, 31), 1)), "2026-02-01");
  assert.equal(formatCivilDate(addDaysToCivil(civil(2026, 12, 31), 1)), "2027-01-01");
  assert.equal(formatCivilDate(addDaysToCivil(civil(2028, 2, 28), 1)), "2028-02-29");
  assert.equal(formatCivilDate(addDaysToCivil(civil(2026, 3, 1), -1)), "2026-02-28");
});

test("adding days keeps the time of day", () => {
  const moved = addDaysToCivil(civil(2026, 5, 1, 13, 45, 30), 45);
  assert.equal(moved.hour, 13);
  assert.equal(moved.minute, 45);
  assert.equal(moved.second, 30);
});

test("weekday indexing is Monday-first", () => {
  assert.equal(weekdayIndex(civil(2026, 1, 5)), 0);
  assert.equal(weekdayIndex(civil(2026, 1, 11)), 6);
  assert.equal(weekdayIndex(civil(1970, 1, 1)), 3);
});

test("comparison orders civil values chronologically", () => {
  assert.equal(compareCivil(civil(2026, 1, 1), civil(2026, 1, 2)), -1);
  assert.equal(compareCivil(civil(2026, 1, 2), civil(2026, 1, 1)), 1);
  assert.equal(compareCivil(civil(2026, 1, 1, 9, 0), civil(2026, 1, 1, 9, 0)), 0);
});

test("parsing rejects dates that do not exist", () => {
  assert.deepEqual(parseCivilDateTime("2026-02-28T23:59"), civil(2026, 2, 28, 23, 59));
  assert.throws(() => parseCivilDateTime("2026-02-30T09:00"), RangeError);
  assert.throws(() => parseCivilDateTime("2026-13-01T09:00"), RangeError);
  assert.throws(() => parseCivilDateTime("2026-01-01T24:00"), RangeError);
  assert.throws(() => parseCivilDateTime("not-a-date"), SyntaxError);
});
