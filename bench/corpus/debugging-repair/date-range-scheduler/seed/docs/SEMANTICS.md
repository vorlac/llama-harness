# Scheduler semantics

The reference for what this library is supposed to do. Where the code and this
document disagree, this document and the test suite are right.

## Clocks

Two representations, never mixed:

- **Civil date-time** — a wall-clock reading with no zone: `2026-03-08 02:30`.
  Modelled by `CivilDateTime`. This is what a user types.
- **Instant** — milliseconds since the Unix epoch, a point on the UTC timeline.
  Every field holding one is named `...Utc`, or `instant` for a bare value.

`civil.ts` converts between a civil value and an instant *only* under the
assumption that the civil value is a UTC reading. Turning a local wall-clock
value into an instant requires a zone and is `timezone.ts`'s job.

## Time zones

Offsets come from the runtime's IANA database via `Intl.DateTimeFormat`.

- `utcToZonedTime(instant, zone)` is total: every instant has exactly one wall
  clock reading in every zone.
- `zonedTimeToUtc(local, zone)` is not, because offset transitions make some
  wall-clock values ambiguous and others impossible:
  - **Unambiguous** — one instant reads back as `local`; return it.
  - **Ambiguous** (fall back, the hour that runs twice) — two instants read
    back as `local`. Return the **earlier** one, i.e. the first pass, still at
    the pre-transition offset.
  - **Nonexistent** (spring forward, the hour that is skipped) — no instant
    reads back as `local`. Return the instant **`local` plus the length of the
    gap**: a wall clock inside the gap moves *forward* out of it, so 02:30 on a
    day that jumps 02:00 to 03:00 resolves to 03:30 local on that same day.
    Never resolve a nonexistent wall clock to an instant before the transition.

A recurring event keeps its **wall-clock** time across a transition: a 09:00
local daily meeting is at 09:00 local on both sides of a DST boundary, even
though the two instants are a different number of hours apart.

## Recurrence rules

A rule is the RFC 5545 RRULE subset in `RecurrenceRule`. The anchor is the
event's local `start`, which is also the first candidate.

- `interval` defaults to 1 and must be a positive integer.
- `count` and `until` are mutually exclusive.
- Candidates are generated in chronological order; a candidate earlier than the
  event start is never emitted and does not count towards `count`.

### DAILY

Every `interval` days from the anchor, keeping the anchor's time of day.

### WEEKLY

Weeks begin on Monday. Without `byDay`, the rule repeats on the anchor's own
weekday every `interval` weeks. With `byDay`, every listed weekday of every
`interval`-th week is selected, in calendar order within the week.

### MONTHLY

Every `interval` months from the anchor, on the anchor's day of month.

**Short-month clamping.** When the anchor's day of month does not exist in a
target month, the occurrence falls on the **last day of that month**. A series
anchored on the 31st therefore has an occurrence in *every* month: 31 January,
28 February (29 in a leap year), 31 March, 30 April, and so on. Months are
never skipped, and clamping never changes the anchor day used for later months.

### COUNT and UNTIL

- `count` is the number of occurrences the rule generates, counted before
  exception dates are removed. Removing an exception date therefore shortens
  the returned list rather than extending the series.
- `until` is an **inclusive bound on the UTC timeline**, written as an ISO-8601
  instant such as `2026-01-05T00:00:00Z`. An occurrence is part of the series
  when its **start instant** is less than or equal to `until`. It is *not* a
  local wall-clock bound: for an event in a zone behind UTC the last local day
  included is often earlier than the calendar date in `until`, and for a zone
  ahead of UTC it is often later.

### Exception dates

`exceptionDates` lists local calendar dates (`YYYY-MM-DD`) in the event's own
zone. An occurrence whose local start date is listed is removed after the rule
has generated it.

## Windows

`ExpandOptions.rangeStart` is inclusive and `rangeEnd` is exclusive, both
compared against an occurrence's **start** instant.

## Intervals and conflicts

Every interval is half-open: `[start, end)`. Consequences, all of them
intentional:

- A booking that ends at exactly the instant the next one starts does **not**
  overlap it. Back-to-back bookings are not conflicts; that is the normal way a
  room is used all morning.
- An interval with `start === end` covers nothing and overlaps nothing.
- `contains(interval, instant)` is true for `start` and false for `end`.
- `mergeIntervals` is the exception that proves the rule: it *does* coalesce
  intervals that merely touch, because a run of back-to-back bookings occupies
  one continuous stretch of busy time. Merging is a union over the timeline,
  not an overlap test.

Two occurrences conflict when they are booked against the same resource and
their half-open intervals share at least one instant. Occurrences on different
resources never conflict. Every conflicting pair is reported once.
