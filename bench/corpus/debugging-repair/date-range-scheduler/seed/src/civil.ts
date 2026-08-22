/**
 * Proleptic Gregorian calendar arithmetic on civil (wall-clock) values.
 *
 * Nothing in this module knows about time zones. Everything here is pure
 * integer arithmetic on year/month/day/hour/minute/second, plus the two
 * conversions between a civil value and a count of days (or milliseconds)
 * since 1970-01-01, which are the standard days-from-civil / civil-from-days
 * algorithms.
 *
 * `utcFromCivil` interprets a civil value as if it were already UTC. That is
 * only meaningful for values that really are UTC readings; use
 * `timezone.ts:zonedTimeToUtc` to resolve a local wall-clock value in a zone.
 */

import type { CivilDateTime, Weekday } from "./types.ts";

export const MILLIS_PER_SECOND = 1000;
export const MILLIS_PER_MINUTE = 60 * MILLIS_PER_SECOND;
export const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
export const MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR;

/** Monday-first weekday order, matching `weekdayIndex`. */
export const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Number of days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new RangeError(`month out of range: ${month}`);
  }
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return MONTH_LENGTHS[month - 1];
}

/** Days since 1970-01-01 for a proleptic Gregorian y/m/d. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of `daysFromCivil`. */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Interpret a civil value as a UTC reading and return the matching instant.
 * Round-trips exactly with `civilFromUtc`.
 */
export function utcFromCivil(civil: CivilDateTime): number {
  const days = daysFromCivil(civil.year, civil.month, civil.day);
  return (
    days * MILLIS_PER_DAY +
    civil.hour * MILLIS_PER_HOUR +
    civil.minute * MILLIS_PER_MINUTE +
    civil.second * MILLIS_PER_SECOND
  );
}

/** Inverse of `utcFromCivil`: the UTC reading of an instant. */
export function civilFromUtc(instant: number): CivilDateTime {
  const days = Math.floor(instant / MILLIS_PER_DAY);
  let rest = instant - days * MILLIS_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  const hour = Math.floor(rest / MILLIS_PER_HOUR);
  rest -= hour * MILLIS_PER_HOUR;
  const minute = Math.floor(rest / MILLIS_PER_MINUTE);
  rest -= minute * MILLIS_PER_MINUTE;
  const second = Math.floor(rest / MILLIS_PER_SECOND);
  return { year, month, day, hour, minute, second };
}

/** A copy of `civil` moved by `days`, keeping the time of day unchanged. */
export function addDaysToCivil(civil: CivilDateTime, days: number): CivilDateTime {
  const moved = civilFromDays(daysFromCivil(civil.year, civil.month, civil.day) + days);
  return {
    year: moved.year,
    month: moved.month,
    day: moved.day,
    hour: civil.hour,
    minute: civil.minute,
    second: civil.second,
  };
}

/** Monday-first weekday index: MO = 0 … SU = 6. */
export function weekdayIndex(civil: CivilDateTime): number {
  const days = daysFromCivil(civil.year, civil.month, civil.day);
  // 1970-01-01 was a Thursday, which is index 3 in a Monday-first week.
  return ((((days + 3) % 7) + 7) % 7);
}

/** Monday-first weekday index of a two-letter weekday code. */
export function weekdayCodeIndex(code: Weekday): number {
  const index = WEEKDAYS.indexOf(code);
  if (index < 0) {
    throw new RangeError(`unknown weekday code: ${code}`);
  }
  return index;
}

/** Chronological comparison of two civil values: -1, 0 or 1. */
export function compareCivil(a: CivilDateTime, b: CivilDateTime): number {
  const left = utcFromCivil(a);
  const right = utcFromCivil(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** True when every field of `a` equals the matching field of `b`. */
export function sameCivil(a: CivilDateTime, b: CivilDateTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/** "YYYY-MM-DD" for the date part of a civil value. */
export function formatCivilDate(civil: CivilDateTime): string {
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
}

/** "YYYY-MM-DDTHH:MM:SS" for a civil value. */
export function formatCivilDateTime(civil: CivilDateTime): string {
  return (
    `${formatCivilDate(civil)}T` +
    `${pad(civil.hour, 2)}:${pad(civil.minute, 2)}:${pad(civil.second, 2)}`
  );
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parse "YYYY-MM-DD" into a civil value at 00:00:00. */
export function parseCivilDate(text: string): CivilDateTime {
  const match = DATE_PATTERN.exec(text);
  if (!match) {
    throw new SyntaxError(`expected YYYY-MM-DD, got: ${text}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/** Parse "YYYY-MM-DDTHH:MM[:SS]" into a civil value. */
export function parseCivilDateTime(text: string): CivilDateTime {
  const match = DATE_TIME_PATTERN.exec(text);
  if (!match) {
    throw new SyntaxError(`expected YYYY-MM-DDTHH:MM[:SS], got: ${text}`);
  }
  const civil: CivilDateTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
  };
  assertCivilInRange(civil);
  return civil;
}

/** Throw when a civil value names a date or time that cannot exist. */
export function assertCivilInRange(civil: CivilDateTime): void {
  if (civil.month < 1 || civil.month > 12) {
    throw new RangeError(`month out of range: ${civil.month}`);
  }
  const limit = daysInMonth(civil.year, civil.month);
  if (civil.day < 1 || civil.day > limit) {
    throw new RangeError(
      `day out of range for ${civil.year}-${pad(civil.month, 2)}: ${civil.day}`,
    );
  }
  if (civil.hour < 0 || civil.hour > 23) {
    throw new RangeError(`hour out of range: ${civil.hour}`);
  }
  if (civil.minute < 0 || civil.minute > 59) {
    throw new RangeError(`minute out of range: ${civil.minute}`);
  }
  if (civil.second < 0 || civil.second > 59) {
    throw new RangeError(`second out of range: ${civil.second}`);
  }
}
