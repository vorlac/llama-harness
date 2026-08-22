"""Command line entry point: load the data files, report, reconcile."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from .balances import account_balances, period_balances, top_accounts
from .journal import build_journal
from .model import JournalEntry
from .money import format_amount
from .parser import load_rates, load_statement, load_transactions
from .periods import Period, month_range, parse_month_label
from .reconcile import ReconciliationReport, Reconciler

DEFAULT_DATA_DIR = "data"
DEFAULT_BASE_CURRENCY = "USD"
ACCOUNT_COLUMN = 34


def format_balances(balances: Dict[str, int], base_currency: str) -> List[str]:
    """Render a balance mapping as aligned ``account  amount`` lines."""
    lines = []
    for account in sorted(balances):
        amount = format_amount(balances[account], base_currency)
        lines.append("  %-*s %12s" % (ACCOUNT_COLUMN, account, amount))
    return lines


def format_report(report: ReconciliationReport, base_currency: str) -> List[str]:
    """Render a reconciliation report as a block of text lines."""
    lines = [
        "RECONCILIATION %s %s" % (report.account, report.period_label),
        "  matched:              %d" % len(report.matched),
        "  missing from ledger:  %s" % (", ".join(report.missing_from_ledger) or "-"),
        "  missing from statement: %s"
        % (", ".join(report.missing_from_statement) or "-"),
        "  duplicated:           %s" % (", ".join(report.duplicated) or "-"),
    ]
    if report.mismatched:
        lines.append("  amount mismatches:")
        for item in report.mismatched:
            lines.append(
                "    %-12s ledger %10s  statement %10s"
                % (
                    item.reference,
                    format_amount(item.ledger_minor, base_currency),
                    format_amount(item.statement_minor, base_currency),
                )
            )
    else:
        lines.append("  amount mismatches:    -")
    return lines


def report_lines(
    journal: Sequence[JournalEntry],
    periods: Sequence[Period],
    base_currency: str,
) -> List[str]:
    """Render the whole-ledger and per-period balance sections."""
    lines = ["BALANCES all periods"]
    overall = account_balances(journal, base_currency)
    lines.extend(format_balances(overall, base_currency))
    lines.append("  largest movements: %s" % ", ".join(top_accounts(overall)))
    for period in periods:
        lines.append("")
        lines.append("BALANCES %s" % period.label)
        lines.extend(format_balances(period_balances(journal, period, base_currency), base_currency))
    return lines


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ledger balance and reconciliation report")
    parser.add_argument(
        "data_dir",
        nargs="?",
        default=DEFAULT_DATA_DIR,
        help="directory holding transactions.csv, rates.csv and the statement",
    )
    parser.add_argument("--base", default=DEFAULT_BASE_CURRENCY, help="reporting currency")
    parser.add_argument(
        "--from-month", default="2024-01", help="first reporting month, YYYY-MM"
    )
    parser.add_argument("--months", type=int, default=3, help="number of months to report")
    parser.add_argument(
        "--statement",
        default="statement-2024-01.csv",
        help="statement file inside the data directory",
    )
    parser.add_argument(
        "--tolerance", type=int, default=0, help="reconciliation tolerance in minor units"
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    data_dir = Path(args.data_dir)

    transactions = load_transactions(data_dir / "transactions.csv")
    rates = load_rates(data_dir / "rates.csv")
    journal = build_journal(transactions, rates, args.base)

    first = parse_month_label(args.from_month)
    periods = month_range(first.start.year, first.start.month, args.months)

    print("LEDGER REPORT")
    print("  base currency: %s" % args.base)
    print("  transactions:  %d" % len(transactions))
    print("  entries:       %d" % len(journal))
    print("")
    for line in report_lines(journal, periods, args.base):
        print(line)

    statement_path = data_dir / args.statement
    if statement_path.exists():
        statement = load_statement(statement_path)
        statement_period = parse_month_label(args.from_month)
        reconciler = Reconciler(statement.account, args.tolerance)
        report = reconciler.reconcile(journal, statement, statement_period)
        print("")
        for line in format_report(report, args.base):
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
