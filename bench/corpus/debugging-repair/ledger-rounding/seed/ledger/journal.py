"""Expanding transactions into journal entries.

A transaction moves ``amount_minor`` out of its source account and into its
destination accounts. Posting it produces one entry crediting the source with
the negated amount and one entry per destination debited with that
destination's share of the amount.

Each entry carries the amount twice: once in the currency the transaction was
written in, and once converted into the ledger's base currency using the rate
in force on the transaction date.
"""

from __future__ import annotations

from typing import Iterable, List, Sequence

from .allocation import allocate
from .fx import RateTable
from .model import JournalEntry, Transaction


def post_transaction(
    transaction: Transaction, rates: RateTable, base_currency: str
) -> List[JournalEntry]:
    """Return the journal entries produced by a single transaction."""
    weights = [split.weight for split in transaction.splits]
    shares = allocate(transaction.amount_minor, weights)

    base_total = rates.convert(
        transaction.amount_minor,
        transaction.currency,
        base_currency,
        transaction.date,
    )
    base_shares = allocate(base_total, weights)

    entries = [
        JournalEntry(
            date=transaction.date,
            reference=transaction.reference,
            account=transaction.source_account,
            currency=transaction.currency,
            amount_minor=-transaction.amount_minor,
            base_amount_minor=-base_total,
            description=transaction.description,
        )
    ]
    for split, share, base_share in zip(transaction.splits, shares, base_shares):
        entries.append(
            JournalEntry(
                date=transaction.date,
                reference=transaction.reference,
                account=split.account,
                currency=transaction.currency,
                amount_minor=share,
                base_amount_minor=base_share,
                description=transaction.description,
            )
        )
    return entries


def build_journal(
    transactions: Iterable[Transaction], rates: RateTable, base_currency: str
) -> List[JournalEntry]:
    """Post every transaction, preserving input order."""
    journal: List[JournalEntry] = []
    for transaction in transactions:
        journal.extend(post_transaction(transaction, rates, base_currency))
    return journal


def entries_for(journal: Sequence[JournalEntry], account: str) -> List[JournalEntry]:
    """Return the entries posted against a single account, in journal order."""
    return [entry for entry in journal if entry.account == account]


def accounts_in(journal: Iterable[JournalEntry]) -> List[str]:
    """Return every account name mentioned by the journal, sorted."""
    return sorted({entry.account for entry in journal})


def references_in(journal: Iterable[JournalEntry]) -> List[str]:
    """Return every transaction reference in the journal, sorted and de-duplicated."""
    return sorted({entry.reference for entry in journal})
