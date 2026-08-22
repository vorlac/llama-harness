"""Posting transactions into journal entries."""

import unittest
from datetime import date
from decimal import Decimal

from ledger.fx import Rate, RateTable
from ledger.journal import accounts_in, build_journal, entries_for, post_transaction, references_in
from ledger.model import Split, Transaction

from tests import fixtures


def make_transaction(amount_minor, splits, currency="USD", when=date(2024, 1, 10)):
    return Transaction(
        date=when,
        reference="T-1",
        description="test",
        currency=currency,
        amount_minor=amount_minor,
        source_account="assets:checking",
        splits=tuple(splits),
    )


class PostingTests(unittest.TestCase):
    def setUp(self):
        self.simple_rates = RateTable(
            [Rate(date(2024, 1, 1), "EUR", "USD", Decimal("1.2500"))]
        )

    def test_posting_creates_one_entry_per_account_touched(self):
        transaction = make_transaction(
            30000, [Split("expenses:a"), Split("expenses:b"), Split("expenses:c")]
        )
        entries = post_transaction(transaction, self.simple_rates, "USD")
        self.assertEqual(len(entries), 4)
        self.assertEqual(
            [entry.account for entry in entries],
            ["assets:checking", "expenses:a", "expenses:b", "expenses:c"],
        )

    def test_source_entry_carries_the_negated_transaction_amount(self):
        transaction = make_transaction(12345, [Split("expenses:a")])
        entries = post_transaction(transaction, self.simple_rates, "USD")
        self.assertEqual(entries[0].amount_minor, -12345)
        self.assertEqual(entries[0].base_amount_minor, -12345)

    def test_foreign_currency_entries_carry_both_amounts(self):
        transaction = make_transaction(10000, [Split("expenses:a")], currency="EUR")
        entries = post_transaction(transaction, self.simple_rates, "USD")
        self.assertEqual(entries[1].currency, "EUR")
        self.assertEqual(entries[1].amount_minor, 10000)
        self.assertEqual(entries[1].base_amount_minor, 12500)

    def test_every_entry_keeps_the_transaction_date_and_reference(self):
        transaction = make_transaction(500, [Split("expenses:a"), Split("expenses:b")])
        for entry in post_transaction(transaction, self.simple_rates, "USD"):
            with self.subTest(account=entry.account):
                self.assertEqual(entry.date, date(2024, 1, 10))
                self.assertEqual(entry.reference, "T-1")

    def test_weighted_split_gives_the_heavier_account_more(self):
        transaction = make_transaction(
            90000, [Split("expenses:a", 2), Split("expenses:b", 1)]
        )
        entries = post_transaction(transaction, self.simple_rates, "USD")
        self.assertEqual(entries[1].amount_minor, 60000)
        self.assertEqual(entries[2].amount_minor, 30000)

    def test_journal_covers_every_transaction(self):
        journal = fixtures.journal()
        self.assertEqual(len(references_in(journal)), len(fixtures.transactions()))
        self.assertIn("assets:checking", accounts_in(journal))

    def test_entries_for_filters_by_account(self):
        picked = entries_for(fixtures.journal(), "assets:checking")
        self.assertTrue(picked)
        self.assertTrue(all(entry.account == "assets:checking" for entry in picked))

    def test_build_journal_preserves_transaction_order(self):
        transactions = fixtures.transactions()
        built = build_journal(transactions[:5], fixtures.rates(), "USD")
        self.assertEqual(
            [entry.reference for entry in built[:2]],
            [transactions[0].reference, transactions[0].reference],
        )
        self.assertEqual(built[-1].reference, transactions[4].reference)
