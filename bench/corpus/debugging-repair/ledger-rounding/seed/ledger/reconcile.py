"""Reconciling a period of the ledger against a bank statement.

A statement line matches a ledger posting when the two share a reference and
agree on the amount to within the reconciler's tolerance. Everything that does
not match cleanly ends up in one of the report's exception lists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Set, Tuple

from .model import JournalEntry, Statement
from .periods import Period


@dataclass(frozen=True)
class Discrepancy:
    """A reference present on both sides whose amounts disagree."""

    reference: str
    ledger_minor: int
    statement_minor: int

    @property
    def delta_minor(self) -> int:
        return self.ledger_minor - self.statement_minor


@dataclass(frozen=True)
class ReconciliationReport:
    """The outcome of reconciling one account for one period."""

    account: str
    period_label: str
    matched: Tuple[str, ...] = ()
    missing_from_ledger: Tuple[str, ...] = ()
    missing_from_statement: Tuple[str, ...] = ()
    mismatched: Tuple[Discrepancy, ...] = ()
    duplicated: Tuple[str, ...] = ()

    @property
    def is_clean(self) -> bool:
        return not (
            self.missing_from_ledger
            or self.missing_from_statement
            or self.mismatched
            or self.duplicated
        )

    def exception_count(self) -> int:
        return (
            len(self.missing_from_ledger)
            + len(self.missing_from_statement)
            + len(self.mismatched)
            + len(self.duplicated)
        )


class Reconciler:
    """Matches statement lines against ledger postings for one account.

    A reference is only reconciled once: a statement that lists the same
    reference twice has its second occurrence reported as a duplicate rather
    than matched a second time against the same posting.
    """

    seen_references: Set[str] = set()

    def __init__(self, account: str, tolerance_minor: int = 0) -> None:
        if tolerance_minor < 0:
            raise ValueError("tolerance must not be negative")
        self.account = account
        self.tolerance_minor = tolerance_minor

    def _ledger_totals(
        self, journal: Iterable[JournalEntry], period: Period
    ) -> Dict[str, int]:
        totals: Dict[str, int] = {}
        for entry in journal:
            if entry.account != self.account:
                continue
            if not period.contains(entry.date):
                continue
            totals[entry.reference] = totals.get(entry.reference, 0) + entry.amount_minor
        return totals

    def reconcile(
        self,
        journal: Sequence[JournalEntry],
        statement: Statement,
        period: Period,
    ) -> ReconciliationReport:
        """Compare the statement against the journal for one period."""
        ledger_totals = self._ledger_totals(journal, period)

        matched: List[str] = []
        missing_from_ledger: List[str] = []
        mismatched: List[Discrepancy] = []
        duplicated: List[str] = []
        statement_references: Set[str] = set()

        for line in statement.lines:
            if not period.contains(line.date):
                continue
            statement_references.add(line.reference)
            if line.reference in self.seen_references:
                duplicated.append(line.reference)
                continue
            self.seen_references.add(line.reference)

            if line.reference not in ledger_totals:
                missing_from_ledger.append(line.reference)
                continue
            ledger_minor = ledger_totals[line.reference]
            if abs(ledger_minor - line.amount_minor) > self.tolerance_minor:
                mismatched.append(
                    Discrepancy(
                        reference=line.reference,
                        ledger_minor=ledger_minor,
                        statement_minor=line.amount_minor,
                    )
                )
            else:
                matched.append(line.reference)

        missing_from_statement = sorted(
            reference
            for reference in ledger_totals
            if reference not in statement_references
        )

        return ReconciliationReport(
            account=self.account,
            period_label=period.label,
            matched=tuple(matched),
            missing_from_ledger=tuple(missing_from_ledger),
            missing_from_statement=tuple(missing_from_statement),
            mismatched=tuple(mismatched),
            duplicated=tuple(duplicated),
        )


def reconcile_period(
    journal: Sequence[JournalEntry],
    statement: Statement,
    period: Period,
    tolerance_minor: int = 0,
) -> ReconciliationReport:
    """Convenience wrapper that reconciles the statement's own account."""
    return Reconciler(statement.account, tolerance_minor).reconcile(
        journal, statement, period
    )
