// conductor/adapter/clock.ts — the injectable time source the composition root
// hands every handler (GAP-035). Adapter, not core: core takes every timestamp as
// DATA (G3), so this is the one place that reads a clock at all.
//
// Why a plain `Date.now()` is not enough at the enforcement seams. Two of the §2
// verdicts are comparisons between stamps:
//   - §2.6 freshness — "did an edit land after the verify started?" compares a start
//     stamp against filesystem mtimes, which carry sub-millisecond precision;
//   - §3.3's stale-red rule — "has a later run happened than the red the critics
//     would be shown?" orders records that a run can append inside one millisecond.
// `Date.now()` truncates to whole milliseconds and can repeat, so two events inside
// one tick compare EQUAL and the verdict falls to whichever tie-break the rule
// happens to carry — an enforcement decision made by machine speed. hrtime's
// nanosecond counter orders them, and it is monotonic besides: a wall clock read
// once at construction can never step a stamp backwards behind one already handed
// out (an NTP correction mid-run would otherwise make an older record look newer).

export interface MonotonicClockSources {
  /** Epoch milliseconds; read ONCE, at construction, to anchor the stamps. */
  wall?: () => number;
  /** Nanoseconds since an arbitrary origin, non-decreasing. */
  elapsed?: () => bigint;
}

// The smallest increment that is guaranteed to produce a strictly greater double at
// `value`'s magnitude. Epoch milliseconds sit around 2^40.6, where one ULP is about
// 0.24 microseconds — far finer than the millisecond the tie-break exists to split,
// and the loop makes the guarantee exact rather than approximate.
function strictlyAfter(value: number): number {
  let next = value;
  let step = Math.max(Number.MIN_VALUE, Math.abs(value) * Number.EPSILON);
  while (!(next > value)) {
    next = value + step;
    step *= 2;
  }
  return next;
}

/**
 * A strictly increasing epoch-millisecond clock with sub-millisecond resolution.
 * Successive calls NEVER return the same value, so two events inside one
 * millisecond stay ordered, and the value stays an epoch millisecond so it remains
 * comparable to a filesystem mtime and readable in a record.
 *
 * Both sources are injectable so the collision case is constructed in a test rather
 * than waited for.
 */
export function createMonotonicClock(sources: MonotonicClockSources = {}): () => number {
  const wall = sources.wall ?? Date.now;
  const elapsed = sources.elapsed ?? process.hrtime.bigint;
  const originWall = wall();
  const originElapsed = elapsed();
  let last = Number.NEGATIVE_INFINITY;
  return (): number => {
    const sinceOriginNs = elapsed() - originElapsed;
    const candidate = originWall + Number(sinceOriginNs) / 1e6;
    const value = candidate > last ? candidate : strictlyAfter(last);
    last = value;
    return value;
  };
}

/**
 * The resolution, in milliseconds, that a stamp can order events at — read off the
 * stamp itself, because that is the only thing a record written by an earlier
 * process still carries. A whole-millisecond value is a truncated wall-clock read
 * and orders nothing finer than its own tick (1); a fractional value came from the
 * monotonic source above and decides the tie (0). Anything unreadable is treated as
 * the coarse case: a comparison may never claim an ordering a stamp cannot prove.
 */
export function stampResolutionMsOf(startedMs: number): number {
  return Number.isFinite(startedMs) && !Number.isInteger(startedMs) ? 0 : 1;
}
