"""The one-line summary serialiser.

The summary's value is that two implementations of the same specification
produce the same bytes, so the key order and the compaction are part of the
contract rather than a formatting preference. This module owns both, and a
caller supplies only the values.
"""

import json

KEY_ORDER = (
    "schema",
    "seed",
    "width",
    "height",
    "ticks",
    "status",
    "score",
    "length",
    "food_eaten",
    "paused",
    "restarts",
    "direction",
    "head",
    "food",
    "snake",
    "board",
)

SCHEMA = "tui-snake/1"


def to_line(fields):
    """One compact JSON object in KEY_ORDER, with no trailing newline.

    A missing or unexpected key is a refusal rather than a differently shaped
    line, because a line that serialises at all is a line something downstream
    will compare byte for byte.
    """
    missing = [key for key in KEY_ORDER if key not in fields]
    if missing:
        raise KeyError("summary is missing %s" % ", ".join(missing))
    extra = [key for key in fields if key not in KEY_ORDER]
    if extra:
        raise KeyError("summary carries unknown %s" % ", ".join(sorted(extra)))
    ordered = {key: fields[key] for key in KEY_ORDER}
    return json.dumps(ordered, separators=(",", ":"))
