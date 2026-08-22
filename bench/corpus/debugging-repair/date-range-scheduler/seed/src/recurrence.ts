/**
 * Expansion of a recurrence rule into concrete occurrences.
 *
 * An expansion walks candidate wall-clock values in chronological order,
 * discards the ones the rule does not select, resolves each survivor to an
 * instant in the event's zone, and stops when the rule's bound (COUNT, UNTIL)
 * or the caller's window is reached. docs/SEMANTICS.md is the reference for
 * what each field means; this module implements it.
 */

import type {
  CivilDateTime,
  EventDefinition,
  Occurrence,
  RecurrenceRule,
  Weekday,
} from "./types.ts";
import {
  MILLIS_PER_MINUTE,
  addDaysToCivil,
  assertCivilInRange,
  compareCivil,
  daysInMonth,
  formatCivilDate,
  utcFromCivil,
  weekdayCodeIndex,
  weekdayIndex,
} from "./civil.ts";
import { isValidTimeZone, zonedTimeToUtc } from "./timezone.ts";

/** Ceiling on returned occurrences when the caller does not set one. */
export const DEFAULT_LIMIT = 500;

/**
 * Ceiling on candidate wall-clock values examined per expansion. Expansions
 * whose candidates are then filtered out - a window that opens late, exception
 * dates - examine more candidates than they emit, so this sits well above
 * DEFAULT_LIMIT.
 */
const MAX_CANDIDATES = 20000;

export interface ExpandOptions {
  /** Inclusive lower bound on the occurrence start instant. */
  rangeStart?: number;
  /** Exclusive upper bound on the occurrence start instant. */
  rangeEnd?: number;
  /** Hard cap on the number of occurrences returned. */
  limit?: number;
}

function parseInstant(text: string, field: string): number {
  const value = Date.parse(text);
  if (Number.isNaN(value)) {
    throw new SyntaxError(`${field} is not an ISO-8601 instant: ${text}`);
  }
  return value;
}

/** Throw a descriptive error when a rule cannot be expanded. */
export function validateRule(rule: RecurrenceRule): void {
  if (rule.frequency !== "DAILY" && rule.frequency !== "WEEKLY" && rule.frequency !== "MONTHLY") {
    throw new RangeError(`unsupported frequency: ${String(rule.frequency)}`);
  }
  if (rule.interval !== undefined) {
    if (!Number.isInteger(rule.interval) || rule.interval < 1) {
      throw new RangeError(`interval must be a positive integer, got: ${rule.interval}`);
    }
  }
  if (rule.count !== undefined) {
    if (!Number.isInteger(rule.count) || rule.count < 1) {
      throw new RangeError(`count must be a positive integer, got: ${rule.count}`);
    }
  }
  if (rule.count !== undefined && rule.until !== undefined) {
    throw new RangeError("count and until are mutually exclusive");
  }
  if (rule.byDay !== undefined) {
    if (rule.frequency !== "WEEKLY") {
      throw new RangeError("byDay is only supported for WEEKLY rules");
    }
    if (rule.byDay.length === 0) {
      throw new RangeError("byDay must list at least one weekday");
    }
    for (const code of rule.byDay) {
      weekdayCodeIndex(code);
    }
  }
  if (rule.until !== undefined) {
    parseInstant(rule.until, "until");
  }
}

/** Throw a descriptive error when an event definition cannot be expanded. */
export function validateEvent(event: EventDefinition): void {
  if (!event.id) {
    throw new RangeError("event id is required");
  }
  if (!isValidTimeZone(event.timeZone)) {
    throw new RangeError(`unknown time zone: ${event.timeZone}`);
  }
  assertCivilInRange(event.start);
  if (!Number.isFinite(event.durationMinutes) || event.durationMinutes <= 0) {
    throw new RangeError(`durationMinutes must be positive, got: ${event.durationMinutes}`);
  }
  if (event.recurrence !== undefined) {
    validateRule(event.recurrence);
  }
}

/** Monday-first offsets, within a week, of the weekdays a WEEKLY rule selects. */
function weeklyOffsets(start: CivilDateTime, byDay: Weekday[] | undefined): number[] {
  if (byDay === undefined) {
    return [weekdayIndex(start)];
  }
  const offsets = byDay.map(weekdayCodeIndex);
  const unique = Array.from(new Set(offsets));
  unique.sort((a, b) => a - b);
  return unique;
}

/**
 * The wall-clock value of candidate number `index` (0-based) for a rule
 * anchored at `start`, or null when the rule selects nothing at that index.
 */
function candidateAt(
  start: CivilDateTime,
  rule: RecurrenceRule,
  index: number,
): CivilDateTime | null {
  const interval = rule.interval ?? 1;

  if (rule.frequency === "DAILY") {
    return addDaysToCivil(start, index * interval);
  }

  if (rule.frequency === "WEEKLY") {
    const offsets = weeklyOffsets(start, rule.byDay);
    const weekAnchor = addDaysToCivil(start, -weekdayIndex(start));
    const week = Math.floor(index / offsets.length);
    const offset = offsets[index % offsets.length];
    return addDaysToCivil(weekAnchor, week * interval * 7 + offset);
  }

  const monthsFromAnchor = start.month - 1 + index * interval;
  const year = start.year + Math.floor(monthsFromAnchor / 12);
  const month = (((monthsFromAnchor % 12) + 12) % 12) + 1;
  const monthLength = daysInMonth(year, month);
  if (start.day > monthLength) {
    return null;
  }
  return {
    year,
    month,
    day: start.day,
    hour: start.hour,
    minute: start.minute,
    second: start.second,
  };
}

/**
 * Expand one event into its occurrences, in chronological order.
 *
 * Events with no `recurrence` yield exactly one occurrence.
 */
export function expandEvent(event: EventDefinition, options: ExpandOptions = {}): Occurrence[] {
  validateEvent(event);

  const limit = options.limit ?? DEFAULT_LIMIT;
  const duration = event.durationMinutes * MILLIS_PER_MINUTE;
  const exceptions = new Set(event.exceptionDates ?? []);
  const occurrences: Occurrence[] = [];

  const materialise = (local: CivilDateTime): Occurrence => {
    const startUtc = zonedTimeToUtc(local, event.timeZone);
    return {
      eventId: event.id,
      title: event.title,
      timeZone: event.timeZone,
      localStart: local,
      startUtc,
      endUtc: startUtc + duration,
      resource: event.resource,
    };
  };

  const inWindow = (startUtc: number): boolean => {
    if (options.rangeStart !== undefined && startUtc < options.rangeStart) {
      return false;
    }
    if (options.rangeEnd !== undefined && startUtc >= options.rangeEnd) {
      return false;
    }
    return true;
  };

  if (event.recurrence === undefined) {
    const only = materialise(event.start);
    if (inWindow(only.startUtc) && !exceptions.has(formatCivilDate(event.start))) {
      occurrences.push(only);
    }
    return occurrences;
  }

  const rule = event.recurrence;
  const until = rule.until === undefined ? undefined : parseInstant(rule.until, "until");
  let generated = 0;

  for (let index = 0; index < MAX_CANDIDATES; index++) {
    const local = candidateAt(event.start, rule, index);
    if (local === null) {
      continue;
    }
    if (compareCivil(local, event.start) < 0) {
      continue;
    }
    if (until !== undefined && utcFromCivil(local) > until) {
      break;
    }

    generated += 1;
    const occurrence = materialise(local);

    if (options.rangeEnd !== undefined && occurrence.startUtc >= options.rangeEnd) {
      break;
    }
    if (inWindow(occurrence.startUtc) && !exceptions.has(formatCivilDate(local))) {
      occurrences.push(occurrence);
      if (occurrences.length >= limit) {
        break;
      }
    }
    if (rule.count !== undefined && generated >= rule.count) {
      break;
    }
  }

  return occurrences;
}
