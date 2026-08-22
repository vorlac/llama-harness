#!/usr/bin/env python3
"""Deterministic workload generator for the etl-pipeline task.

Writes three files into --out:

    events.ndjson   the record stream defined in SPEC.md section 1.1
    devices.tsv     the lookup table defined in SPEC.md section 1.2
    manifest.json   generation parameters and injection counts (informational)

The same flags always produce byte-identical files, on any machine, on any
Python 3.8+.  Nothing here depends on dict ordering, on set iteration, on
PYTHONHASHSEED, on locale, or on the platform line separator: every file is
opened with newline="\\n" and every random draw comes from one seeded
random.Random instance consumed in a fixed order.

Standard library only.

Speed notes, because the default workload is over a million records:
  * every repeated string fragment is precomputed once (device ids, site
    fragments, payload prefixes, tag arrays, quality suffixes);
  * timestamps are rendered from a precomputed second-resolution table, so the
    per-record cost is two list indexes and a concatenation rather than a
    datetime construction;
  * the common path makes exactly four calls into the RNG -- two 64-bit draws
    that are bit-sliced into the field selectors, and two randrange calls;
  * rare branches (malformed records, duplicates) make additional RNG calls,
    which costs nothing amortised and keeps the fast path narrow;
  * lines are joined in blocks and written to a large buffer.

Because the field selectors are bit slices, probability flags are quantised to
1/65536.  --malformed-rate 0.005 means 327/65536 = 0.0049896.  The manifest
records the exact counts actually injected.
"""

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timedelta

# --------------------------------------------------------------------------
# Fixed vocabulary.  Any change here changes every generated dataset, so these
# are constants of the task, not tunables.
# --------------------------------------------------------------------------

REGIONS = [
    "us-east", "us-west", "eu-west", "eu-central",
    "ap-south", "ap-northeast", "sa-east", "af-south",
]

METRICS = ["temperature", "pressure", "humidity", "flow", "voltage"]

# Accepted units per metric, mirroring SPEC.md section 5.2.  The generator picks
# one unit per (device, metric) pair and keeps it for the whole run, the way a
# real device reports in a fixed unit.
UNITS = {
    "temperature": ["C", "F", "K"],
    "pressure": ["kPa", "Pa", "bar", "psi"],
    "humidity": ["pct", "frac"],
    "flow": ["lpm", "lps", "gpm"],
    "voltage": ["V", "mV", "kV"],
}

# Plausible value ranges in milli-units OF THE SOURCE UNIT, plus the random-walk
# step size.  All magnitudes stay well inside the 1e9 milli-unit validation
# bound of SPEC.md section 4.4.
VALUE_RANGE = {
    ("temperature", "C"): (-20000, 45000, 900),
    ("temperature", "F"): (-4000, 113000, 1600),
    ("temperature", "K"): (253150, 318150, 900),
    ("pressure", "kPa"): (95000, 106000, 220),
    ("pressure", "Pa"): (95000000, 106000000, 220000),
    ("pressure", "bar"): (950, 1060, 6),
    ("pressure", "psi"): (13000, 16000, 60),
    ("humidity", "pct"): (0, 100000, 2500),
    ("humidity", "frac"): (0, 1000, 25),
    ("flow", "lpm"): (0, 200000, 5000),
    ("flow", "lps"): (0, 3300, 90),
    ("flow", "gpm"): (0, 53000, 1400),
    ("voltage", "V"): (200000, 250000, 700),
    ("voltage", "mV"): (200000000, 250000000, 700000),
    ("voltage", "kV"): (200, 250, 3),
}

# (label, offset seconds).  Weighted by the pick table below.
OFFSETS = [
    ("Z", 0),
    ("+00:00", 0),
    ("+01:00", 3600),
    ("+02:00", 7200),
    ("-05:00", -18000),
    ("+05:30", 19800),
    ("-03:30", -12600),
    ("+09:00", 32400),
    ("+13:45", 49500),
    ("-11:00", -39600),
]
OFFSET_WEIGHTS = [300, 90, 120, 140, 130, 90, 40, 60, 20, 34]

KINDS = ["telemetry", "status", "audit"]
KIND_WEIGHTS = [700, 200, 100]

STATES = ["online", "offline", "degraded", "maintenance"]
ACTIONS = ["login", "logout", "config", "reboot"]
ACTORS = [
    "svc-rotator", "svc-collector", "ops.alice", "ops.bob", "ops.carol",
    "root", "fleet-agent", "cron", "installer", "api-gateway",
    "tech-1044", "tech-2210",
]

# Tag tokens, deliberately including forms that only become legal after the
# canonicalisation of SPEC.md section 5.4: mixed case, padding spaces, and
# interior spaces that collapse to underscores.
TAG_TOKENS = [
    "indoor", "outdoor", "calibrated", "Indoor", " CALIBRATED", "outdoor ",
    "rack-a", "rack-b", "rack_c", "hall  way", "cold aisle", "hot aisle",
    "v2", "v3", "primary", "backup", "tier.1", "tier.2", "shift:day",
    "shift:night", "audited", "AUDITED", "gen4", "spare",
]

TIMESTAMP_FMT = "%Y-%m-%dT%H:%M:%S"
UNIX_EPOCH = datetime(1970, 1, 1)

JITTER_LO = -90000   # milliseconds; arrivals lag events by up to 90s
JITTER_HI = 30000    # ...and lead them by up to 30s, so arrival order and
                     # event-time order genuinely disagree

BUF_LINES = 20000    # lines joined per write


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def fmt_milli(v):
    """Render a milli-unit integer as the decimal string of SPEC.md 1.1.3."""
    if v < 0:
        v = -v
        return "-%d.%03d" % (v // 1000, v % 1000)
    return "%d.%03d" % (v // 1000, v % 1000)


def parse_utc_ms(text):
    """Parse YYYY-MM-DDTHH:MM:SS.mmmZ into epoch milliseconds."""
    if len(text) != 24 or text[10] != "T" or text[23] != "Z" or text[19] != ".":
        raise ValueError("--start must look like 2024-03-05T00:00:00.000Z")
    dt = datetime.strptime(text[:19], TIMESTAMP_FMT)
    return int((dt - UNIX_EPOCH).total_seconds()) * 1000 + int(text[20:23])


def weighted_pick_table(items, weights, size):
    """Build a size-entry table so that table[n] is a weighted choice.

    Deterministic and allocation-free at draw time: the caller bit-slices an
    index out of a random draw and indexes straight into the table.
    """
    total = sum(weights)
    table = []
    for item, w in zip(items, weights):
        table.extend([item] * (size * w // total))
    while len(table) < size:
        table.append(items[-1])
    return table[:size]


def assemble(id_s, ts_s, dev_s, site_frag, kind_frag, tags_frag, tail_frag):
    """The one and only place a record line is composed.

    Mutators (below) call this too, so a well-formed line and a deliberately
    broken one differ only in the pieces handed in.
    """
    return '{"id":"%s","ts":"%s","dev":"%s"%s%s%s%s}' % (
        id_s, ts_s, dev_s, site_frag, kind_frag, tags_frag, tail_frag)


# --------------------------------------------------------------------------
# Mutators.  Each returns a complete line that violates exactly one rule of
# SPEC.md section 4, so that the generated corpus exercises every reject reason
# the specification defines.  The generator does not record which reason it
# expects: verify_output.py --recompute derives that independently.
# --------------------------------------------------------------------------

def m_truncate(rnd, p):
    line = assemble(*p)
    cut = rnd.randrange(12, max(13, len(line) - 2))
    return line[:cut]


def m_encoding(rnd, p):
    line = assemble(*p)
    pos = rnd.randrange(8, len(line) - 1)
    return line[:pos] + "\xa7" + line[pos + 1:]


def m_control_byte(rnd, p):
    line = assemble(*p)
    pos = rnd.randrange(8, len(line) - 1)
    return line[:pos] + "\r" + line[pos + 1:]


def m_empty(rnd, p):
    return "" if rnd.getrandbits(1) else "   "


def m_no_close(rnd, p):
    return assemble(*p)[:-1]


def m_double_comma(rnd, p):
    line = assemble(*p)
    return line.replace('","dev":"', '",,"dev":"', 1)


def m_bad_escape(rnd, p):
    q = list(p)
    q[5] = ',"tags":["in\\ndoor"]'
    return assemble(*q)


def m_not_object(rnd, p):
    return '[1,2,3]'


def m_missing_ts(rnd, p):
    q = list(p)
    return '{"id":"%s","dev":"%s"%s%s%s%s}' % (q[0], q[2], q[3], q[4], q[5], q[6])


def m_null_kind(rnd, p):
    q = list(p)
    q[4] = ',"kind":null,"payload":{}'
    return assemble(*q)


def m_bad_id(rnd, p):
    q = list(p)
    q[0] = "X" + q[0][1:]
    return assemble(*q)


def m_bad_dev(rnd, p):
    q = list(p)
    q[2] = "device-" + q[2][4:]
    return assemble(*q)


def m_bad_site(rnd, p):
    q = list(p)
    q[3] = ',"site":"site-7"'
    return assemble(*q)


def m_bad_ts_calendar(rnd, p):
    q = list(p)
    q[1] = "2024-02-30T11:04:07.500Z"
    return assemble(*q)


def m_bad_ts_grammar(rnd, p):
    q = list(p)
    q[1] = "2024-03-05 11:04:07.500Z"
    return assemble(*q)


def m_ts_out_of_range(rnd, p):
    q = list(p)
    q[1] = "2101-01-04T11:04:07.500Z"
    return assemble(*q)


def m_unknown_kind(rnd, p):
    q = list(p)
    q[4] = ',"kind":"sensor","payload":{"metric":"temperature","value":"1.000","unit":"C"}'
    return assemble(*q)


def m_bad_type_payload(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":"metric=temperature"'
    return assemble(*q)


def m_unknown_metric(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"torque","value":"12.500","unit":"C"}'
    return assemble(*q)


def m_unknown_unit(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"flow","value":"12.500","unit":"psi"}'
    return assemble(*q)


def m_bad_value(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"temperature","value":"21.75","unit":"C"}'
    return assemble(*q)


def m_value_out_of_range(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"temperature","value":"9999999.999","unit":"C"}'
    return assemble(*q)


def m_missing_value(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"temperature","unit":"C"}'
    return assemble(*q)


def m_bad_quality(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"humidity","value":"41.000","unit":"pct","quality":250}'
    return assemble(*q)


def m_bad_quality_type(rnd, p):
    q = list(p)
    q[4] = ',"kind":"telemetry","payload":{"metric":"humidity","value":"41.000","unit":"pct","quality":"97"}'
    return assemble(*q)


def m_bad_payload_state(rnd, p):
    q = list(p)
    q[4] = ',"kind":"status","payload":{"state":"sleeping","code":4}'
    return assemble(*q)


def m_bad_payload_action(rnd, p):
    q = list(p)
    q[4] = ',"kind":"audit","payload":{"actor":"root","action":"escalate"}'
    return assemble(*q)


def m_code_out_of_range(rnd, p):
    q = list(p)
    q[4] = ',"kind":"status","payload":{"state":"online","code":70000}'
    return assemble(*q)


def m_bad_tag_charset(rnd, p):
    q = list(p)
    q[5] = ',"tags":["indoor","cold/aisle"]'
    return assemble(*q)


def m_too_many_tags(rnd, p):
    q = list(p)
    q[5] = ',"tags":["a","b","c","d","e","f","g","h","i"]'
    return assemble(*q)


def m_bad_type_tags(rnd, p):
    q = list(p)
    q[5] = ',"tags":"indoor"'
    return assemble(*q)


def m_bad_type_seq(rnd, p):
    q = list(p)
    q[6] = ',"seq":"41"'
    return assemble(*q)


def m_boolean_seq(rnd, p):
    q = list(p)
    q[6] = ',"seq":true'
    return assemble(*q)


def m_seq_out_of_range(rnd, p):
    q = list(p)
    q[6] = ',"seq":4294967296'
    return assemble(*q)


MUTATORS = [
    m_truncate, m_encoding, m_control_byte, m_empty, m_no_close, m_double_comma,
    m_bad_escape, m_not_object, m_missing_ts, m_null_kind, m_bad_id, m_bad_dev,
    m_bad_site, m_bad_ts_calendar, m_bad_ts_grammar, m_ts_out_of_range,
    m_unknown_kind, m_bad_type_payload, m_unknown_metric, m_unknown_unit,
    m_bad_value, m_value_out_of_range, m_missing_value, m_bad_quality,
    m_bad_quality_type, m_bad_payload_state, m_bad_payload_action,
    m_code_out_of_range, m_bad_tag_charset, m_too_many_tags, m_bad_type_tags,
    m_bad_type_seq, m_boolean_seq, m_seq_out_of_range,
]


# --------------------------------------------------------------------------
# Devices
# --------------------------------------------------------------------------

def build_devices(rnd, n_devices, n_ghost, inactive_rate):
    """Table rows for the first n_devices ids, plus per-id display fragments
    for n_devices + n_ghost ids.  The ghost ids appear in the event stream but
    not in the table, which is what produces unknown_device rejects."""
    rows = []
    site_of = []
    total = n_devices + n_ghost
    for i in range(total):
        site = "SITE-%02d" % rnd.randrange(0, 40)
        site_of.append(site)
        if i < n_devices:
            region = REGIONS[rnd.randrange(len(REGIONS))]
            calib = rnd.randrange(-500, 501)
            active = 0 if rnd.random() < inactive_rate else 1
            rows.append((("dev-%06d" % i), site, region, calib, active))
    return rows, site_of


def write_devices(path, rows):
    with open(path, "w", encoding="ascii", newline="\n") as fh:
        fh.write("device_id\tsite_id\tregion\tcalibration_milli\tactive\n")
        for dev, site, region, calib, active in rows:
            fh.write("%s\t%s\t%s\t%d\t%d\n" % (dev, site, region, calib, active))


# --------------------------------------------------------------------------
# Timestamp table
# --------------------------------------------------------------------------

def build_second_table(lo_sec, hi_sec):
    """sec_str[s - lo_sec] == 'YYYY-MM-DDTHH:MM:SS' for the local wall clock."""
    out = []
    cur = UNIX_EPOCH + timedelta(seconds=lo_sec)
    step = timedelta(seconds=1)
    for _ in range(hi_sec - lo_sec + 1):
        out.append(cur.strftime(TIMESTAMP_FMT))
        cur += step
    return out


# --------------------------------------------------------------------------
# Tag fragments
# --------------------------------------------------------------------------

def build_tag_fragments(rnd, count):
    """Precomputed ,"tags":[...] fragments, including absent and empty forms."""
    frags = []
    for _ in range(count):
        roll = rnd.random()
        if roll < 0.30:
            frags.append("")                 # no tags key at all
            continue
        if roll < 0.36:
            frags.append(',"tags":[]')       # present but empty
            continue
        n = 1 + int((roll - 0.36) * 6.5)     # 1..4, deterministic in roll
        if n > 4:
            n = 4
        picked = [TAG_TOKENS[rnd.randrange(len(TAG_TOKENS))] for _ in range(n)]
        frags.append(',"tags":[%s]' % ",".join('"%s"' % t for t in picked))
    return frags


# --------------------------------------------------------------------------
# Main generation loop
# --------------------------------------------------------------------------

def generate(args):
    rnd = random.Random(args.seed)
    started = time.time()

    n_ghost = 200
    dev_rows, site_of = build_devices(rnd, args.devices, n_ghost,
                                      args.inactive_rate)
    total_devs = args.devices + n_ghost

    # Fixed source unit and independent random walk per (device, metric).
    n_slots = total_devs * len(METRICS)
    unit_of = [None] * n_slots
    value_of = [0] * n_slots
    for di in range(total_devs):
        for mi, metric in enumerate(METRICS):
            units = UNITS[metric]
            unit = units[rnd.randrange(len(units))]
            lo, hi, _step = VALUE_RANGE[(metric, unit)]
            slot = di * len(METRICS) + mi
            unit_of[slot] = unit
            value_of[slot] = rnd.randrange(lo, hi + 1)

    # Each device reports 3 of the 5 metrics, chosen without randomness so the
    # assignment is obvious and stable.
    metric_slots = [[(di + k) % len(METRICS) for k in range(3)]
                    for di in range(total_devs)]

    dev_str = ["dev-%06d" % i for i in range(total_devs)]
    site_frag_ok = [',"site":"%s"' % site_of[i] for i in range(total_devs)]
    site_frag_bad = [',"site":"SITE-%02d" ' % ((int(site_of[i][5:]) + 17) % 40)
                     for i in range(total_devs)]
    site_frag_bad = [s.rstrip() for s in site_frag_bad]

    # Payload prefix/suffix per (metric, unit): everything around the value.
    pay_head = {}
    pay_tail = {}
    for metric in METRICS:
        for unit in UNITS[metric]:
            pay_head[(metric, unit)] = (
                ',"kind":"telemetry","payload":{"metric":"%s","value":"' % metric)
            pay_tail[(metric, unit)] = '","unit":"%s"' % unit

    qual_frag = ["}"] + [',"quality":%d}' % q for q in range(101)]

    status_frags = []
    for state in STATES:
        status_frags.append(',"kind":"status","payload":{"state":"%s"}' % state)
        for code in (0, 4, 17, 42, 255, 1001, 65535):
            status_frags.append(
                ',"kind":"status","payload":{"state":"%s","code":%d}'
                % (state, code))
    audit_frags = []
    for actor in ACTORS:
        for action in ACTIONS:
            audit_frags.append(
                ',"kind":"audit","payload":{"actor":"%s","action":"%s"}'
                % (actor, action))

    tag_frags = build_tag_fragments(rnd, 1024)

    kind_pick = weighted_pick_table(KINDS, KIND_WEIGHTS, 1024)
    off_pick = weighted_pick_table(list(range(len(OFFSETS))), OFFSET_WEIGHTS, 1024)

    off_label = [o[0] for o in OFFSETS]
    off_secs = [o[1] for o in OFFSETS]
    off_suffix = [lab for lab in off_label]

    start_ms = parse_utc_ms(args.start)
    span_ms = args.span_minutes * 60000

    lo_sec = (start_ms + JITTER_LO) // 1000 + min(off_secs) - 2
    hi_sec = (start_ms + span_ms + JITTER_HI) // 1000 + max(off_secs) + 2
    sec_str = build_second_table(lo_sec, hi_sec)

    ms_str = [".%03d" % m for m in range(1000)]

    malformed_t = int(args.malformed_rate * 65536)
    duplicate_t = int(args.duplicate_rate * 65536)
    ghost_t = int(args.unknown_device_rate * 65536)
    mismatch_t = int(args.site_mismatch_rate * 65536)

    n_records = args.records
    n_metrics = len(METRICS)

    ring = [None] * 4096
    ring_fill = 0
    ring_pos = 0

    n_malformed = 0
    n_duplicate = 0
    n_ghost_used = 0
    n_mismatch = 0
    n_bytes = 0

    events_path = os.path.join(args.out, "events.ndjson")

    getrandbits = rnd.getrandbits
    randrange = rnd.randrange
    block = []
    block_append = block.append
    next_id = 1

    with open(events_path, "w", encoding="latin-1", newline="\n",
              buffering=1 << 20) as fh:
        write = fh.write
        for i in range(n_records):
            r = getrandbits(64)
            r2 = getrandbits(64)

            # ---- duplicate: replay an earlier well-formed line verbatim
            if (r2 >> 16) & 0xFFFF < duplicate_t and ring_fill:
                line = ring[randrange(ring_fill)]
                n_duplicate += 1
                block_append(line)
                if len(block) >= BUF_LINES:
                    chunk = "\n".join(block) + "\n"
                    write(chunk)
                    n_bytes += len(chunk)
                    del block[:]
                continue

            # ---- device
            if (r2 >> 32) & 0xFFFF < ghost_t:
                di = args.devices + randrange(n_ghost)
                n_ghost_used += 1
            else:
                di = randrange(args.devices)

            # ---- timestamp
            arrival_ms = start_ms + (i * span_ms) // n_records
            event_ms = arrival_ms + randrange(JITTER_LO, JITTER_HI + 1)
            oi = off_pick[(r >> 20) & 0x3FF]
            local_ms = event_ms + off_secs[oi] * 1000
            ts_s = (sec_str[local_ms // 1000 - lo_sec]
                    + ms_str[local_ms % 1000] + off_suffix[oi])

            # ---- site fragment
            if (r >> 30) & 0x3FF < 410:
                if (r2 >> 48) & 0xFFFF < mismatch_t:
                    site_frag = site_frag_bad[di]
                    n_mismatch += 1
                else:
                    site_frag = site_frag_ok[di]
            else:
                site_frag = ""

            # ---- kind and payload
            kind = kind_pick[r & 0x3FF]
            if kind == "telemetry":
                mi = metric_slots[di][(r >> 60) % 3]
                slot = di * n_metrics + mi
                metric = METRICS[mi]
                unit = unit_of[slot]
                lo, hi, step = VALUE_RANGE[(metric, unit)]
                v = value_of[slot] + randrange(-step, step + 1)
                if v < lo:
                    v = lo
                elif v > hi:
                    v = hi
                value_of[slot] = v
                q = (r >> 40) & 0x3FF
                if q < 120:
                    qf = qual_frag[0]              # quality absent
                elif q < 190:
                    qf = qual_frag[1 + (q % 50)]   # low quality, gets filtered
                else:
                    qf = qual_frag[1 + 50 + (q % 51)]
                key = (metric, unit)
                kind_frag = (pay_head[key] + fmt_milli(v) + pay_tail[key] + qf)
            elif kind == "status":
                kind_frag = status_frags[(r >> 40) % len(status_frags)]
            else:
                kind_frag = audit_frags[(r >> 40) % len(audit_frags)]

            # ---- optional trailing fields
            e = (r >> 50) & 0x3FF
            if e < 250:
                tail_frag = ',"seq":%d' % (i & 0xFFFF)
            elif e < 350:
                tail_frag = ',"_ingest":%d' % (i % 97)
            elif e < 400:
                tail_frag = ',"seq":%d,"_ingest":%d' % (i & 0xFFFF, i % 97)
            else:
                tail_frag = ""

            parts = (
                "E%010d" % next_id,
                ts_s,
                dev_str[di],
                site_frag,
                kind_frag,
                tag_frags[(r >> 10) & 0x3FF],
                tail_frag,
            )
            next_id += 1

            # ---- malformed injection
            if r2 & 0xFFFF < malformed_t:
                line = MUTATORS[randrange(len(MUTATORS))](rnd, parts)
                n_malformed += 1
            else:
                line = assemble(*parts)
                ring[ring_pos] = line
                ring_pos = (ring_pos + 1) & 4095
                if ring_fill < 4096:
                    ring_fill += 1

            block_append(line)
            if len(block) >= BUF_LINES:
                chunk = "\n".join(block) + "\n"
                write(chunk)
                n_bytes += len(chunk)
                del block[:]

        if block:
            chunk = "\n".join(block) + "\n"
            write(chunk)
            n_bytes += len(chunk)

    write_devices(os.path.join(args.out, "devices.tsv"), dev_rows)

    elapsed = time.time() - started
    manifest = {
        "generator": "gen_workload.py",
        "spec": "SPEC.md",
        "params": {
            "records": args.records,
            "seed": args.seed,
            "devices": args.devices,
            "ghost_devices": n_ghost,
            "malformed_rate": args.malformed_rate,
            "duplicate_rate": args.duplicate_rate,
            "unknown_device_rate": args.unknown_device_rate,
            "site_mismatch_rate": args.site_mismatch_rate,
            "inactive_rate": args.inactive_rate,
            "start": args.start,
            "span_minutes": args.span_minutes,
        },
        "injected": {
            "lines": args.records,
            "malformed": n_malformed,
            "duplicates": n_duplicate,
            "unknown_device": n_ghost_used,
            "site_mismatch": n_mismatch,
        },
        "bytes": {
            "events_ndjson": n_bytes,
            "devices_tsv": os.path.getsize(
                os.path.join(args.out, "devices.tsv")),
        },
        "generation_seconds": round(elapsed, 3),
    }
    with open(os.path.join(args.out, "manifest.json"), "w",
              encoding="ascii", newline="\n") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write("\n")

    return manifest


def main(argv):
    ap = argparse.ArgumentParser(
        description="Generate the deterministic etl-pipeline workload.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--out", default="data/main",
                    help="output directory; created if absent")
    ap.add_argument("--records", type=int, default=1200000,
                    help="number of lines written to events.ndjson")
    ap.add_argument("--seed", type=int, default=20260820,
                    help="RNG seed; same seed and flags give identical bytes")
    ap.add_argument("--devices", type=int, default=4000,
                    help="rows in devices.tsv")
    ap.add_argument("--malformed-rate", type=float, default=0.005,
                    help="fraction of lines deliberately broken")
    ap.add_argument("--duplicate-rate", type=float, default=0.002,
                    help="fraction of lines that replay an earlier record")
    ap.add_argument("--unknown-device-rate", type=float, default=0.004,
                    help="fraction of lines naming a device not in the table")
    ap.add_argument("--site-mismatch-rate", type=float, default=0.02,
                    help="fraction of site-carrying lines whose site is wrong")
    ap.add_argument("--inactive-rate", type=float, default=0.03,
                    help="fraction of table devices marked active=0")
    ap.add_argument("--start", default="2024-03-05T00:00:00.000Z",
                    help="UTC instant of the first arrival")
    ap.add_argument("--span-minutes", type=int, default=60,
                    help="arrival span; sets the number of 5-minute windows")
    ap.add_argument("--quiet", action="store_true",
                    help="suppress the summary written to stderr")
    args = ap.parse_args(argv)

    for name, value in (("--records", args.records),
                        ("--devices", args.devices),
                        ("--span-minutes", args.span_minutes)):
        if value < 1:
            ap.error("%s must be >= 1" % name)
    for name, value in (("--malformed-rate", args.malformed_rate),
                        ("--duplicate-rate", args.duplicate_rate),
                        ("--unknown-device-rate", args.unknown_device_rate),
                        ("--site-mismatch-rate", args.site_mismatch_rate),
                        ("--inactive-rate", args.inactive_rate)):
        if not 0.0 <= value < 1.0:
            ap.error("%s must be in [0.0, 1.0)" % name)

    os.makedirs(args.out, exist_ok=True)
    manifest = generate(args)

    if not args.quiet:
        inj = manifest["injected"]
        sys.stderr.write(
            "wrote %s\n"
            "  events.ndjson  %d lines, %d bytes\n"
            "  devices.tsv    %d bytes\n"
            "  injected       %d malformed, %d duplicate, %d unknown-device, "
            "%d site-mismatch\n"
            "  elapsed        %.2fs\n"
            % (args.out, inj["lines"], manifest["bytes"]["events_ndjson"],
               manifest["bytes"]["devices_tsv"], inj["malformed"],
               inj["duplicates"], inj["unknown_device"], inj["site_mismatch"],
               manifest["generation_seconds"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
