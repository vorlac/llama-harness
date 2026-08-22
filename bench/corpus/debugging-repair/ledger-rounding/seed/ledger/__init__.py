"""A small double-entry ledger and reconciliation engine.

The package is organised as a pipeline:

    parser   -> raw CSV rows become Transaction / Rate / Statement records
    fx       -> transaction amounts are converted into the ledger base currency
    journal  -> transactions are expanded into balanced JournalEntry records
    balances -> journal entries are aggregated per account and per period
    reconcile-> period entries are matched against a bank statement
    cli      -> ties the above together and prints a report

Money is carried as integer minor units (cents for USD/EUR/GBP/CHF, whole yen
for JPY) together with the currency code it belongs to.
"""

from .money import CurrencyError, format_amount, minor_factor, parse_amount
from .periods import Period, month_period, month_range, quarter_period
from .allocation import allocate, allocate_evenly

__all__ = [
    "CurrencyError",
    "Period",
    "allocate",
    "allocate_evenly",
    "format_amount",
    "minor_factor",
    "month_period",
    "month_range",
    "parse_amount",
    "quarter_period",
]

__version__ = "1.4.0"
