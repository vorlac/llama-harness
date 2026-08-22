"""Aggregating journal entries into balances.

Balances are reported in the ledger's base currency, so aggregation reads the
``base_amount_minor`` field of each entry. The result maps an account name to
its balance in whole minor units of the base currency.
"""

from __future__ import annotations

from typing import Dict, Iterable, List

from .model import JournalEntry
from .money import minor_factor
from .periods import Period


def account_balances(
    entries: Iterable[JournalEntry], base_currency: str = "USD"
) -> Dict[str, int]:
    """Return the closing balance of every account touched by `entries`."""
    scale = minor_factor(base_currency)
    running: Dict[str, float] = {}
    for entry in entries:
        amount = entry.base_amount_minor / scale
        running[entry.account] = running.get(entry.account, 0.0) + amount
    return {account: int(total * scale) for account, total in sorted(running.items())}


def period_balances(
    journal: Iterable[JournalEntry], period: Period, base_currency: str = "USD"
) -> Dict[str, int]:
    """Return the balances produced by the entries that fall inside `period`."""
    inside = [entry for entry in journal if period.contains(entry.date)]
    return account_balances(inside, base_currency)


def account_balance(
    entries: Iterable[JournalEntry], account: str, base_currency: str = "USD"
) -> int:
    """Return the balance of a single account, zero when it is never touched."""
    return account_balances(entries, base_currency).get(account, 0)


def balances_by_period(
    journal: Iterable[JournalEntry], periods: Iterable[Period], base_currency: str = "USD"
) -> "Dict[str, Dict[str, int]]":
    """Return a mapping of period label to that period's balances."""
    journal = list(journal)
    return {
        period.label: period_balances(journal, period, base_currency)
        for period in periods
    }


def subtotal(balances: Dict[str, int], prefix: str) -> int:
    """Sum every balance whose account name starts with `prefix`."""
    return sum(
        amount for account, amount in balances.items() if account.startswith(prefix)
    )


def top_accounts(balances: Dict[str, int], limit: int = 5) -> List[str]:
    """Return the accounts with the largest absolute balances, largest first."""
    ordered = sorted(balances.items(), key=lambda item: (-abs(item[1]), item[0]))
    return [account for account, _ in ordered[:limit]]
