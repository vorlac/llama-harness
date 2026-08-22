/**
 * Interval algebra over instants, and booking-conflict detection.
 *
 * Every interval in this module is half-open: `[start, end)`. The end instant
 * belongs to the next interval, not this one. See docs/SEMANTICS.md for what
 * that implies for adjacent bookings.
 */

import type { Conflict, Interval, Occurrence } from "./types.ts";
import { MILLIS_PER_MINUTE } from "./civil.ts";

/** The `[startUtc, endUtc)` interval an occurrence covers. */
export function occurrenceInterval(occurrence: Occurrence): Interval {
  return { start: occurrence.startUtc, end: occurrence.endUtc };
}

/** True when `a` and `b` share at least one instant. */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Milliseconds shared by `a` and `b`; zero when they do not overlap. */
export function overlapMillis(a: Interval, b: Interval): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? end - start : 0;
}

/** True when `instant` falls inside `interval`. */
export function contains(interval: Interval, instant: number): boolean {
  return instant >= interval.start && instant < interval.end;
}

/**
 * Union of a set of intervals, sorted and coalesced. Intervals that merely
 * touch (`a.end === b.start`) are coalesced into one block, because a run of
 * back-to-back bookings occupies one continuous stretch of busy time.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/**
 * The gaps inside `window` that no interval in `busy` covers, keeping only the
 * gaps at least `minimumMinutes` long.
 */
export function freeSlots(window: Interval, busy: Interval[], minimumMinutes = 0): Interval[] {
  const minimum = minimumMinutes * MILLIS_PER_MINUTE;
  const blocks = mergeIntervals(busy).filter(
    (block) => block.end > window.start && block.start < window.end,
  );

  const slots: Interval[] = [];
  let cursor = window.start;
  for (const block of blocks) {
    if (block.start > cursor) {
      slots.push({ start: cursor, end: Math.min(block.start, window.end) });
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= window.end) {
      break;
    }
  }
  if (cursor < window.end) {
    slots.push({ start: cursor, end: window.end });
  }
  return slots.filter((slot) => slot.end - slot.start >= minimum && slot.end > slot.start);
}

/** Occurrences with no resource share this bucket. */
export const UNASSIGNED_RESOURCE = "(unassigned)";

function bucketOf(occurrence: Occurrence): string {
  return occurrence.resource ?? UNASSIGNED_RESOURCE;
}

/**
 * Every pair of occurrences competing for the same resource, reported once per
 * pair, ordered by the earlier occurrence's start. Occurrences booked against
 * different resources never conflict with each other.
 */
export function findConflicts(occurrences: Occurrence[]): Conflict[] {
  const buckets = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = bucketOf(occurrence);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [occurrence]);
    } else {
      bucket.push(occurrence);
    }
  }

  const conflicts: Conflict[] = [];
  for (const [resource, bucket] of buckets) {
    const sorted = bucket
      .slice()
      .sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc);

    for (let i = 0; i < sorted.length; i++) {
      const first = occurrenceInterval(sorted[i]);
      for (let j = i + 1; j < sorted.length; j++) {
        const second = occurrenceInterval(sorted[j]);
        // The list is sorted by start, so once a later occurrence clears this
        // one, every occurrence after it clears it too.
        if (!intervalsOverlap(first, second)) {
          break;
        }
        conflicts.push({
          resource,
          first: sorted[i],
          second: sorted[j],
          overlapMinutes: overlapMillis(first, second) / MILLIS_PER_MINUTE,
        });
      }
    }
  }

  conflicts.sort(
    (a, b) =>
      a.first.startUtc - b.first.startUtc ||
      a.second.startUtc - b.second.startUtc ||
      a.resource.localeCompare(b.resource),
  );
  return conflicts;
}

/** Total busy time inside `window`, counting overlapping bookings once. */
export function busyMillis(window: Interval, intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce(
    (total, block) => total + overlapMillis(window, block),
    0,
  );
}
