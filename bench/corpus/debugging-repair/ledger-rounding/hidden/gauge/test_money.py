"""Parsing and formatting of monetary amounts."""

import unittest

from ledger.money import (
    CurrencyError,
    exponent,
    format_amount,
    format_money,
    minor_factor,
    parse_amount,
)


class MoneyTests(unittest.TestCase):
    def test_parse_amount_reads_exact_cents(self):
        for text, expected in (
            ("0.00", 0),
            ("1.00", 100),
            ("12.34", 1234),
            ("-0.01", -1),
            ("-1240.05", -124005),
            ("1,204.99", 120499),
            (" 7.10 ", 710),
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_amount(text, "USD"), expected)

    def test_parse_amount_rounds_half_away_from_zero(self):
        for text, expected in (("0.005", 1), ("0.004", 0), ("-0.005", -1), ("2.345", 235)):
            with self.subTest(text=text):
                self.assertEqual(parse_amount(text, "USD"), expected)

    def test_format_amount_round_trips_through_parse(self):
        for minor in (0, 5, 99, 100, 123456, -1, -99, -100, -123456):
            with self.subTest(minor=minor):
                self.assertEqual(parse_amount(format_amount(minor, "USD"), "USD"), minor)

    def test_format_money_appends_the_currency_code(self):
        self.assertEqual(format_money(-2500, "EUR"), "-25.00 EUR")

    def test_currency_without_minor_units_is_formatted_whole(self):
        self.assertEqual(exponent("JPY"), 0)
        self.assertEqual(minor_factor("JPY"), 1)
        self.assertEqual(format_amount(1234, "JPY"), "1234")
        self.assertEqual(parse_amount("1234", "JPY"), 1234)

    def test_unknown_currency_is_rejected(self):
        with self.assertRaises(CurrencyError):
            parse_amount("1.00", "XYZ")

    def test_malformed_amount_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_amount("twelve", "USD")
