"""End-to-end behaviour of the command line report."""

import contextlib
import io
import unittest

from ledger.cli import format_balances, format_report, main
from ledger.reconcile import Discrepancy, ReconciliationReport

from tests import fixtures


def run_main(argv):
    """main's exit code and everything it printed."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        exit_code = main(argv)
    return exit_code, buffer.getvalue()


class CommandLineTests(unittest.TestCase):
    def test_balances_are_formatted_one_account_per_line(self):
        lines = format_balances(
            {"expenses:office": 12550, "assets:checking": -12550}, "USD"
        )
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].strip().startswith("assets:checking"))
        self.assertTrue(lines[0].strip().endswith("-125.50"))
        self.assertTrue(lines[1].strip().endswith("125.50"))

    def test_reconciliation_block_lists_every_exception_kind(self):
        report = ReconciliationReport(
            account="assets:checking",
            period_label="2024-01",
            matched=("A-1",),
            missing_from_ledger=("A-2",),
            missing_from_statement=("A-3",),
            mismatched=(Discrepancy("A-4", -100, -250),),
            duplicated=("A-5",),
        )
        text = "\n".join(format_report(report, "USD"))
        self.assertIn("RECONCILIATION assets:checking 2024-01", text)
        for reference in ("A-2", "A-3", "A-4", "A-5"):
            with self.subTest(reference=reference):
                self.assertIn(reference, text)
        self.assertIn("-1.00", text)
        self.assertIn("-2.50", text)

    def test_main_prints_a_section_for_every_requested_month(self):
        exit_code, out = run_main(
            [str(fixtures.data_dir()), "--from-month", "2024-01", "--months", "3"]
        )
        self.assertEqual(exit_code, 0)
        self.assertIn("LEDGER REPORT", out)
        for label in ("2024-01", "2024-02", "2024-03"):
            with self.subTest(label=label):
                self.assertIn("BALANCES %s" % label, out)
        self.assertIn("RECONCILIATION assets:checking 2024-01", out)
        self.assertIn("assets:checking", out)

    def test_main_reports_every_transaction_it_loaded(self):
        _exit_code, out = run_main([str(fixtures.data_dir()), "--months", "1"])
        self.assertIn("transactions:  %d" % len(fixtures.transactions()), out)
