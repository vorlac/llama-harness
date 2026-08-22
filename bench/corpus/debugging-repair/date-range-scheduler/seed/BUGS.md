# Open field reports

Four reports against `date-range-scheduler` 1.4.0. Each was reproduced by the
reporter against this working copy. None names a file, a function or a line:
locating the fault is the work.

`docs/SEMANTICS.md` is the reference. Where the code and that document
disagree, the document is right.

## FR-1 — an occurrence in a spring-forward hour lands before the transition

On the one morning a year a zone jumps its clocks forward, a wall-clock time
that falls inside the skipped hour resolves to an instant *before* the
transition rather than after it. The occurrence lands an hour earlier than the
same wall clock lands on every other day of the series. Zones that jump forward
by an hour at 02:00 and zones that jump at 03:00 both show it.

The other two branches of the same conversion are correct and must stay
correct: a wall clock in an hour the fall-back transition repeats still resolves
to its first pass, and wall clocks either side of a gap keep their own hour.

## FR-2 — a monthly series skips the months that are too short for its anchor

A monthly series anchored on a day of the month that some months do not have
drops those months entirely instead of landing on their last day. A series
anchored on the 31st produces no occurrence at all in February, April, June,
September or November. With a count bound, the series also runs far past the
date it was meant to end on, because the dropped months are not counted against
the bound.

The clamp must not become sticky: an anchor day is the basis for every later
month, so a series anchored on the 31st that lands on 30 April must be back on
31 May.

## FR-3 — an UNTIL bound is off by the zone offset

The inclusive `until` bound of a recurrence rule is compared against the wrong
clock, so the bound is wrong by exactly the zone's offset from UTC. In a zone
behind UTC the series emits one occurrence past the bound; in a zone ahead of
UTC it drops the last occurrence that should have been inside it. A series whose
local time sits in the middle of the day looks unaffected, which is why this
went unnoticed: only evening and early-morning series are close enough to the
cutoff for the offset to cross it.

`until` stays inclusive, and a count-bounded series must still return exactly
`count` occurrences.

## FR-4 — back-to-back bookings are reported as conflicts

Every interval in this library is half-open, `[start, end)`. The overlap
predicate does not agree: an interval that ends exactly when the next one
begins is reported as overlapping it, with a shared duration of zero. A morning
of consecutive meetings in one room reports a conflict for every adjacent pair.

Interval merging is a union, not an overlap test, and deliberately coalesces
touching intervals. It is correct as it stands and is not part of this report.
