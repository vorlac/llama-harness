import type { CivilDateTime, EventDefinition, Occurrence } from "../src/types.ts";

/** Terse civil-value builder for tests. */
export function civil(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): CivilDateTime {
  return { year, month, day, hour, minute, second };
}

/** Event builder with the fields most tests do not care about filled in. */
export function event(overrides: Partial<EventDefinition> & { id: string }): EventDefinition {
  return {
    timeZone: "UTC",
    start: civil(2026, 1, 1, 9, 0),
    durationMinutes: 60,
    ...overrides,
  };
}

/** "YYYY-MM-DD HH:MM" for readable assertion failures. */
export function localStamp(value: CivilDateTime): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)} ` +
    `${pad(value.hour)}:${pad(value.minute)}`
  );
}

/** Occurrence builder for tests that exercise interval logic directly. */
export function occurrence(
  eventId: string,
  startUtc: number,
  durationMinutes: number,
  resource?: string,
): Occurrence {
  return {
    eventId,
    timeZone: "UTC",
    localStart: civilFromInstant(startUtc),
    startUtc,
    endUtc: startUtc + durationMinutes * 60_000,
    resource,
  };
}

function civilFromInstant(instant: number): CivilDateTime {
  const date = new Date(instant);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/** Minutes past 2026-04-06T00:00Z, as an instant. Keeps test data readable. */
export function at(hour: number, minute = 0, dayOfMonth = 6): number {
  return Date.UTC(2026, 3, dayOfMonth, hour, minute);
}
