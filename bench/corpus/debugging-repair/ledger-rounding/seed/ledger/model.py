"""Record types passed between the stages of the pipeline.

Every record is frozen: once a row has been parsed, nothing downstream edits it
in place, so a journal can be rebuilt from the same input as many times as the
caller likes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Tuple


@dataclass(frozen=True)
class Split:
    """One destination of a transaction, with its relative weight."""

    account: str
    weight: int = 1


@dataclass(frozen=True)
class Transaction:
    """A single movement of money out of one account into one or more others."""

    date: date
    reference: str
    description: str
    currency: str
    amount_minor: int
    source_account: str
    splits: Tuple[Split, ...] = field(default_factory=tuple)

    def accounts(self) -> Tuple[str, ...]:
        """Return every account the transaction touches, source first."""
        return (self.source_account,) + tuple(split.account for split in self.splits)


@dataclass(frozen=True)
class JournalEntry:
    """One posting: a signed amount against a single account.

    ``amount_minor`` is denominated in ``currency``; ``base_amount_minor`` is
    the same posting converted into the ledger's base currency using the rate
    that applied on ``date``.
    """

    date: date
    reference: str
    account: str
    currency: str
    amount_minor: int
    base_amount_minor: int
    description: str = ""


@dataclass(frozen=True)
class StatementLine:
    """One line of a bank statement."""

    date: date
    reference: str
    amount_minor: int
    description: str = ""


@dataclass(frozen=True)
class Statement:
    """A bank statement for one account, in one currency."""

    account: str
    currency: str
    lines: Tuple[StatementLine, ...] = field(default_factory=tuple)

    def references(self) -> Tuple[str, ...]:
        return tuple(line.reference for line in self.lines)

    def total_minor(self) -> int:
        return sum(line.amount_minor for line in self.lines)
