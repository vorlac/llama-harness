"""Readers for the three CSV inputs the ledger consumes.

transactions.csv
    date,reference,description,currency,amount,source,targets

    ``targets`` is a pipe-separated list of destination accounts. A destination
    may carry a relative weight after an ``@``; the weight defaults to 1, so
    ``expenses:a|expenses:b`` splits an amount evenly and
    ``expenses:a@3|expenses:b@1`` splits it three-to-one.

rates.csv
    date,base,quote,rate

statement CSV
    date,reference,description,amount

    with the account and currency carried in a two-line header::

        # account: assets:checking
        # currency: USD
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable, List, Tuple

from .fx import Rate, RateTable
from .model import Split, Statement, StatementLine, Transaction
from .money import parse_amount

TRANSACTION_COLUMNS = [
    "date",
    "reference",
    "description",
    "currency",
    "amount",
    "source",
    "targets",
]
RATE_COLUMNS = ["date", "base", "quote", "rate"]
STATEMENT_COLUMNS = ["date", "reference", "description", "amount"]


class ParseError(ValueError):
    """Raised when an input row cannot be turned into a record."""


def parse_date(text: str) -> date:
    try:
        return datetime.strptime(text.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise ParseError("malformed date %r" % (text,))


def _require_columns(reader: csv.DictReader, expected: Iterable[str], source: Path) -> None:
    missing = [name for name in expected if name not in (reader.fieldnames or [])]
    if missing:
        raise ParseError(
            "%s is missing column(s): %s" % (source, ", ".join(missing))
        )


def parse_targets(text: str) -> Tuple[Split, ...]:
    """Turn the ``targets`` cell into a tuple of splits."""
    splits = []
    for chunk in text.split("|"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "@" in chunk:
            account, _, weight_text = chunk.partition("@")
            try:
                weight = int(weight_text)
            except ValueError:
                raise ParseError("malformed target weight in %r" % (chunk,))
        else:
            account, weight = chunk, 1
        account = account.strip()
        if not account:
            raise ParseError("empty target account in %r" % (text,))
        if weight <= 0:
            raise ParseError("target weight must be positive in %r" % (chunk,))
        splits.append(Split(account=account, weight=weight))
    if not splits:
        raise ParseError("row has no target accounts")
    return tuple(splits)


def load_transactions(path) -> List[Transaction]:
    """Read a transactions CSV into Transaction records, in file order."""
    path = Path(path)
    transactions: List[Transaction] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        _require_columns(reader, TRANSACTION_COLUMNS, path)
        for lineno, row in enumerate(reader, start=2):
            if not (row.get("reference") or "").strip():
                raise ParseError("%s line %d: missing reference" % (path, lineno))
            currency = (row["currency"] or "").strip()
            source = (row["source"] or "").strip()
            if not source:
                raise ParseError("%s line %d: missing source account" % (path, lineno))
            try:
                amount_minor = parse_amount(row["amount"], currency)
            except ValueError as exc:
                raise ParseError("%s line %d: %s" % (path, lineno, exc))
            transactions.append(
                Transaction(
                    date=parse_date(row["date"]),
                    reference=row["reference"].strip(),
                    description=(row.get("description") or "").strip(),
                    currency=currency,
                    amount_minor=amount_minor,
                    source_account=source,
                    splits=parse_targets(row["targets"] or ""),
                )
            )
    return transactions


def load_rates(path) -> RateTable:
    """Read a rates CSV into a RateTable."""
    path = Path(path)
    rates: List[Rate] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        _require_columns(reader, RATE_COLUMNS, path)
        for lineno, row in enumerate(reader, start=2):
            try:
                value = Decimal((row["rate"] or "").strip())
            except InvalidOperation:
                raise ParseError("%s line %d: malformed rate %r" % (path, lineno, row["rate"]))
            rates.append(
                Rate(
                    date=parse_date(row["date"]),
                    base=(row["base"] or "").strip(),
                    quote=(row["quote"] or "").strip(),
                    rate=value,
                )
            )
    return RateTable(rates)


def _statement_header(path: Path) -> Tuple[str, str, int]:
    account = ""
    currency = ""
    skipped = 0
    with path.open(encoding="utf-8") as handle:
        for raw in handle:
            if not raw.startswith("#"):
                break
            skipped += 1
            key, _, value = raw[1:].partition(":")
            key = key.strip().lower()
            if key == "account":
                account = value.strip()
            elif key == "currency":
                currency = value.strip()
    if not account or not currency:
        raise ParseError("%s: header must declare both account and currency" % path)
    return account, currency, skipped


def load_statement(path) -> Statement:
    """Read a statement CSV, including its commented header, into a Statement."""
    path = Path(path)
    account, currency, skipped = _statement_header(path)
    lines: List[StatementLine] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for _ in range(skipped):
            handle.readline()
        reader = csv.DictReader(handle)
        _require_columns(reader, STATEMENT_COLUMNS, path)
        for lineno, row in enumerate(reader, start=skipped + 2):
            try:
                amount_minor = parse_amount(row["amount"], currency)
            except ValueError as exc:
                raise ParseError("%s line %d: %s" % (path, lineno, exc))
            lines.append(
                StatementLine(
                    date=parse_date(row["date"]),
                    reference=(row["reference"] or "").strip(),
                    amount_minor=amount_minor,
                    description=(row.get("description") or "").strip(),
                )
            )
    return Statement(account=account, currency=currency, lines=tuple(lines))
