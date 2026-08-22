"""Shared test data for the graded suite.

The heavier loaders parse the sample data once per process and hand back the
same object every time; a test that needs to mutate a journal takes its own
copy first.

The data is the copy beside this file, not the working tree's ``data/``: the
assertions were calibrated against these rows, and a working copy whose data
has drifted is still measured against the data the task was set on.
"""

import functools
from pathlib import Path

from ledger.journal import build_journal
from ledger.parser import load_rates, load_statement, load_transactions

GAUGE = Path(__file__).resolve().parent
ROOT = GAUGE.parent

BASE_CURRENCY = "USD"


def data_dir():
    return GAUGE / "data"


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
