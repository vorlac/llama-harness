"""Splitting one amount across several accounts.

Allocation works entirely in minor units. Callers hand in the amount to split
and one positive weight per destination; they get back one integer share per
destination, in the same order.
"""

from __future__ import annotations

from typing import List, Sequence


def _validate(weights: Sequence[int]) -> int:
    if not weights:
        raise ValueError("at least one weight is required")
    for weight in weights:
        if weight <= 0:
            raise ValueError("weights must be positive, got %r" % (weight,))
    return sum(weights)


def allocate(total_minor: int, weights: Sequence[int]) -> List[int]:
    """Split `total_minor` across `weights` in proportion to each weight.

    Shares carry the sign of `total_minor`; the magnitude is divided so that a
    destination with twice the weight of another receives twice as much.
    """
    total_weight = _validate(weights)
    sign = -1 if total_minor < 0 else 1
    magnitude = abs(total_minor)

    shares = []
    for weight in weights:
        shares.append((magnitude * weight) // total_weight)

    return [sign * share for share in shares]


def allocate_evenly(total_minor: int, parts: int) -> List[int]:
    """Split `total_minor` into `parts` shares of equal weight."""
    if parts < 1:
        raise ValueError("parts must be positive")
    return allocate(total_minor, [1] * parts)


def allocate_by_amounts(total_minor: int, amounts: Sequence[int]) -> List[int]:
    """Split `total_minor` in proportion to a list of reference amounts."""
    weights = [abs(amount) for amount in amounts]
    if any(weight == 0 for weight in weights):
        raise ValueError("reference amounts must be non-zero")
    return allocate(total_minor, weights)
