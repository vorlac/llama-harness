"""Record validation (SPEC.md section 4.4).

The checks run in the exact order the specification lists them, and the first
one that fails decides the reject reason for the whole line.  Nothing here
knows about threads: a record either becomes a `Record` or a `Reject`.
"""

import re

from .config import (ACTIONS, CODE_MAX, KINDS, MAX_TAGS, METRICS, SEQ_MAX,
                     STATES, VALUE_ABS_MAX)
from .escaping import detail_value
from .jsonsubset import json_type
from .tags import canonicalise_tag, is_canonical_tag
from .timestamps import parse_timestamp
from .units import convert

ID_PATTERN = r"\AE[0-9]{10}\Z"
DEVICE_PATTERN = r"\Adev-[0-9]{6}\Z"
SITE_PATTERN = r"\ASITE-[0-9]{2}\Z"
DECIMAL_PATTERN = r"\A-?(?:0|[1-9][0-9]{0,6})\.[0-9]{3}\Z"


class Reject:
    """One row of `rejects.tsv`, minus the line number and the raw prefix."""

    __slots__ = ("reason", "field", "detail")

    def __init__(self, reason, field, detail="-"):
        self.reason = reason
        self.field = field
        self.detail = detail


def _required(document, key, path):
    """Fetch a required field.  `null` counts as absent (section 4.4)."""
    if key not in document:
        return None, Reject("missing_field", path)
    value = document[key]
    if value is None:
        return None, Reject("missing_field", path)
    return value, None


def _optional(document, key):
    """Fetch an optional field.  Absent and `null` are indistinguishable."""
    if key not in document:
        return None
    return document[key]


def _expect_string(value, path):
    if isinstance(value, str):
        return None
    return Reject("bad_type", path,
                  "expected=string actual=%s" % json_type(value))


def _expect_integer(value, path):
    if isinstance(value, int) and not isinstance(value, bool):
        return None
    return Reject("bad_type", path,
                  "expected=integer actual=%s" % json_type(value))


def parse_decimal(text):
    """Read a decimal string of section 1.1.3 as milli-units."""
    negative = text[0] == "-"
    if negative:
        text = text[1:]
    point = text.index(".")
    milli = int(text[:point]) * 1000 + int(text[point + 1:])
    return -milli if negative else milli


def _validate_telemetry(payload, record):
    metric, reject = _required(payload, "metric", "/payload/metric")
    if reject:
        return reject
    reject = _expect_string(metric, "/payload/metric")
    if reject:
        return reject
    if metric not in METRICS:
        return Reject("unknown_metric", "/payload/metric",
                      "value=%s" % detail_value(metric))

    raw_value, reject = _required(payload, "value", "/payload/value")
    if reject:
        return reject
    reject = _expect_string(raw_value, "/payload/value")
    if reject:
        return reject
    if re.compile(DECIMAL_PATTERN).match(raw_value) is None:
        return Reject("bad_value", "/payload/value")
    milli = parse_decimal(raw_value)
    if milli > VALUE_ABS_MAX or milli < -VALUE_ABS_MAX:
        return Reject("value_out_of_range", "/payload/value",
                      "value=%s" % detail_value(raw_value))

    unit, reject = _required(payload, "unit", "/payload/unit")
    if reject:
        return reject
    reject = _expect_string(unit, "/payload/unit")
    if reject:
        return reject
    converted = convert(metric, unit, milli)
    if converted is None:
        return Reject("unknown_unit", "/payload/unit",
                      "value=%s" % detail_value(unit))

    quality = _optional(payload, "quality")
    if quality is None:
        quality = 100
    else:
        reject = _expect_integer(quality, "/payload/quality")
        if reject:
            return reject
        if quality < 0 or quality > 100:
            return Reject("bad_quality", "/payload/quality",
                          "value=%d" % quality)

    record["metric"] = metric
    record["raw_value"] = raw_value
    record["value"] = converted
    record["quality"] = quality
    return None


def _validate_status(payload):
    state, reject = _required(payload, "state", "/payload/state")
    if reject:
        return reject
    reject = _expect_string(state, "/payload/state")
    if reject:
        return reject
    if state not in STATES:
        return Reject("bad_payload", "/payload/state",
                      "value=%s" % detail_value(state))

    code = _optional(payload, "code")
    if code is not None:
        reject = _expect_integer(code, "/payload/code")
        if reject:
            return reject
        if code < 0 or code > CODE_MAX:
            return Reject("value_out_of_range", "/payload/code",
                          "value=%d" % code)
    return None


def _validate_audit(payload):
    actor, reject = _required(payload, "actor", "/payload/actor")
    if reject:
        return reject
    reject = _expect_string(actor, "/payload/actor")
    if reject:
        return reject
    if len(actor) < 1 or len(actor) > 48:
        return Reject("bad_payload", "/payload/actor",
                      "value=%s" % detail_value(actor))

    action, reject = _required(payload, "action", "/payload/action")
    if reject:
        return reject
    reject = _expect_string(action, "/payload/action")
    if reject:
        return reject
    if action not in ACTIONS:
        return Reject("bad_payload", "/payload/action",
                      "value=%s" % detail_value(action))
    return None


def _validate_tags(document, record):
    tags = _optional(document, "tags")
    if tags is None:
        record["tags"] = ()
        return None
    if not isinstance(tags, list):
        return Reject("bad_type", "/tags",
                      "expected=array actual=%s" % json_type(tags))
    if len(tags) > MAX_TAGS:
        return Reject("bad_tag", "/tags", "count=%d" % len(tags))
    canonical = []
    for index, raw in enumerate(tags):
        path = "/tags/%d" % index
        if not isinstance(raw, str):
            return Reject("bad_type", path,
                          "expected=string actual=%s" % json_type(raw))
        tag = canonicalise_tag(raw)
        if not is_canonical_tag(tag):
            return Reject("bad_tag", path, "value=%s" % detail_value(raw))
        canonical.append(tag)
    record["tags"] = tuple(sorted(set(canonical)))
    return None


def validate(document):
    """Returns (record, reject).  Exactly one of the two is None."""
    record = {}

    identifier, reject = _required(document, "id", "/id")
    if reject:
        return None, reject
    reject = _expect_string(identifier, "/id")
    if reject:
        return None, reject
    if re.compile(ID_PATTERN).match(identifier) is None:
        return None, Reject("bad_id", "/id")
    record["id"] = identifier

    timestamp, reject = _required(document, "ts", "/ts")
    if reject:
        return None, reject
    reject = _expect_string(timestamp, "/ts")
    if reject:
        return None, reject
    epoch_ms = parse_timestamp(timestamp)
    if epoch_ms is None:
        return None, Reject("bad_timestamp", "/ts")
    record["epoch_ms"] = epoch_ms

    device, reject = _required(document, "dev", "/dev")
    if reject:
        return None, reject
    reject = _expect_string(device, "/dev")
    if reject:
        return None, reject
    if re.compile(DEVICE_PATTERN).match(device) is None:
        return None, Reject("bad_id", "/dev")
    record["dev"] = device

    site = _optional(document, "site")
    if site is not None:
        reject = _expect_string(site, "/site")
        if reject:
            return None, reject
        if re.compile(SITE_PATTERN).match(site) is None:
            return None, Reject("bad_id", "/site")
    record["site"] = site

    kind, reject = _required(document, "kind", "/kind")
    if reject:
        return None, reject
    reject = _expect_string(kind, "/kind")
    if reject:
        return None, reject
    if kind not in KINDS:
        return None, Reject("unknown_kind", "/kind",
                            "value=%s" % detail_value(kind))
    record["kind"] = kind

    payload, reject = _required(document, "payload", "/payload")
    if reject:
        return None, reject
    if not isinstance(payload, dict):
        return None, Reject("bad_type", "/payload",
                            "expected=object actual=%s" % json_type(payload))

    if kind == "telemetry":
        reject = _validate_telemetry(payload, record)
    elif kind == "status":
        reject = _validate_status(payload)
    else:
        reject = _validate_audit(payload)
    if reject:
        return None, reject

    reject = _validate_tags(document, record)
    if reject:
        return None, reject

    sequence = _optional(document, "seq")
    if sequence is not None:
        reject = _expect_integer(sequence, "/seq")
        if reject:
            return None, reject
        if sequence < 0 or sequence > SEQ_MAX:
            return None, Reject("value_out_of_range", "/seq",
                                "value=%d" % sequence)

    return record, None
