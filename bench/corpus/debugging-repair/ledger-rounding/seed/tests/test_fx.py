"""Rate lookup and currency conversion."""

import unittest
from datetime import date
from decimal import Decimal

from ledger.fx import MissingRateError, Rate, RateTable


class RateTableTests(unittest.TestCase):
    def setUp(self):
        self.table = RateTable(
            [
                Rate(date(2024, 1, 1), "EUR", "USD", Decimal("1.1000")),
                Rate(date(2024, 2, 1), "EUR", "USD", Decimal("1.2000")),
                Rate(date(2024, 1, 1), "CHF", "USD", Decimal("0.9250")),
            ]
        )

    def test_rate_lookup_uses_the_most_recent_quote_on_or_before(self):
        table = self.table
        self.assertEqual(table.rate_on("EUR", "USD", date(2024, 1, 15)), Decimal("1.1000"))
        self.assertEqual(table.rate_on("EUR", "USD", date(2024, 1, 31)), Decimal("1.1000"))
        self.assertEqual(table.rate_on("EUR", "USD", date(2024, 2, 1)), Decimal("1.2000"))
        self.assertEqual(table.rate_on("EUR", "USD", date(2024, 6, 30)), Decimal("1.2000"))

    def test_identical_currencies_convert_unchanged(self):
        self.assertEqual(self.table.convert(12345, "USD", "USD", date(2024, 1, 10)), 12345)

    def test_conversion_rounds_half_away_from_zero(self):
        # 1.00 CHF at 0.9250 is 0.925 USD, which is not representable in cents.
        self.assertEqual(self.table.convert(100, "CHF", "USD", date(2024, 1, 10)), 93)
        self.assertEqual(self.table.convert(-100, "CHF", "USD", date(2024, 1, 10)), -93)

    def test_conversion_uses_the_rate_of_the_transaction_date(self):
        self.assertEqual(self.table.convert(10000, "EUR", "USD", date(2024, 1, 20)), 11000)
        self.assertEqual(self.table.convert(10000, "EUR", "USD", date(2024, 2, 20)), 12000)

    def test_inverse_pair_is_derived_when_not_published(self):
        self.assertEqual(self.table.convert(11000, "USD", "EUR", date(2024, 1, 20)), 10000)

    def test_rate_before_the_first_quote_is_an_error(self):
        with self.assertRaises(MissingRateError):
            self.table.rate_on("EUR", "USD", date(2023, 12, 31))

    def test_unknown_pair_is_an_error(self):
        with self.assertRaises(MissingRateError):
            self.table.rate_on("GBP", "JPY", date(2024, 1, 10))
