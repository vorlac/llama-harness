/**
 * Conversions between civil (wall-clock) values and instants, for IANA zones.
 *
 * The zone database is not shipped with this package; the offsets come from
 * `Intl.DateTimeFormat`, which every supported Node runtime provides with full
 * ICU. Formatters are cached per zone because constructing one is expensive.
 *
 * Offset transitions make the local-to-instant direction a partial function:
 *
 *   - Most wall-clock values map to exactly one instant.
 *   - During a fall-back transition a wall-clock value happens twice, and the
 *     earlier of the two instants is used.
 *   - During a spring-forward transition a wall-clock value does not happen at
 *     all; see docs/SEMANTICS.md for how such a value is resolved.
 */

import type { CivilDateTime } from "./types.ts";
import {
  MILLIS_PER_DAY,
  addDaysToCivil,
  MILLIS_PER_MINUTE,
  MILLIS_PER_SECOND,
  sameCivil,
  utcFromCivil,
} from "./civil.ts";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new RangeError(`unknown time zone: ${timeZone}`);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** True when the runtime recognises `timeZone` as an IANA zone id. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading in `timeZone` at `instant`. */
export function utcToZonedTime(instant: number, timeZone: string): CivilDateTime {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      field[part.type] = Number(part.value);
    }
  }
  return {
    year: field.year,
    month: field.month,
    day: field.day,
    hour: field.hour,
    minute: field.minute,
    second: field.second,
  };
}

/**
 * The offset of `timeZone` at `instant`, in milliseconds east of UTC.
 * America/New_York in January returns -5 hours; Asia/Kolkata returns +5:30.
 */
export function offsetAt(instant: number, timeZone: string): number {
  const local = utcToZonedTime(instant, timeZone);
  const whole = Math.floor(instant / MILLIS_PER_SECOND) * MILLIS_PER_SECOND;
  return utcFromCivil(local) - whole;
}

/** "+05:30" / "-05:00" / "+00:00" for an offset in milliseconds. */
export function formatOffset(offsetMillis: number): string {
  const sign = offsetMillis < 0 ? "-" : "+";
  const totalMinutes = Math.abs(Math.round(offsetMillis / MILLIS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * The instant at which `local` reads on the wall clock in `timeZone`.
 *
 * The offset in force cannot be known before the instant is known, so both
 * offsets in play around the candidate day are tried and the result that reads
 * back as the requested wall-clock value wins.
 */
export function zonedTimeToUtc(local: CivilDateTime, timeZone: string): number {
  const naive = utcFromCivil(local);
  const offsetBefore = offsetAt(naive - MILLIS_PER_DAY, timeZone);
  const offsetAfter = offsetAt(naive + MILLIS_PER_DAY, timeZone);

  const fromPriorOffset = naive - offsetBefore;
  if (offsetBefore === offsetAfter) {
    return fromPriorOffset;
  }

  const fromNextOffset = naive - offsetAfter;
  if (sameCivil(utcToZonedTime(fromPriorOffset, timeZone), local)) {
    return fromPriorOffset;
  }
  if (sameCivil(utcToZonedTime(fromNextOffset, timeZone), local)) {
    return fromNextOffset;
  }

  // Neither candidate reads back: the wall-clock value is inside an offset gap
  // and never occurs in this zone.
  return Math.min(fromPriorOffset, fromNextOffset);
}

/** The wall-clock value `days` later in `timeZone`, as an instant. */
export function addLocalDays(instant: number, days: number, timeZone: string): number {
  const local = utcToZonedTime(instant, timeZone);
  return zonedTimeToUtc(addDaysToCivil(local, days), timeZone);
}
