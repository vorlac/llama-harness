/**
 * Shared value types for the scheduler.
 *
 * Two clocks are used throughout and are never mixed:
 *
 *   - A *civil* date-time (`CivilDateTime`) is a wall-clock reading with no
 *     zone attached: "2026-03-08 02:30". It is what a user types into a form.
 *   - An *instant* is a number of milliseconds since the Unix epoch, i.e. a
 *     point on the UTC timeline. Every field holding an instant is named
 *     `...Utc` or `instant`.
 *
 * Converting between the two requires an IANA time zone id and is the job of
 * `timezone.ts`.
 */

/** Two-letter weekday codes, as used by RFC 5545 BYDAY. */
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** Recurrence frequencies this library supports. */
export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";

/** A wall-clock reading with no zone attached. `month` is 1-12, `day` is 1-31. */
export interface CivilDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * A recurrence rule, modelled on the subset of RFC 5545 RRULE that this
 * library implements. See docs/SEMANTICS.md for the exact expansion rules.
 */
export interface RecurrenceRule {
  frequency: Frequency;
  /** Number of frequency units between occurrences. Defaults to 1. */
  interval?: number;
  /** WEEKLY only: the weekdays within each selected week. */
  byDay?: Weekday[];
  /** Total number of occurrences the rule generates. Mutually exclusive with `until`. */
  count?: number;
  /** Inclusive upper bound, an ISO-8601 instant in UTC ("2026-01-05T00:00:00Z"). */
  until?: string;
}

/** An event definition as it is stored: local start, duration, optional rule. */
export interface EventDefinition {
  id: string;
  title?: string;
  /** IANA time zone id the local start is expressed in, e.g. "America/New_York". */
  timeZone: string;
  /** Local wall-clock start of the first occurrence. */
  start: CivilDateTime;
  durationMinutes: number;
  recurrence?: RecurrenceRule;
  /** Local calendar dates ("YYYY-MM-DD") on which no occurrence is scheduled. */
  exceptionDates?: string[];
  /** Optional booking target (room, machine, person) used to group conflicts. */
  resource?: string;
}

/** One materialised occurrence of an event. */
export interface Occurrence {
  eventId: string;
  title?: string;
  timeZone: string;
  /** Wall-clock start in `timeZone`. */
  localStart: CivilDateTime;
  /** Start instant on the UTC timeline. */
  startUtc: number;
  /** End instant on the UTC timeline: `startUtc + durationMinutes * 60_000`. */
  endUtc: number;
  resource?: string;
}

/** A half-open instant range `[start, end)`. */
export interface Interval {
  start: number;
  end: number;
}

/** A pair of occurrences on the same resource whose intervals intersect. */
export interface Conflict {
  resource: string;
  first: Occurrence;
  second: Occurrence;
  overlapMinutes: number;
}
