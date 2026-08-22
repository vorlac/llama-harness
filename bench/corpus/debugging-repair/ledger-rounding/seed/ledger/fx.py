"""Currency conversion.

Rates are quoted as ``1 base = <rate> quote`` and are effective from the date
they are published until a newer quote replaces them, so a lookup for a given
day picks the most recent quote on or before that day. All arithmetic is done
with :class:`decimal.Decimal` and rounded to whole minor units at the end.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, localcontext
from typing import Dict, Iterable, List, Tuple

from .money import from_decimal, to_decimal

#: Working precision for the intermediate multiply/divide, well beyond the
#: precision of any published rate.
CONVERSION_PRECISION = 28


class MissingRateError(LookupError):
    """Raised when no rate is published for a pair on or before a given date."""


@dataclass(frozen=True)
class Rate:
    """One published quote: ``1 base`` buys ``rate`` of ``quote`` from ``date``."""

    date: date
    base: str
    quote: str
    rate: Decimal


class RateTable:
    """An indexed collection of published rates."""

    def __init__(self, rates: Iterable[Rate]) -> None:
        self._by_pair: Dict[Tuple[str, str], List[Rate]] = {}
        for rate in rates:
            if rate.rate <= 0:
                raise ValueError("rate for %s/%s must be positive" % (rate.base, rate.quote))
            self._by_pair.setdefault((rate.base, rate.quote), []).append(rate)
        for series in self._by_pair.values():
            series.sort(key=lambda item: item.date)

    def pairs(self) -> List[Tuple[str, str]]:
        return sorted(self._by_pair)

    def _lookup(self, base: str, quote: str, on: date) -> Decimal:
        series = self._by_pair.get((base, quote))
        if not series:
            raise MissingRateError("no rates published for %s/%s" % (base, quote))
        chosen = None
        for rate in series:
            if rate.date <= on:
                chosen = rate
            else:
                break
        if chosen is None:
            raise MissingRateError(
                "no %s/%s rate published on or before %s" % (base, quote, on.isoformat())
            )
        return chosen.rate

    def rate_on(self, base: str, quote: str, on: date) -> Decimal:
        """Return the rate to multiply a `base` amount by to get `quote`."""
        if base == quote:
            return Decimal(1)
        try:
            return self._lookup(base, quote, on)
        except MissingRateError:
            inverse = self._lookup(quote, base, on)
            with localcontext() as ctx:
                ctx.prec = CONVERSION_PRECISION
                return Decimal(1) / inverse

    def convert(self, amount_minor: int, base: str, quote: str, on: date) -> int:
        """Convert `amount_minor` from `base` into whole minor units of `quote`."""
        if base == quote:
            return amount_minor
        rate = self.rate_on(base, quote, on)
        with localcontext() as ctx:
            ctx.prec = CONVERSION_PRECISION
            converted = to_decimal(amount_minor, base) * rate
        return from_decimal(converted, quote)
