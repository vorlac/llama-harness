"""Money primitives.

Amounts are integers counted in the smallest unit a currency has: 1234 in USD
means twelve dollars and thirty-four cents, 1234 in JPY means one thousand two
hundred and thirty-four yen. Keeping the integer form everywhere means the
ledger never has to reason about a value that cannot be written down exactly.

Conversion to and from human-readable text happens here and nowhere else.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Dict

#: Number of decimal places each supported currency is quoted with.
MINOR_EXPONENT: Dict[str, int] = {
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "CHF": 2,
    "JPY": 0,
}


class CurrencyError(ValueError):
    """Raised for a currency code the ledger does not know about."""


def exponent(currency: str) -> int:
    """Return the number of decimal places `currency` is quoted with."""
    try:
        return MINOR_EXPONENT[currency]
    except KeyError:
        raise CurrencyError("unsupported currency %r" % (currency,))


def minor_factor(currency: str) -> int:
    """Return how many minor units make up one major unit of `currency`."""
    return 10 ** exponent(currency)


def quantum(currency: str) -> Decimal:
    """Return the smallest representable step of `currency` as a Decimal."""
    return Decimal(1).scaleb(-exponent(currency))


def parse_amount(text: str, currency: str) -> int:
    """Parse a decimal string such as ``"-1240.05"`` into minor units.

    Values quoted with more precision than the currency supports are rounded
    half away from zero, which is the convention the rest of the ledger uses.
    """
    stripped = text.strip().replace(",", "")
    if not stripped:
        raise ValueError("empty amount")
    try:
        value = Decimal(stripped)
    except InvalidOperation:
        raise ValueError("malformed amount %r" % (text,))
    if not value.is_finite():
        raise ValueError("non-finite amount %r" % (text,))
    rounded = value.quantize(quantum(currency), rounding=ROUND_HALF_UP)
    return int(rounded.scaleb(exponent(currency)))


def to_decimal(minor: int, currency: str) -> Decimal:
    """Return `minor` units of `currency` as a Decimal in major units."""
    return Decimal(minor).scaleb(-exponent(currency))


def from_decimal(value: Decimal, currency: str) -> int:
    """Round a Decimal in major units to whole minor units, half away from zero."""
    rounded = value.quantize(quantum(currency), rounding=ROUND_HALF_UP)
    return int(rounded.scaleb(exponent(currency)))


def format_amount(minor: int, currency: str) -> str:
    """Render minor units as a plain decimal string with no currency symbol."""
    places = exponent(currency)
    if places == 0:
        return str(minor)
    sign = "-" if minor < 0 else ""
    magnitude = abs(minor)
    factor = 10 ** places
    return "%s%d.%0*d" % (sign, magnitude // factor, places, magnitude % factor)


def format_money(minor: int, currency: str) -> str:
    """Render minor units with the currency code appended, e.g. ``12.34 USD``."""
    return "%s %s" % (format_amount(minor, currency), currency)
