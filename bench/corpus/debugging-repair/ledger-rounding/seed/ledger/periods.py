"""Reporting periods.

A :class:`Period` is a half-open range of dates: ``start`` belongs to the
period, ``end`` does not. Half-open ranges are used so that consecutive periods
tile the calendar without a gap and without an overlap -- the day that ends one
period is the day that starts the next.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Iterable, List, Tuple

MONTH_LABEL = "%04d-%02d"
QUARTER_LABEL = "%04d-Q%d"


@dataclass(frozen=True)
class Period:
    """A labelled half-open date range ``[start, end)``."""

    label: str
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError("period %r ends before it starts" % (self.label,))

    def contains(self, when: date) -> bool:
        """Return True when `when` falls inside this period."""
        return self.start <= when < self.end

    def __contains__(self, when: date) -> bool:
        return self.contains(when)

    def days(self) -> int:
        """Return the number of days the period spans."""
        return (self.end - self.start).days

    def overlaps(self, other: "Period") -> bool:
        """Return True when this period shares at least one day with `other`."""
        return self.start < other.end and other.start < self.end


def month_period(year: int, month: int) -> Period:
    """Return the reporting period covering a single calendar month."""
    if not 1 <= month <= 12:
        raise ValueError("month out of range: %r" % (month,))
    days_in_month = calendar.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, days_in_month)
    return Period(MONTH_LABEL % (year, month), start, end)


def next_month(year: int, month: int) -> Tuple[int, int]:
    """Return the ``(year, month)`` pair that follows the given month."""
    if month == 12:
        return (year + 1, 1)
    return (year, month + 1)


def month_range(year: int, month: int, count: int) -> List[Period]:
    """Return `count` consecutive monthly periods starting at the given month."""
    if count < 1:
        raise ValueError("count must be positive")
    periods = []
    cursor = (year, month)
    for _ in range(count):
        periods.append(month_period(cursor[0], cursor[1]))
        cursor = next_month(cursor[0], cursor[1])
    return periods


def quarter_period(year: int, quarter: int) -> Period:
    """Return the reporting period covering a calendar quarter."""
    if not 1 <= quarter <= 4:
        raise ValueError("quarter out of range: %r" % (quarter,))
    first_month = (quarter - 1) * 3 + 1
    last_month = first_month + 2
    return Period(
        QUARTER_LABEL % (year, quarter),
        month_period(year, first_month).start,
        month_period(year, last_month).end,
    )


def parse_month_label(label: str) -> Period:
    """Turn a ``YYYY-MM`` label into the matching monthly period."""
    parts = label.split("-")
    if len(parts) != 2:
        raise ValueError("expected a YYYY-MM label, got %r" % (label,))
    return month_period(int(parts[0]), int(parts[1]))


def covering_months(dates: Iterable[date]) -> List[Period]:
    """Return the monthly periods needed to cover every date in `dates`."""
    seen = sorted({(d.year, d.month) for d in dates})
    return [month_period(year, month) for year, month in seen]
