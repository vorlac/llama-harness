"""Shared test data.

The heavier loaders parse the sample data in ``data/`` once per process and
hand back the same object every time, so a suite that reads the whole book of
accounts pays for it once. A test that needs to mutate a journal takes its own
copy first.
"""

import functools
from pathlib import Path

from ledger.journal import build_journal
from ledger.parser import load_rates, load_statement, load_transactions

ROOT = Path(__file__).resolve().parent.parent

BASE_CURRENCY = "USD"


def data_dir():
    return ROOT / "data"


@functools.lru_cache(maxsize=None)
def transactions():
    return load_transactions(data_dir() / "transactions.csv")


@functools.lru_cache(maxsize=None)
def rates():
    return load_rates(data_dir() / "rates.csv")


@functools.lru_cache(maxsize=None)
def journal():
    return build_journal(transactions(), rates(), BASE_CURRENCY)


@functools.lru_cache(maxsize=None)
def january_statement():
    return load_statement(data_dir() / "statement-2024-01.csv")
