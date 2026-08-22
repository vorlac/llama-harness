"""The one-line summary serialiser.

Written already. The key order and the compaction are the contract: two
implementations of the same specification produce the same bytes, and a caller
supplies only the values.
"""

import json

KEY_ORDER = (
    "schema",
    "seed",
    "grid",
    "score",
    "moves",
    "rejected",
    "undos",
    "ai_moves",
    "max_tile",
    "empty",
    "won",
    "status",
    "rng_state",
)

SCHEMA = "tui-2048/1"


def to_line(fields):
    """One compact JSON object in KEY_ORDER, with no trailing newline."""
    missing = [key for key in KEY_ORDER if key not in fields]
    if missing:
        raise KeyError("summary is missing %s" % ", ".join(missing))
    extra = [key for key in fields if key not in KEY_ORDER]
    if extra:
        raise KeyError("summary carries unknown %s" % ", ".join(sorted(extra)))
    ordered = {key: fields[key] for key in KEY_ORDER}
    return json.dumps(ordered, separators=(",", ":"))
