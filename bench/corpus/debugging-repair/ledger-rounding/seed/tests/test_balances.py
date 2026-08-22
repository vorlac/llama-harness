"""Aggregating journal entries into account and period balances."""

import unittest
from datetime import date

from ledger.balances import (
    account_balance,
    account_balances,
    balances_by_period,
    period_balances,
    subtotal,
    top_accounts,
)
from ledger.model import JournalEntry
from ledger.periods import month_period, month_range

from tests import fixtures


def entry(when, account, minor, reference="R-1"):
    return JournalEntry(
        date=when,
        reference=reference,
        account=account,
        currency="USD",
        amount_minor=minor,
        base_amount_minor=minor,
    )


JANUARY_ENTRIES = [
    entry(date(2024, 1, 1), "assets:checking", -25000, "R-1"),
    entry(date(2024, 1, 1), "expenses:rent", 25000, "R-1"),
    entry(date(2024, 1, 15), "assets:checking", -12550, "R-2"),
    entry(date(2024, 1, 15), "expenses:office", 12550, "R-2"),
    entry(date(2024, 1, 30), "assets:checking", -7525, "R-3"),
    entry(date(2024, 1, 30), "expenses:office", 7525, "R-3"),
    entry(date(2024, 1, 31), "assets:checking", -40000, "R-4"),
    entry(date(2024, 1, 31), "expenses:rent", 40000, "R-4"),
    entry(date(2024, 2, 5), "assets:checking", -5000, "R-5"),
    entry(date(2024, 2, 5), "expenses:office", 5000, "R-5"),
]


class BalanceTests(unittest.TestCase):
    def test_period_balances_exclude_activity_from_other_months(self):
        balances = period_balances(JANUARY_ENTRIES, month_period(2024, 1))
        self.assertEqual(balances["expenses:office"], 20075)
        february = period_balances(JANUARY_ENTRIES, month_period(2024, 2))
        self.assertEqual(february["expenses:office"], 5000)

    def test_balances_by_period_is_keyed_by_period_label(self):
        monthly = balances_by_period(JANUARY_ENTRIES, month_range(2024, 1, 2))
        self.assertEqual(sorted(monthly), ["2024-01", "2024-02"])
        self.assertEqual(monthly["2024-02"]["expenses:office"], 5000)

    def test_balances_are_reported_as_integer_minor_units(self):
        balances = account_balances(fixtures.journal())
        self.assertTrue(all(isinstance(amount, int) for amount in balances.values()))

    def test_account_balance_of_an_untouched_account_is_zero(self):
        self.assertEqual(account_balance(JANUARY_ENTRIES, "expenses:travel"), 0)

    def test_account_balance_matches_the_full_mapping(self):
        balances = account_balances(JANUARY_ENTRIES)
        self.assertEqual(
            account_balance(JANUARY_ENTRIES, "expenses:rent"), balances["expenses:rent"]
        )

    def test_subtotal_adds_up_accounts_sharing_a_prefix(self):
        balances = account_balances(JANUARY_ENTRIES)
        self.assertEqual(subtotal(balances, "expenses:"), 90075)
        self.assertEqual(subtotal(balances, "assets:"), -90075)

    def test_top_accounts_orders_by_absolute_size(self):
        balances = account_balances(JANUARY_ENTRIES)
        self.assertEqual(top_accounts(balances, 2), ["assets:checking", "expenses:rent"])

    def test_balances_are_sorted_by_account_name(self):
        balances = account_balances(JANUARY_ENTRIES)
        self.assertEqual(list(balances), sorted(balances))
