/**
 * Whole-calendar operations: expand many events over a window, find the
 * bookings that collide, and answer "what is next?" for a single event.
 */

import type {
  Conflict,
  EventDefinition,
  Interval,
  Occurrence,
  RecurrenceRule,
} from "./types.ts";
import { MILLIS_PER_MINUTE, formatCivilDateTime, parseCivilDateTime } from "./civil.ts";
import { type ExpandOptions, expandEvent, validateEvent } from "./recurrence.ts";
import { findConflicts, freeSlots, occurrenceInterval } from "./overlap.ts";

export interface ScheduleSummary {
  occurrences: number;
  events: number;
  conflicts: number;
  bookedMinutes: number;
}

/** Expand every event and return the merged occurrence list in start order. */
export function buildSchedule(
  events: EventDefinition[],
  options: ExpandOptions = {},
): Occurrence[] {
  const all: Occurrence[] = [];
  for (const event of events) {
    for (const occurrence of expandEvent(event, options)) {
      all.push(occurrence);
    }
  }
  all.sort((a, b) => a.startUtc - b.startUtc || a.eventId.localeCompare(b.eventId));
  return all;
}

/** Conflicts among the occurrences of `events` inside the given window. */
export function detectConflicts(
  events: EventDefinition[],
  options: ExpandOptions = {},
): Conflict[] {
  return findConflicts(buildSchedule(events, options));
}

/** The first occurrence of `event` that starts strictly after `instant`. */
export function nextOccurrence(
  event: EventDefinition,
  instant: number,
  options: ExpandOptions = {},
): Occurrence | null {
  const found = expandEvent(event, { ...options, rangeStart: instant + 1, limit: 1 });
  return found.length > 0 ? found[0] : null;
}

/** Free stretches on one resource inside `window`, at least `minimumMinutes` long. */
export function freeSlotsForResource(
  events: EventDefinition[],
  resource: string,
  window: Interval,
  minimumMinutes = 0,
): Interval[] {
  const busy = buildSchedule(events, { rangeStart: window.start, rangeEnd: window.end })
    .filter((occurrence) => occurrence.resource === resource)
    .map(occurrenceInterval);
  return freeSlots(window, busy, minimumMinutes);
}

/** Counts and totals for a set of events over a window. */
export function summarizeSchedule(
  events: EventDefinition[],
  options: ExpandOptions = {},
): ScheduleSummary {
  const occurrences = buildSchedule(events, options);
  const bookedMillis = occurrences.reduce(
    (total, occurrence) => total + (occurrence.endUtc - occurrence.startUtc),
    0,
  );
  return {
    events: events.length,
    occurrences: occurrences.length,
    conflicts: findConflicts(occurrences).length,
    bookedMinutes: bookedMillis / MILLIS_PER_MINUTE,
  };
}

/** One line per occurrence: local start, zone, event id, resource. */
export function formatOccurrence(occurrence: Occurrence): string {
  const resource = occurrence.resource ?? "-";
  return (
    `${formatCivilDateTime(occurrence.localStart)} ${occurrence.timeZone} ` +
    `${occurrence.eventId} [${resource}]`
  );
}

interface RawRecurrence {
  frequency?: string;
  interval?: number;
  byDay?: string[];
  count?: number;
  until?: string;
}

interface RawEvent {
  id?: string;
  title?: string;
  timeZone?: string;
  start?: string;
  durationMinutes?: number;
  recurrence?: RawRecurrence;
  exceptionDates?: string[];
  resource?: string;
}

/**
 * Build validated event definitions from plain JSON, where `start` is a local
 * wall-clock string ("2026-03-02T09:00") rather than a civil object.
 */
export function parseEvents(raw: unknown): EventDefinition[] {
  if (!Array.isArray(raw)) {
    throw new SyntaxError("expected an array of events");
  }
  return raw.map((entry, position) => {
    const source = entry as RawEvent;
    if (typeof source.id !== "string" || typeof source.timeZone !== "string") {
      throw new SyntaxError(`event ${position} needs an id and a timeZone`);
    }
    if (typeof source.start !== "string") {
      throw new SyntaxError(`event ${source.id} needs a start`);
    }
    const event: EventDefinition = {
      id: source.id,
      title: source.title,
      timeZone: source.timeZone,
      start: parseCivilDateTime(source.start),
      durationMinutes: Number(source.durationMinutes),
      exceptionDates: source.exceptionDates,
      resource: source.resource,
    };
    if (source.recurrence !== undefined) {
      event.recurrence = source.recurrence as unknown as RecurrenceRule;
    }
    validateEvent(event);
    return event;
  });
}
