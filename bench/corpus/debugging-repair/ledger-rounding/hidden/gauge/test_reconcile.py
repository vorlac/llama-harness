"""Matching a bank statement against the ledger.

Each test uses its own reference prefix so that the reconciled references of one
scenario never collide with those of another.
"""

import unittest
from datetime import date

from ledger.model import JournalEntry, Statement, StatementLine
from ledger.periods import month_period
from ledger.reconcile import Reconciler, reconcile_period

ACCOUNT = "assets:checking"
PERIOD = month_period(2024, 5)


def ledger_entry(reference, minor, day=10):
    return JournalEntry(
        date=date(2024, 5, day),
        reference=reference,
        account=ACCOUNT,
        currency="USD",
        amount_minor=minor,
        base_amount_minor=minor,
    )


def statement_line(reference, minor, day=10):
    return StatementLine(date=date(2024, 5, day), reference=reference, amount_minor=minor)


def statement(lines):
    return Statement(account=ACCOUNT, currency="USD", lines=tuple(lines))


def scenario(prefix):
    """A three-line statement that agrees with the ledger."""
    journal = [
        ledger_entry(prefix + "-1", -10000, 3),
        ledger_entry(prefix + "-2", -25050, 11),
        ledger_entry(prefix + "-3", 90000, 20),
    ]
    lines = statement(
        [
            statement_line(prefix + "-1", -10000, 3),
            statement_line(prefix + "-2", -25050, 11),
            statement_line(prefix + "-3", 90000, 20),
        ]
    )
    return journal, lines


class ReconcileTests(unittest.TestCase):
    def test_a_clean_statement_reconciles_with_no_exceptions(self):
        journal, lines = scenario("CLEAN")
        report = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(report.matched, ("CLEAN-1", "CLEAN-2", "CLEAN-3"))
        self.assertTrue(report.is_clean)
        self.assertEqual(report.exception_count(), 0)

    def test_reconciling_the_same_statement_twice_gives_the_same_report(self):
        journal, lines = scenario("TWICE")
        reconciler = Reconciler(ACCOUNT)
        first = reconciler.reconcile(journal, lines, PERIOD)
        second = reconciler.reconcile(journal, lines, PERIOD)
        self.assertEqual(second, first)

    def test_two_reconcilers_agree_on_the_same_statement(self):
        journal, lines = scenario("PAIR")
        first = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        second = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(second, first)

    def test_reconciling_two_accounts_does_not_mix_their_statements(self):
        journal, lines = scenario("SPLIT")
        other_journal = [
            JournalEntry(
                date=date(2024, 5, 3),
                reference="SPLIT-1",
                account="liabilities:card",
                currency="USD",
                amount_minor=-10000,
                base_amount_minor=-10000,
            )
        ]
        other_statement = Statement(
            account="liabilities:card",
            currency="USD",
            lines=(
                StatementLine(
                    date=date(2024, 5, 3), reference="SPLIT-1", amount_minor=-10000
                ),
            ),
        )
        Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        report = Reconciler("liabilities:card").reconcile(
            other_journal, other_statement, PERIOD
        )
        self.assertEqual(report.matched, ("SPLIT-1",))
        self.assertTrue(report.is_clean)

    def test_a_reference_repeated_inside_one_statement_is_flagged_as_duplicate(self):
        journal = [ledger_entry("DUP-1", -4200)]
        lines = statement([statement_line("DUP-1", -4200), statement_line("DUP-1", -4200)])
        report = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(report.matched, ("DUP-1",))
        self.assertEqual(report.duplicated, ("DUP-1",))

    def test_a_statement_line_with_no_ledger_posting_is_reported(self):
        journal = [ledger_entry("MISS-1", -4200)]
        lines = statement([statement_line("MISS-1", -4200), statement_line("MISS-2", -999)])
        report = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(report.missing_from_ledger, ("MISS-2",))
        self.assertEqual(report.missing_from_statement, ())

    def test_a_posting_absent_from_the_statement_is_reported(self):
        journal = [ledger_entry("GAP-1", -4200), ledger_entry("GAP-2", -1000)]
        lines = statement([statement_line("GAP-1", -4200)])
        report = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(report.missing_from_statement, ("GAP-2",))
        self.assertEqual(report.missing_from_ledger, ())

    def test_an_amount_disagreement_reports_both_sides(self):
        journal = [ledger_entry("DELTA-1", -4200)]
        lines = statement([statement_line("DELTA-1", -4500)])
        report = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(len(report.mismatched), 1)
        discrepancy = report.mismatched[0]
        self.assertEqual(discrepancy.reference, "DELTA-1")
        self.assertEqual(discrepancy.ledger_minor, -4200)
        self.assertEqual(discrepancy.statement_minor, -4500)
        self.assertEqual(discrepancy.delta_minor, 300)

    def test_a_tolerance_absorbs_small_disagreements(self):
        journal = [ledger_entry("TOL-1", -4200)]
        lines = statement([statement_line("TOL-1", -4201)])
        report = Reconciler(ACCOUNT, tolerance_minor=1).reconcile(journal, lines, PERIOD)
        self.assertTrue(report.is_clean)

    def test_postings_split_over_several_entries_are_summed(self):
        journal = [ledger_entry("SUM-1", -2000), ledger_entry("SUM-1", -2200)]
        lines = statement([statement_line("SUM-1", -4200)])
        report = Reconciler(ACCOUNT).reconcile(journal, lines, PERIOD)
        self.assertEqual(report.matched, ("SUM-1",))

    def test_lines_outside_the_period_are_left_for_another_report(self):
        journal = [ledger_entry("OUT-1", -4200, 12)]
        lines = statement(
            [statement_line("OUT-1", -4200, 12), statement_line("OUT-2", -100, 12)]
        )
        report = reconcile_period(journal, lines, month_period(2024, 6))
        self.assertEqual(report.matched, ())
        self.assertEqual(report.missing_from_ledger, ())
        self.assertEqual(report.period_label, "2024-06")

    def test_a_negative_tolerance_is_rejected(self):
        with self.assertRaises(ValueError):
            Reconciler(ACCOUNT, tolerance_minor=-1)
