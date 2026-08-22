"""Fixed-point arithmetic and the unit conversion table (SPEC.md section 5.2).

Every quantity in this program is an integer count of milli-units.  No stage
uses binary floating point, so Python and any other implementation of the
specification agree on every digit.
"""

from .config import METRICS


def rdiv(numerator, denominator):
    """Integer division rounding half away from zero.  `denominator` > 0."""
    if numerator >= 0:
        return (numerator * 2 + denominator) // (2 * denominator)
    return -((-numerator * 2 + denominator) // (2 * denominator))


# The one and only definition of what units this pipeline accepts and how each
# maps onto its metric's canonical unit.  The two six-digit factors are
# constants of the specification, not physical constants: changing them changes
# the output bytes.

CANONICAL_UNIT = {
    "temperature": "C",
    "pressure": "kPa",
    "humidity": "pct",
    "flow": "lpm",
    "voltage": "V",
}

CONVERSIONS = {
    ("temperature", "C"): lambda v: v,
    ("temperature", "F"): lambda v: rdiv((v - 32000) * 5, 9),
    ("temperature", "K"): lambda v: v - 273150,
    ("pressure", "kPa"): lambda v: v,
    ("pressure", "Pa"): lambda v: rdiv(v, 1000),
    ("pressure", "bar"): lambda v: v * 100,
    ("pressure", "psi"): lambda v: rdiv(v * 6894757, 1000000),
    ("humidity", "pct"): lambda v: v,
    ("humidity", "frac"): lambda v: v * 100,
    ("flow", "lpm"): lambda v: v,
    ("flow", "lps"): lambda v: v * 60,
    ("flow", "gpm"): lambda v: rdiv(v * 3785412, 1000000),
    ("voltage", "V"): lambda v: v,
    ("voltage", "mV"): lambda v: rdiv(v, 1000),
    ("voltage", "kV"): lambda v: v * 1000,
}

assert set(CANONICAL_UNIT) == set(METRICS)


def convert(metric, unit, milli):
    """Convert `milli` from `unit` to the canonical unit of `metric`.

    Returns None when the (metric, unit) pair is not accepted.  Unit names are
    matched exactly: `c` is not `C`.
    """
    conversion = CONVERSIONS.get((metric, unit))
    if conversion is None:
        return None
    return conversion(milli)
