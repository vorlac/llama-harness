#!/usr/bin/env python3
"""Correctness checker for the etl-pipeline task.

Two independent things happen here.

1.  Structural validation of a candidate output directory: the three files
    exist, carry the exact headers, use LF terminators, obey the total ordering
    rule, and satisfy the counter invariants of SPEC.md section 2.3.  This runs
    always and gives useful diagnostics on its own.

2.  Semantic validation.  --recompute derives the expected bytes of
    windows.csv, rejects.tsv and summary.txt directly from events.ndjson and
    devices.tsv, using an independent implementation of SPEC.md, and compares
    byte for byte.  Correctness therefore never depends on a stored reference
    being right.  --reference compares against a stored directory instead,
    which is fast; --ensure-reference produces that directory FROM the oracle,
    so a reference is always oracle-derived and the fast path stays
    authoritative.

Standard library only.  Exit codes: 0 all requested checks passed, 1 a check
failed, 2 usage error.

This oracle is deliberately the most obvious single-threaded implementation of
the specification.  It is not a model answer: porting it wholesale gives a
correct pipeline that is nowhere near the speed target.
"""

import argparse
import hashlib
import json
import os
import re
import sys

SPEC = "SPEC.md"

WINDOW_MS = 300000
QUALITY_MIN = 50
EPOCH_MS_MAX = 4102444800000          # 2100-01-01T00:00:00.000Z
VALUE_ABS_MAX = 1000000000            # before conversion
VALUE_ABS_MAX_CANON = 2000000000      # after conversion and calibration
SEQ_MAX = 2147483647
CODE_MAX = 65535
MAX_TAGS = 8
RAW_PREFIX_BYTES = 80
DETAIL_VALUE_BYTES = 32

WINDOWS_HEADER = ("device_id,site_id,region,metric,window_start,count,"
                  "sum_milli,min_milli,max_milli,mean_milli,"
                  "max_abs_delta_milli,first_ts,last_ts,tags")
REJECTS_HEADER = "line_no\treason\tfield\tdetail\traw_prefix"

REASONS = [
    "bad_encoding", "empty_line", "bad_json", "not_object", "missing_field",
    "bad_type", "bad_id", "bad_timestamp", "timestamp_out_of_range",
    "unknown_kind", "bad_payload", "unknown_metric", "unknown_unit",
    "bad_value", "value_out_of_range", "bad_quality", "bad_tag",
    "duplicate_id", "unknown_device", "site_mismatch",
]
REASON_SET = set(REASONS)

SUMMARY_KEYS = (
    ["input_lines", "rejected_total"]
    + ["rejected_" + r for r in REASONS]
    + ["dropped_inactive", "dropped_non_telemetry", "dropped_low_quality",
       "aggregated_records", "window_rows", "distinct_devices",
       "sum_milli_total"]
)

KINDS = ("telemetry", "status", "audit")
STATES = ("online", "offline", "degraded", "maintenance")
ACTIONS = ("login", "logout", "config", "reboot")
METRICS = ("temperature", "pressure", "humidity", "flow", "voltage")

CANON_UNIT = {
    "temperature": "C", "pressure": "kPa", "humidity": "pct",
    "flow": "lpm", "voltage": "V",
}

RE_ID = re.compile(r"\AE[0-9]{10}\Z")
RE_DEV = re.compile(r"\Adev-[0-9]{6}\Z")
RE_SITE = re.compile(r"\ASITE-[0-9]{2}\Z")
RE_DECIMAL = re.compile(r"\A-?(?:0|[1-9][0-9]{0,6})\.[0-9]{3}\Z")
RE_TS = re.compile(
    r"\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})"
    r"\.([0-9]{3})(Z|[+-][0-9]{2}:[0-9]{2})\Z")
RE_TAG = re.compile(r"\A[a-z0-9_.:-]{1,32}\Z")
RE_REGION = re.compile(r"\A[a-z]{2}-[a-z]+\Z")
RE_INT = re.compile(r"\A-?(?:0|[1-9][0-9]*)\Z")

DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


# ==========================================================================
# Arithmetic helpers (SPEC.md section 0)
# ==========================================================================

def rdiv(n, d):
    """Integer division rounding half away from zero, d > 0."""
    if n >= 0:
        return (n * 2 + d) // (2 * d)
    return -((-n * 2 + d) // (2 * d))


def convert(metric, unit, v):
    """SPEC.md section 5.2.  Returns None when (metric, unit) is not accepted."""
    if metric == "temperature":
        if unit == "C":
            return v
        if unit == "F":
            return rdiv((v - 32000) * 5, 9)
        if unit == "K":
            return v - 273150
    elif metric == "pressure":
        if unit == "kPa":
            return v
        if unit == "Pa":
            return rdiv(v, 1000)
        if unit == "bar":
            return v * 100
        if unit == "psi":
            return rdiv(v * 6894757, 1000000)
    elif metric == "humidity":
        if unit == "pct":
            return v
        if unit == "frac":
            return v * 100
    elif metric == "flow":
        if unit == "lpm":
            return v
        if unit == "lps":
            return v * 60
        if unit == "gpm":
            return rdiv(v * 3785412, 1000000)
    elif metric == "voltage":
        if unit == "V":
            return v
        if unit == "mV":
            return rdiv(v, 1000)
        if unit == "kV":
            return v * 1000
    return None


def is_leap(y):
    return (y % 4 == 0 and y % 100 != 0) or y % 400 == 0


def days_in_month(y, m):
    if m == 2 and is_leap(y):
        return 29
    return DAYS_IN_MONTH[m - 1]


def days_from_civil(y, m, d):
    """Proleptic Gregorian days since 1970-01-01."""
    yy = y - (1 if m <= 2 else 0)
    era = (yy if yy >= 0 else yy - 399) // 400
    yoe = yy - era * 400
    mp = m + (-3 if m > 2 else 9)
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def civil_from_days(z):
    z += 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    return (y + (1 if m <= 2 else 0), m, d)


_MS_SUFFIX = [".%03dZ" % i for i in range(1000)]
_SEC_CACHE = {}


def norm_ts(epoch_ms):
    """Render epoch milliseconds as YYYY-MM-DDTHH:MM:SS.mmmZ."""
    sec, ms = divmod(epoch_ms, 1000)
    head = _SEC_CACHE.get(sec)
    if head is None:
        days, rem = divmod(sec, 86400)
        y, mo, d = civil_from_days(days)
        hh, rem = divmod(rem, 3600)
        mm, ss = divmod(rem, 60)
        head = "%04d-%02d-%02dT%02d:%02d:%02d" % (y, mo, d, hh, mm, ss)
        _SEC_CACHE[sec] = head
    return head + _MS_SUFFIX[ms]


# ==========================================================================
# Byte escaping (SPEC.md section 2.2.1)
# ==========================================================================

_ESC = {}
for _b in range(256):
    if _b == 0x5C:
        _ESC[_b] = "\\\\"
    elif _b == 0x09:
        _ESC[_b] = "\\t"
    elif _b == 0x0A:
        _ESC[_b] = "\\n"
    elif _b == 0x0D:
        _ESC[_b] = "\\r"
    elif _b < 0x20 or _b > 0x7E:
        _ESC[_b] = "\\x%02x" % _b
    else:
        _ESC[_b] = chr(_b)


def esc_bytes(raw):
    return "".join([_ESC[b] for b in raw])


def esc_str(s, limit=DETAIL_VALUE_BYTES):
    return esc_bytes(s.encode("latin-1")[:limit])


# ==========================================================================
# JSON subset parser (SPEC.md section 1.1.1)
# ==========================================================================

class JsonError(Exception):
    pass


class JBool(object):
    __slots__ = ("v",)

    def __init__(self, v):
        self.v = v


JTRUE = JBool(True)
JFALSE = JBool(False)


def jtype(v):
    if isinstance(v, dict):
        return "object"
    if isinstance(v, list):
        return "array"
    if isinstance(v, str):
        return "string"
    if isinstance(v, JBool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    return "null"


class _Parser(object):
    __slots__ = ("s", "i", "n")

    def __init__(self, s):
        self.s = s
        self.i = 0
        self.n = len(s)

    def ws(self):
        s, i, n = self.s, self.i, self.n
        while i < n and s[i] == " ":
            i += 1
        self.i = i

    def parse(self):
        self.ws()
        v = self.value()
        self.ws()
        if self.i != self.n:
            raise JsonError("trailing content")
        return v

    def value(self):
        if self.i >= self.n:
            raise JsonError("eof")
        c = self.s[self.i]
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c == '"':
            return self.string()
        if c == "-" or ("0" <= c <= "9"):
            return self.number()
        if self.s.startswith("null", self.i):
            self.i += 4
            return None
        if self.s.startswith("true", self.i):
            self.i += 4
            return JTRUE
        if self.s.startswith("false", self.i):
            self.i += 5
            return JFALSE
        raise JsonError("unexpected %r" % c)

    def obj(self):
        self.i += 1
        out = {}
        self.ws()
        if self.i < self.n and self.s[self.i] == "}":
            self.i += 1
            return out
        while True:
            self.ws()
            if self.i >= self.n or self.s[self.i] != '"':
                raise JsonError("object key")
            k = self.string()
            self.ws()
            if self.i >= self.n or self.s[self.i] != ":":
                raise JsonError("colon")
            self.i += 1
            self.ws()
            out[k] = self.value()          # duplicate keys: last wins
            self.ws()
            if self.i >= self.n:
                raise JsonError("eof in object")
            c = self.s[self.i]
            if c == ",":
                self.i += 1
                continue
            if c == "}":
                self.i += 1
                return out
            raise JsonError("object separator")

    def arr(self):
        self.i += 1
        out = []
        self.ws()
        if self.i < self.n and self.s[self.i] == "]":
            self.i += 1
            return out
        while True:
            self.ws()
            out.append(self.value())
            self.ws()
            if self.i >= self.n:
                raise JsonError("eof in array")
            c = self.s[self.i]
            if c == ",":
                self.i += 1
                continue
            if c == "]":
                self.i += 1
                return out
            raise JsonError("array separator")

    def string(self):
        s, n = self.s, self.n
        i = self.i + 1
        start = i
        chunks = None
        while True:
            if i >= n:
                raise JsonError("unterminated string")
            c = s[i]
            if c == '"':
                if chunks is None:
                    self.i = i + 1
                    return s[start:i]
                chunks.append(s[start:i])
                self.i = i + 1
                return "".join(chunks)
            if c == "\\":
                if i + 1 >= n:
                    raise JsonError("unterminated escape")
                e = s[i + 1]
                if e != '"' and e != "\\":
                    raise JsonError("illegal escape")
                if chunks is None:
                    chunks = []
                chunks.append(s[start:i])
                chunks.append(e)
                i += 2
                start = i
                continue
            i += 1

    def number(self):
        s, n = self.s, self.n
        i = self.i
        start = i
        if s[i] == "-":
            i += 1
        if i >= n or not ("0" <= s[i] <= "9"):
            raise JsonError("number")
        if s[i] == "0":
            i += 1
        else:
            while i < n and "0" <= s[i] <= "9":
                i += 1
        if i < n and (s[i] == "." or s[i] == "e" or s[i] == "E"
                      or ("0" <= s[i] <= "9")):
            raise JsonError("number form")
        self.i = i
        return int(s[start:i])


def parse_line(text):
    return _Parser(text).parse()


# ==========================================================================
# Timestamp validation
# ==========================================================================

def parse_ts(text):
    """Return epoch milliseconds, or None when the timestamp is invalid."""
    m = RE_TS.match(text)
    if m is None:
        return None
    y = int(m.group(1))
    mo = int(m.group(2))
    d = int(m.group(3))
    hh = int(m.group(4))
    mi = int(m.group(5))
    ss = int(m.group(6))
    ms = int(m.group(7))
    off = m.group(8)
    if mo < 1 or mo > 12:
        return None
    if d < 1 or d > days_in_month(y, mo):
        return None
    if hh > 23 or mi > 59 or ss > 59:
        return None
    if off == "Z":
        off_ms = 0
    else:
        oh = int(off[1:3])
        om = int(off[4:6])
        if oh > 23 or om > 59:
            return None
        total = oh * 60 + om
        if total > 840:
            return None
        off_ms = total * 60000
        if off[0] == "-":
            off_ms = -off_ms
    epoch = (days_from_civil(y, mo, d) * 86400000
             + hh * 3600000 + mi * 60000 + ss * 1000 + ms - off_ms)
    return epoch


# ==========================================================================
# Tag canonicalisation (SPEC.md section 5.4)
# ==========================================================================

def canon_tag(raw):
    t = raw.strip(" ")
    if " " in t:
        parts = [p for p in t.split(" ") if p != ""]
        t = "_".join(parts)
    return t.lower()


# ==========================================================================
# The oracle
# ==========================================================================

class Reject(object):
    __slots__ = ("reason", "field", "detail")

    def __init__(self, reason, field, detail):
        self.reason = reason
        self.field = field
        self.detail = detail


def _need(obj, key, path):
    """Fetch a required field.  Returns (value, reject)."""
    if key not in obj:
        return None, Reject("missing_field", path, "-")
    v = obj[key]
    if v is None:
        return None, Reject("missing_field", path, "-")
    return v, None


def _opt(obj, key):
    if key not in obj:
        return None
    v = obj[key]
    if v is None:
        return None
    return v


def _want_string(v, path):
    if isinstance(v, str):
        return None
    return Reject("bad_type", path, "expected=string actual=%s" % jtype(v))


def _want_integer(v, path):
    if isinstance(v, int) and not isinstance(v, JBool):
        return None
    return Reject("bad_type", path, "expected=integer actual=%s" % jtype(v))


def validate(obj):
    """SPEC.md section 4.4.  Returns (record, reject); exactly one is None."""
    rec = {}

    v, rj = _need(obj, "id", "/id")
    if rj:
        return None, rj
    rj = _want_string(v, "/id")
    if rj:
        return None, rj
    if RE_ID.match(v) is None:
        return None, Reject("bad_id", "/id", "-")
    rec["id"] = v

    v, rj = _need(obj, "ts", "/ts")
    if rj:
        return None, rj
    rj = _want_string(v, "/ts")
    if rj:
        return None, rj
    epoch_ms = parse_ts(v)
    if epoch_ms is None:
        return None, Reject("bad_timestamp", "/ts", "-")
    rec["epoch_ms"] = epoch_ms

    v, rj = _need(obj, "dev", "/dev")
    if rj:
        return None, rj
    rj = _want_string(v, "/dev")
    if rj:
        return None, rj
    if RE_DEV.match(v) is None:
        return None, Reject("bad_id", "/dev", "-")
    rec["dev"] = v

    site = _opt(obj, "site")
    if site is not None:
        rj = _want_string(site, "/site")
        if rj:
            return None, rj
        if RE_SITE.match(site) is None:
            return None, Reject("bad_id", "/site", "-")
    rec["site"] = site

    v, rj = _need(obj, "kind", "/kind")
    if rj:
        return None, rj
    rj = _want_string(v, "/kind")
    if rj:
        return None, rj
    if v not in KINDS:
        return None, Reject("unknown_kind", "/kind", "value=%s" % esc_str(v))
    kind = v
    rec["kind"] = kind

    payload, rj = _need(obj, "payload", "/payload")
    if rj:
        return None, rj
    if not isinstance(payload, dict):
        return None, Reject("bad_type", "/payload",
                            "expected=object actual=%s" % jtype(payload))

    if kind == "telemetry":
        v, rj = _need(payload, "metric", "/payload/metric")
        if rj:
            return None, rj
        rj = _want_string(v, "/payload/metric")
        if rj:
            return None, rj
        if v not in METRICS:
            return None, Reject("unknown_metric", "/payload/metric",
                                "value=%s" % esc_str(v))
        metric = v

        v, rj = _need(payload, "value", "/payload/value")
        if rj:
            return None, rj
        rj = _want_string(v, "/payload/value")
        if rj:
            return None, rj
        if RE_DECIMAL.match(v) is None:
            return None, Reject("bad_value", "/payload/value", "-")
        raw_value = v
        neg = v[0] == "-"
        if neg:
            v = v[1:]
        dot = v.index(".")
        milli = int(v[:dot]) * 1000 + int(v[dot + 1:])
        if neg:
            milli = -milli
        if milli > VALUE_ABS_MAX or milli < -VALUE_ABS_MAX:
            return None, Reject("value_out_of_range", "/payload/value",
                                "value=%s" % esc_str(raw_value))

        v, rj = _need(payload, "unit", "/payload/unit")
        if rj:
            return None, rj
        rj = _want_string(v, "/payload/unit")
        if rj:
            return None, rj
        conv = convert(metric, v, milli)
        if conv is None:
            return None, Reject("unknown_unit", "/payload/unit",
                                "value=%s" % esc_str(v))

        quality = _opt(payload, "quality")
        if quality is None:
            quality = 100
        else:
            rj = _want_integer(quality, "/payload/quality")
            if rj:
                return None, rj
            if quality < 0 or quality > 100:
                return None, Reject("bad_quality", "/payload/quality",
                                    "value=%d" % quality)
        rec["metric"] = metric
        rec["raw_value"] = raw_value
        rec["value"] = conv
        rec["quality"] = quality

    elif kind == "status":
        v, rj = _need(payload, "state", "/payload/state")
        if rj:
            return None, rj
        rj = _want_string(v, "/payload/state")
        if rj:
            return None, rj
        if v not in STATES:
            return None, Reject("bad_payload", "/payload/state",
                                "value=%s" % esc_str(v))
        code = _opt(payload, "code")
        if code is not None:
            rj = _want_integer(code, "/payload/code")
            if rj:
                return None, rj
            if code < 0 or code > CODE_MAX:
                return None, Reject("value_out_of_range", "/payload/code",
                                    "value=%d" % code)

    else:  # audit
        v, rj = _need(payload, "actor", "/payload/actor")
        if rj:
            return None, rj
        rj = _want_string(v, "/payload/actor")
        if rj:
            return None, rj
        if len(v) < 1 or len(v) > 48:
            return None, Reject("bad_payload", "/payload/actor",
                                "value=%s" % esc_str(v))
        v, rj = _need(payload, "action", "/payload/action")
        if rj:
            return None, rj
        rj = _want_string(v, "/payload/action")
        if rj:
            return None, rj
        if v not in ACTIONS:
            return None, Reject("bad_payload", "/payload/action",
                                "value=%s" % esc_str(v))

    tags = _opt(obj, "tags")
    if tags is None:
        canon = ()
    else:
        if not isinstance(tags, list):
            return None, Reject("bad_type", "/tags",
                                "expected=array actual=%s" % jtype(tags))
        if len(tags) > MAX_TAGS:
            return None, Reject("bad_tag", "/tags", "count=%d" % len(tags))
        acc = []
        for idx, t in enumerate(tags):
            path = "/tags/%d" % idx
            if not isinstance(t, str):
                return None, Reject("bad_type", path,
                                    "expected=string actual=%s" % jtype(t))
            c = canon_tag(t)
            if RE_TAG.match(c) is None:
                return None, Reject("bad_tag", path, "value=%s" % esc_str(t))
            acc.append(c)
        canon = tuple(sorted(set(acc)))
    rec["tags"] = canon

    seq = _opt(obj, "seq")
    if seq is not None:
        rj = _want_integer(seq, "/seq")
        if rj:
            return None, rj
        if seq < 0 or seq > SEQ_MAX:
            return None, Reject("value_out_of_range", "/seq", "value=%d" % seq)

    return rec, None


def load_devices(path):
    """Returns {device_id: (site_id, region, calibration_milli, active)}."""
    table = {}
    with open(path, "rb") as fh:
        header = fh.readline()
        if header.rstrip(b"\n") != b"device_id\tsite_id\tregion\tcalibration_milli\tactive":
            raise ValueError("devices.tsv: bad header")
        for lineno, raw in enumerate(fh, start=2):
            line = raw.rstrip(b"\n").decode("latin-1")
            if line == "":
                continue
            parts = line.split("\t")
            if len(parts) != 5:
                raise ValueError("devices.tsv:%d: expected 5 columns" % lineno)
            dev, site, region, calib, active = parts
            if RE_DEV.match(dev) is None:
                raise ValueError("devices.tsv:%d: bad device_id" % lineno)
            if dev in table:
                raise ValueError("devices.tsv:%d: duplicate device_id" % lineno)
            if RE_SITE.match(site) is None:
                raise ValueError("devices.tsv:%d: bad site_id" % lineno)
            if RE_REGION.match(region) is None:
                raise ValueError("devices.tsv:%d: bad region" % lineno)
            if RE_INT.match(calib) is None or abs(int(calib)) > 1000000:
                raise ValueError("devices.tsv:%d: bad calibration" % lineno)
            if active not in ("0", "1"):
                raise ValueError("devices.tsv:%d: bad active" % lineno)
            table[dev] = (site, region, int(calib), active == "1")
    return table


def run_oracle(events_path, devices_path):
    """Independent implementation of SPEC.md.  Returns three str blobs."""
    devices = load_devices(devices_path)

    counts = dict((r, 0) for r in REASONS)
    dropped_inactive = 0
    dropped_non_telemetry = 0
    dropped_low_quality = 0
    aggregated = 0
    input_lines = 0

    seen_ids = {}
    last_value = {}
    groups = {}
    rejects = []

    with open(events_path, "rb") as fh:
        for lineno, raw in enumerate(fh, start=1):
            if raw.endswith(b"\n"):
                raw = raw[:-1]
            input_lines = lineno

            # 4.1 encoding
            bad_at = -1
            for off, b in enumerate(raw):
                if b < 0x20 or b > 0x7E:
                    bad_at = off
                    break
            prefix = esc_bytes(raw[:RAW_PREFIX_BYTES])
            if bad_at >= 0:
                rejects.append((lineno, "bad_encoding", "-",
                                "byte=0x%02x offset=%d" % (raw[bad_at], bad_at),
                                prefix))
                counts["bad_encoding"] += 1
                continue

            text = raw.decode("latin-1")

            # 4.2 emptiness
            if text == "" or text.strip(" ") == "":
                rejects.append((lineno, "empty_line", "-", "-", prefix))
                counts["empty_line"] += 1
                continue

            # 4.3 parse
            try:
                doc = parse_line(text)
            except JsonError:
                rejects.append((lineno, "bad_json", "-", "-", prefix))
                counts["bad_json"] += 1
                continue
            if not isinstance(doc, dict):
                rejects.append((lineno, "not_object", "-", "-", prefix))
                counts["not_object"] += 1
                continue

            # 4.4 validate
            rec, rj = validate(doc)
            if rj is not None:
                rejects.append((lineno, rj.reason, rj.field, rj.detail, prefix))
                counts[rj.reason] += 1
                continue

            # 4.5 normalise / range
            epoch_ms = rec["epoch_ms"]
            if epoch_ms < 0 or epoch_ms >= EPOCH_MS_MAX:
                rejects.append((lineno, "timestamp_out_of_range", "/ts", "-",
                                prefix))
                counts["timestamp_out_of_range"] += 1
                continue

            # 4.6 dedup
            rid = rec["id"]
            first = seen_ids.get(rid)
            if first is not None:
                rejects.append((lineno, "duplicate_id", "/id",
                                "first_line=%d" % first, prefix))
                counts["duplicate_id"] += 1
                continue
            seen_ids[rid] = lineno

            # 4.7 enrich
            dev = rec["dev"]
            info = devices.get(dev)
            if info is None:
                rejects.append((lineno, "unknown_device", "/dev",
                                "value=%s" % esc_str(dev), prefix))
                counts["unknown_device"] += 1
                continue
            site_id, region, calib, active = info
            if rec["site"] is not None and rec["site"] != site_id:
                rejects.append((lineno, "site_mismatch", "/site",
                                "record=%s lookup=%s"
                                % (esc_str(rec["site"]), esc_str(site_id)),
                                prefix))
                counts["site_mismatch"] += 1
                continue

            kind = rec["kind"]
            if kind == "telemetry":
                value = rec["value"] + calib
                if value > VALUE_ABS_MAX_CANON or value < -VALUE_ABS_MAX_CANON:
                    rejects.append((lineno, "value_out_of_range",
                                    "/payload/value",
                                    "value=%s" % esc_str(rec["raw_value"]),
                                    prefix))
                    counts["value_out_of_range"] += 1
                    continue

            # 5.6 filter
            if not active:
                dropped_inactive += 1
                continue
            if kind != "telemetry":
                dropped_non_telemetry += 1
                continue
            if rec["quality"] < QUALITY_MIN:
                dropped_low_quality += 1
                continue

            # 5.7 delta
            metric = rec["metric"]
            dkey = (dev, metric)
            prev = last_value.get(dkey)
            last_value[dkey] = value
            delta = None if prev is None else abs(value - prev)

            # 5.8 aggregate
            ts_str = norm_ts(epoch_ms)
            wstart = (epoch_ms // WINDOW_MS) * WINDOW_MS
            gkey = (dev, metric, wstart)
            g = groups.get(gkey)
            if g is None:
                groups[gkey] = [1, value, value, value,
                                (-1 if delta is None else delta),
                                ts_str, ts_str, set(rec["tags"]),
                                site_id, region]
            else:
                g[0] += 1
                g[1] += value
                if value < g[2]:
                    g[2] = value
                if value > g[3]:
                    g[3] = value
                if delta is not None and delta > g[4]:
                    g[4] = delta
                g[6] = ts_str
                if rec["tags"]:
                    g[7].update(rec["tags"])
            aggregated += 1

    # ---- emit windows.csv
    out = [WINDOWS_HEADER]
    sum_total = 0
    devices_seen = set()
    for gkey in sorted(groups):
        dev, metric, wstart = gkey
        g = groups[gkey]
        count, total, lo, hi, mdelta, first_ts, last_ts, tags, site_id, region = g
        sum_total += total
        devices_seen.add(dev)
        out.append(",".join([
            dev, site_id, region, metric, norm_ts(wstart),
            str(count), str(total), str(lo), str(hi),
            str(rdiv(total, count)),
            ("" if mdelta < 0 else str(mdelta)),
            first_ts, last_ts,
            ";".join(sorted(tags)),
        ]))
    windows_blob = "\n".join(out) + "\n"

    # ---- emit rejects.tsv
    rout = [REJECTS_HEADER]
    for r in rejects:
        rout.append("%d\t%s\t%s\t%s\t%s" % r)
    rejects_blob = "\n".join(rout) + "\n"

    # ---- emit summary.txt
    rejected_total = sum(counts.values())
    values = {
        "input_lines": input_lines,
        "rejected_total": rejected_total,
        "dropped_inactive": dropped_inactive,
        "dropped_non_telemetry": dropped_non_telemetry,
        "dropped_low_quality": dropped_low_quality,
        "aggregated_records": aggregated,
        "window_rows": len(groups),
        "distinct_devices": len(devices_seen),
        "sum_milli_total": sum_total,
    }
    for r in REASONS:
        values["rejected_" + r] = counts[r]
    summary_blob = "".join(
        "%s=%d\n" % (k, values[k]) for k in SUMMARY_KEYS)

    return windows_blob, rejects_blob, summary_blob


# ==========================================================================
# Structural checks
# ==========================================================================

def read_text(path):
    with open(path, "rb") as fh:
        return fh.read()


def check_structure(out_dir, results):
    """Checks that need only the candidate output.  Returns the parsed files
    (or None) so later checks can reuse them."""
    files = {}
    for name in ("windows.csv", "rejects.tsv", "summary.txt"):
        path = os.path.join(out_dir, name)
        if not os.path.isfile(path):
            results.fail("exists:" + name, "missing file %s" % path)
            files[name] = None
            continue
        blob = read_text(path)
        if b"\r" in blob:
            results.fail("no_cr:" + name, "file contains a CR byte")
        if not blob.endswith(b"\n"):
            results.fail("trailing_lf:" + name, "file does not end with LF")
        elif blob.endswith(b"\n\n"):
            results.fail("trailing_lf:" + name, "file ends with a blank line")
        results.ok("exists:" + name)
        files[name] = blob

    w = files.get("windows.csv")
    if w is not None:
        lines = w.decode("latin-1").split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        if not lines or lines[0] != WINDOWS_HEADER:
            results.fail("header:windows.csv",
                         "header is %r, expected %r"
                         % (lines[0] if lines else None, WINDOWS_HEADER))
        else:
            results.ok("header:windows.csv")
        prev = None
        bad_order = None
        bad_cols = None
        for n, line in enumerate(lines[1:], start=2):
            cols = line.split(",")
            if len(cols) != 14 and bad_cols is None:
                bad_cols = "line %d has %d columns, expected 14" % (n, len(cols))
            key = (cols[0], cols[3], cols[4]) if len(cols) == 14 else None
            if key is not None and prev is not None and key <= prev \
                    and bad_order is None:
                bad_order = ("line %d breaks the total ordering rule: %r "
                             "does not sort after %r" % (n, key, prev))
            if key is not None:
                prev = key
        if bad_cols:
            results.fail("columns:windows.csv", bad_cols)
        else:
            results.ok("columns:windows.csv")
        if bad_order:
            results.fail("order:windows.csv", bad_order)
        else:
            results.ok("order:windows.csv")

    r = files.get("rejects.tsv")
    if r is not None:
        lines = r.decode("latin-1").split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        if not lines or lines[0] != REJECTS_HEADER:
            results.fail("header:rejects.tsv", "header does not match SPEC 2.2")
        else:
            results.ok("header:rejects.tsv")
        prev = 0
        problem = None
        for n, line in enumerate(lines[1:], start=2):
            cols = line.split("\t")
            if len(cols) != 5:
                problem = "line %d has %d columns, expected 5" % (n, len(cols))
                break
            if not cols[0].isdigit():
                problem = "line %d: line_no %r is not a number" % (n, cols[0])
                break
            v = int(cols[0])
            if v <= prev:
                problem = ("line %d: line_no %d does not increase (previous %d)"
                           % (n, v, prev))
                break
            prev = v
            if cols[1] not in REASON_SET:
                problem = "line %d: unknown reason %r" % (n, cols[1])
                break
        if problem:
            results.fail("order:rejects.tsv", problem)
        else:
            results.ok("order:rejects.tsv")

    s = files.get("summary.txt")
    if s is not None:
        lines = s.decode("latin-1").split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        keys = []
        vals = {}
        malformed = None
        for n, line in enumerate(lines, start=1):
            if "=" not in line:
                malformed = "line %d is not key=value" % n
                break
            k, _, v = line.partition("=")
            if RE_INT.match(v) is None:
                malformed = "line %d: %r is not an integer" % (n, v)
                break
            keys.append(k)
            vals[k] = int(v)
        if malformed:
            results.fail("format:summary.txt", malformed)
        elif keys != SUMMARY_KEYS:
            missing = [k for k in SUMMARY_KEYS if k not in vals]
            extra = [k for k in keys if k not in SUMMARY_KEYS]
            results.fail("format:summary.txt",
                         "key set or order is wrong; missing=%s extra=%s"
                         % (missing, extra))
        else:
            results.ok("format:summary.txt")
            total = (vals["rejected_total"] + vals["dropped_inactive"]
                     + vals["dropped_non_telemetry"]
                     + vals["dropped_low_quality"]
                     + vals["aggregated_records"])
            if total != vals["input_lines"]:
                results.fail("invariant:accounting",
                             "rejected+dropped+aggregated = %d but "
                             "input_lines = %d" % (total, vals["input_lines"]))
            else:
                results.ok("invariant:accounting")
            reason_sum = sum(vals["rejected_" + x] for x in REASONS)
            if reason_sum != vals["rejected_total"]:
                results.fail("invariant:reject_total",
                             "per-reason counters sum to %d but "
                             "rejected_total = %d"
                             % (reason_sum, vals["rejected_total"]))
            else:
                results.ok("invariant:reject_total")
            if r is not None:
                n_rej = max(0, r.decode("latin-1").count("\n") - 1)
                if n_rej != vals["rejected_total"]:
                    results.fail("invariant:rejects_rows",
                                 "rejects.tsv has %d data rows but "
                                 "rejected_total = %d"
                                 % (n_rej, vals["rejected_total"]))
                else:
                    results.ok("invariant:rejects_rows")
            if w is not None:
                n_win = max(0, w.decode("latin-1").count("\n") - 1)
                if n_win != vals["window_rows"]:
                    results.fail("invariant:window_rows",
                                 "windows.csv has %d data rows but "
                                 "window_rows = %d" % (n_win, vals["window_rows"]))
                else:
                    results.ok("invariant:window_rows")
    return files


# ==========================================================================
# Comparison
# ==========================================================================

def diff_report(name, expected, actual, context):
    """Return None when equal, else a human-readable first-difference report."""
    if expected == actual:
        return None
    elines = expected.split("\n")
    alines = actual.split("\n")
    n = min(len(elines), len(alines))
    idx = n
    for i in range(n):
        if elines[i] != alines[i]:
            idx = i
            break
    out = ["%s: first difference at line %d" % (name, idx + 1)]
    lo = max(0, idx - context)
    for j in range(lo, idx):
        out.append("  line %d   both  | %s" % (j + 1, elines[j]))
    if idx < len(elines):
        out.append("  line %d   expect| %s" % (idx + 1, elines[idx]))
    else:
        out.append("  line %d   expect| <end of file>" % (idx + 1))
    if idx < len(alines):
        out.append("  line %d   actual| %s" % (idx + 1, alines[idx]))
    else:
        out.append("  line %d   actual| <end of file>" % (idx + 1))
    for j in range(idx + 1, min(idx + 1 + context, n)):
        out.append("  line %d   expect| %s" % (j + 1, elines[j]))
        out.append("  line %d   actual| %s" % (j + 1, alines[j]))
    out.append("  expected %d lines / %d bytes, actual %d lines / %d bytes"
               % (len(elines) - 1, len(expected), len(alines) - 1, len(actual)))
    return "\n".join(out)


class Results(object):
    def __init__(self):
        self.checks = []
        self.failed = 0

    def ok(self, name, detail=""):
        self.checks.append({"name": name, "ok": True, "detail": detail})

    def fail(self, name, detail):
        self.checks.append({"name": name, "ok": False, "detail": detail})
        self.failed += 1


# ==========================================================================
# Reference directory management
# ==========================================================================

def fingerprint(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
    return {"path": os.path.abspath(path),
            "size": os.path.getsize(path),
            "sha256": h.hexdigest()}


def reference_is_current(ref_dir, events_path, devices_path):
    meta_path = os.path.join(ref_dir, "oracle_meta.json")
    if not os.path.isfile(meta_path):
        return False
    for name in ("windows.csv", "rejects.tsv", "summary.txt"):
        if not os.path.isfile(os.path.join(ref_dir, name)):
            return False
    try:
        with open(meta_path, "r") as fh:
            meta = json.load(fh)
    except (ValueError, OSError):
        return False
    return (meta.get("events") == fingerprint(events_path)
            and meta.get("devices") == fingerprint(devices_path))


def write_reference(ref_dir, events_path, devices_path, blobs):
    os.makedirs(ref_dir, exist_ok=True)
    for name, blob in zip(("windows.csv", "rejects.tsv", "summary.txt"), blobs):
        with open(os.path.join(ref_dir, name), "w", encoding="ascii",
                  newline="\n") as fh:
            fh.write(blob)
    meta = {"spec": SPEC,
            "events": fingerprint(events_path),
            "devices": fingerprint(devices_path)}
    with open(os.path.join(ref_dir, "oracle_meta.json"), "w",
              encoding="ascii", newline="\n") as fh:
        json.dump(meta, fh, indent=2, sort_keys=True)
        fh.write("\n")


# ==========================================================================
# Entry point
# ==========================================================================

def main(argv):
    ap = argparse.ArgumentParser(
        description="Verify an etl-pipeline output directory against SPEC.md.")
    ap.add_argument("--events", help="path to events.ndjson")
    ap.add_argument("--devices", help="path to devices.tsv")
    ap.add_argument("--out", help="candidate output directory to check")
    ap.add_argument("--reference", help="reference output directory to "
                                        "byte-compare against")
    ap.add_argument("--recompute", action="store_true",
                    help="recompute the expected bytes from the inputs and "
                         "compare (authoritative, slow)")
    ap.add_argument("--ensure-reference", metavar="DIR",
                    help="write oracle output into DIR if it is missing or "
                         "stale for these inputs, then exit unless --out is "
                         "also given")
    ap.add_argument("--write-expected", metavar="DIR",
                    help="unconditionally write oracle output into DIR")
    ap.add_argument("--context", type=int, default=3,
                    help="lines of context around the first difference")
    ap.add_argument("--json", action="store_true",
                    help="emit a machine-readable result object on stdout")
    args = ap.parse_args(argv)

    results = Results()
    ref_dir = args.reference

    # ---- reference production
    if args.ensure_reference or args.write_expected:
        if not args.events or not args.devices:
            ap.error("--ensure-reference/--write-expected need --events and "
                     "--devices")
        target = args.write_expected or args.ensure_reference
        stale = bool(args.write_expected) or not reference_is_current(
            target, args.events, args.devices)
        if stale:
            blobs = run_oracle(args.events, args.devices)
            write_reference(target, args.events, args.devices, blobs)
            results.ok("reference:written", target)
        else:
            results.ok("reference:current", target)
        if ref_dir is None:
            ref_dir = target
        if not args.out:
            return emit(results, args.json)

    if not args.out:
        ap.error("--out is required unless only producing a reference")
    if not os.path.isdir(args.out):
        results.fail("exists:out_dir", "not a directory: %s" % args.out)
        return emit(results, args.json)

    files = check_structure(args.out, results)

    names = ("windows.csv", "rejects.tsv", "summary.txt")

    if ref_dir:
        for name in names:
            rpath = os.path.join(ref_dir, name)
            if not os.path.isfile(rpath):
                results.fail("reference:" + name, "missing %s" % rpath)
                continue
            actual = files.get(name)
            if actual is None:
                continue
            expected = read_text(rpath)
            rep = diff_report(name, expected.decode("latin-1"),
                              actual.decode("latin-1"), args.context)
            if rep is None:
                results.ok("reference:" + name)
            else:
                results.fail("reference:" + name, rep)

    if args.recompute:
        if not args.events or not args.devices:
            ap.error("--recompute needs --events and --devices")
        blobs = run_oracle(args.events, args.devices)
        for name, expected in zip(names, blobs):
            actual = files.get(name)
            if actual is None:
                continue
            rep = diff_report(name, expected, actual.decode("latin-1"),
                              args.context)
            if rep is None:
                results.ok("recompute:" + name)
            else:
                results.fail("recompute:" + name, rep)

    if not ref_dir and not args.recompute:
        results.ok("note:structure_only",
                   "no --reference and no --recompute: structural checks only")

    return emit(results, args.json)


def emit(results, as_json):
    if as_json:
        sys.stdout.write(json.dumps({
            "ok": results.failed == 0,
            "failed": results.failed,
            "checks": results.checks,
        }, sort_keys=True) + "\n")
    else:
        for c in results.checks:
            mark = "PASS" if c["ok"] else "FAIL"
            sys.stdout.write("%s %s\n" % (mark, c["name"]))
            if c["detail"]:
                for line in str(c["detail"]).split("\n"):
                    sys.stdout.write("     %s\n" % line)
        sys.stdout.write("%d checks, %d failed\n"
                         % (len(results.checks), results.failed))
    return 0 if results.failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ValueError as exc:
        sys.stderr.write("input error: %s\n" % exc)
        sys.exit(2)
