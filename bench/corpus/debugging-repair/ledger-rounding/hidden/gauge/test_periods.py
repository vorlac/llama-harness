"""Reporting period boundaries."""

import unittest
from datetime import date, timedelta

from ledger.periods import (
    Period,
    covering_months,
    month_period,
    month_range,
    parse_month_label,
    quarter_period,
)


def days_of(period):
    day = period.start
    while day < period.end:
        yield day
        day = day + timedelta(days=1)


class PeriodTests(unittest.TestCase):
    def test_a_period_excludes_the_day_it_ends_on(self):
        period = Period("test", date(2024, 1, 1), date(2024, 2, 1))
        self.assertIn(date(2024, 1, 1), period)
        self.assertIn(date(2024, 1, 31), period)
        self.assertNotIn(date(2024, 2, 1), period)

    def test_month_period_is_labelled_and_starts_on_the_first(self):
        period = month_period(2024, 2)
        self.assertEqual(period.label, "2024-02")
        self.assertEqual(period.start, date(2024, 2, 1))

    def test_month_period_covers_the_last_day_of_the_month(self):
        for year, month, last_day in (
            (2024, 1, 31),
            (2024, 2, 29),
            (2023, 2, 28),
            (2024, 4, 30),
            (2024, 12, 31),
        ):
            with self.subTest(year=year, month=month):
                self.assertIn(date(year, month, last_day), month_period(year, month))

    def test_consecutive_month_periods_are_contiguous(self):
        periods = month_range(2024, 1, 4)
        for earlier, later in zip(periods, periods[1:]):
            with self.subTest(earlier=earlier.label, later=later.label):
                self.assertEqual(earlier.end, later.start)

    def test_consecutive_month_periods_do_not_overlap(self):
        periods = month_range(2024, 1, 4)
        for earlier, later in zip(periods, periods[1:]):
            with self.subTest(earlier=earlier.label, later=later.label):
                self.assertFalse(earlier.overlaps(later))

    def test_every_day_of_a_year_belongs_to_exactly_one_month_period(self):
        periods = month_range(2024, 1, 12)
        day = date(2024, 1, 1)
        while day <= date(2024, 12, 31):
            self.assertEqual(sum(1 for period in periods if day in period), 1, day)
            day = day + timedelta(days=1)

    def test_quarter_period_covers_its_first_and_last_day(self):
        quarter = quarter_period(2024, 1)
        self.assertEqual(quarter.label, "2024-Q1")
        self.assertIn(date(2024, 1, 1), quarter)
        self.assertIn(date(2024, 3, 31), quarter)
        self.assertNotIn(date(2024, 4, 1), quarter)

    def test_month_range_wraps_across_the_year_boundary(self):
        labels = [period.label for period in month_range(2023, 11, 4)]
        self.assertEqual(labels, ["2023-11", "2023-12", "2024-01", "2024-02"])

    def test_parse_month_label_matches_month_period(self):
        self.assertEqual(parse_month_label("2024-07"), month_period(2024, 7))

    def test_parse_month_label_rejects_junk(self):
        with self.assertRaises(ValueError):
            parse_month_label("July 2024")

    def test_covering_months_returns_one_period_per_distinct_month(self):
        dates = [date(2024, 1, 5), date(2024, 1, 27), date(2024, 3, 2)]
        self.assertEqual(
            [period.label for period in covering_months(dates)], ["2024-01", "2024-03"]
        )

    def test_period_rejects_an_end_before_its_start(self):
        with self.assertRaises(ValueError):
            Period("backwards", date(2024, 2, 1), date(2024, 1, 1))
