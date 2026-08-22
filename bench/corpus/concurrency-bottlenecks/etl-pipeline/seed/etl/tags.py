"""Tag canonicalisation (SPEC.md section 5.4).

Tags are the only strings this pipeline rewrites.  Metric, unit, kind, state
and action are all matched exactly as received.
"""

import re

CANONICAL_TAG_PATTERN = r"\A[a-z0-9_.:-]{1,32}\Z"


def canonicalise_tag(raw):
    """Trim, collapse interior spaces to `_`, and lowercase."""
    trimmed = raw.strip(" ")
    if " " in trimmed:
        trimmed = "_".join(part for part in trimmed.split(" ") if part != "")
    return trimmed.lower()


def is_canonical_tag(tag):
    return re.compile(CANONICAL_TAG_PATTERN).match(tag) is not None
