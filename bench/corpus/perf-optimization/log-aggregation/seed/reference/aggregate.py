#!/usr/bin/env python3
"""Reference log aggregator.

This is the behavioural specification for the log-aggregation task, expressed
as code. It is correct. It is also extremely slow, in the way that a first
draft written under deadline is slow: every output section is its own function,
every function re-reads and re-parses the whole file, and nothing is cached.

Do not change what it computes. FORMAT.md is the prose statement of the same
contract; where the two disagree, this file wins.

    python3 reference/aggregate.py <input.log> <output.json>
"""

from __future__ import annotations

import calendar
import datetime
import json
import re
import sys
from collections import OrderedDict

REQUIRED_KEYS = ["ts", "endpoint", "method", "status", "dur_ms", "bytes",
                 "session", "user", "region"]

CHECKOUT_ENDPOINT = "/api/v2/checkout"

TOP_ENDPOINTS = 20
TOP_USERS = 20
TOP_SLOWEST = 25
TOP_SESSIONS = 25
TOP_PATHS = 10
MAX_MALFORMED_SAMPLES = 10

# Column offsets into the flat record tuples that build_talkers materialises.
(R_LINE, R_TS, R_ENDPOINT, R_STATUS, R_DUR, R_BYTES, R_USER, R_REGION,
 R_SESSION) = range(9)


# --------------------------------------------------------------------- parse

def parse_line(line):
    """Return the record dict for one log line, or None if it is malformed.

    The validity rules are exactly those in FORMAT.md section 2.
    """
    text = line.rstrip("\n")
    if text == "":
        return None
    try:
        record = json.loads(text)
    except ValueError:
        return None
    if not isinstance(record, dict):
        return None

    keys = sorted(record.keys())
    if keys != sorted(REQUIRED_KEYS):
        return None

    timestamp_pattern = re.compile(
        r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
    ts = record["ts"]
    if not isinstance(ts, str) or timestamp_pattern.match(ts) is None:
        return None

    endpoint = record["endpoint"]
    if not isinstance(endpoint, str) or not endpoint.startswith("/"):
        return None

    for field in ("method", "session", "user", "region"):
        value = record[field]
        if not isinstance(value, str) or value == "":
            return None

    status = record["status"]
    if not isinstance(status, int) or isinstance(status, bool):
        return None
    if status < 100 or status > 599:
        return None

    for field in ("dur_ms", "bytes"):
        value = record[field]
        if not isinstance(value, int) or isinstance(value, bool):
            return None
        if value < 0:
            return None

    return record


def normalise_endpoint(raw):
    """Strip the query string and replace id-looking path segments."""
    numeric_pattern = re.compile(r"^[0-9]+$")
    hex_pattern = re.compile(r"^[0-9a-f]{32}$")

    path = raw.split("?")[0]

    mapped = []
    for segment in path.split("/"):
        if numeric_pattern.match(segment) is not None:
            mapped.append("{id}")
        elif hex_pattern.match(segment) is not None:
            mapped.append("{id}")
        else:
            mapped.append(segment)

    normalised = ""
    for index, segment in enumerate(mapped):
        if index == 0:
            normalised = segment
        else:
            normalised = normalised + "/" + segment
    return normalised


def minute_of(ts):
    """The minute bucket label for a timestamp, e.g. 2026-03-14T08:07Z."""
    moment = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ")
    return moment.strftime("%Y-%m-%dT%H:%MZ")


def epoch_millis(ts):
    """Milliseconds since the Unix epoch, as an exact integer."""
    moment = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ")
    seconds = calendar.timegm(moment.timetuple())
    return seconds * 1000 + moment.microsecond // 1000


def percentile(values, p):
    """Exact nearest-rank percentile. No sampling, no interpolation."""
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return None
    rank = -((-p * n) // 100)
    if rank < 1:
        rank = 1
    if rank > n:
        rank = n
    return ordered[rank - 1]


# ----------------------------------------------------------- section: meta

def build_meta(path):
    lines_read = 0
    records = 0
    malformed = 0
    samples = []

    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            lines_read = lines_read + 1
            if parse_line(line) is None:
                malformed = malformed + 1
                if len(samples) < MAX_MALFORMED_SAMPLES:
                    samples.append(lines_read)
            else:
                records = records + 1

    meta = OrderedDict()
    meta["input"] = path.split("/")[-1]
    meta["lines_read"] = lines_read
    meta["records"] = records
    meta["malformed"] = malformed
    meta["first_malformed_lines"] = samples
    return meta


# --------------------------------------------------------- section: buckets

def build_buckets(path):
    """Per (minute, endpoint, status) statistics, including exact percentiles."""
    durations = {}
    byte_totals = {}
    labels = {}

    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            record = parse_line(line)
            if record is None:
                continue

            endpoint = normalise_endpoint(record["endpoint"])
            minute = minute_of(record["ts"])
            status = record["status"]

            key = ""
            key = key + minute
            key = key + "|"
            key = key + endpoint
            key = key + "|"
            key = key + str(status)

            if key not in durations:
                durations[key] = []
                byte_totals[key] = 0
                labels[key] = (minute, endpoint, status)
            durations[key].append(record["dur_ms"])
            byte_totals[key] = byte_totals[key] + record["bytes"]

    ordered_keys = sorted(labels.keys(), key=lambda k: labels[k])

    buckets = []
    for key in ordered_keys:
        minute, endpoint, status = labels[key]
        values = durations[key]
        count = len(values)
        total = sum(values)

        bucket = OrderedDict()
        bucket["minute"] = minute
        bucket["endpoint"] = endpoint
        bucket["status"] = status
        bucket["count"] = count
        bucket["bytes"] = byte_totals[key]
        bucket["min_ms"] = min(values)
        bucket["max_ms"] = max(values)
        bucket["mean_ms"] = round(total / count, 4)
        bucket["p50_ms"] = percentile(values, 50)
        bucket["p95_ms"] = percentile(values, 95)
        bucket["p99_ms"] = percentile(values, 99)
        buckets.append(bucket)
    return buckets


# --------------------------------------------------------- section: talkers

def build_talkers(path):
    """Top-N tables plus the slowest individual requests.

    Every table below is produced by its own pass over the materialised record
    list, which is the shape this started out as and never grew out of.
    """
    records = []
    line_number = 0
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line_number = line_number + 1
            record = parse_line(line)
            if record is None:
                continue
            records.append((
                line_number,
                record["ts"],
                normalise_endpoint(record["endpoint"]),
                record["status"],
                record["dur_ms"],
                record["bytes"],
                record["user"],
                record["region"],
                record["session"],
            ))

    status_counts = {}
    for record in records:
        status = record[R_STATUS]
        status_counts[status] = status_counts.get(status, 0) + 1

    endpoint_counts = {}
    for record in records:
        endpoint = record[R_ENDPOINT]
        endpoint_counts[endpoint] = endpoint_counts.get(endpoint, 0) + 1

    endpoint_bytes = {}
    for record in records:
        endpoint = record[R_ENDPOINT]
        endpoint_bytes[endpoint] = endpoint_bytes.get(endpoint, 0) + record[R_BYTES]

    endpoint_durations = {}
    for record in records:
        endpoint = record[R_ENDPOINT]
        if endpoint not in endpoint_durations:
            endpoint_durations[endpoint] = []
        endpoint_durations[endpoint].append(record[R_DUR])

    user_bytes = {}
    for record in records:
        user = record[R_USER]
        user_bytes[user] = user_bytes.get(user, 0) + record[R_BYTES]

    user_counts = {}
    for record in records:
        user = record[R_USER]
        user_counts[user] = user_counts.get(user, 0) + 1

    region_counts = {}
    for record in records:
        region = record[R_REGION]
        region_counts[region] = region_counts.get(region, 0) + 1

    region_bytes = {}
    for record in records:
        region = record[R_REGION]
        region_bytes[region] = region_bytes.get(region, 0) + record[R_BYTES]

    status_totals = []
    for status in sorted(status_counts.keys()):
        entry = OrderedDict()
        entry["status"] = status
        entry["count"] = status_counts[status]
        status_totals.append(entry)

    ranked_endpoints = sorted(endpoint_counts.keys(),
                              key=lambda e: (-endpoint_counts[e], e))
    top_endpoints = []
    for endpoint in ranked_endpoints[:TOP_ENDPOINTS]:
        entry = OrderedDict()
        entry["endpoint"] = endpoint
        entry["count"] = endpoint_counts[endpoint]
        entry["bytes"] = endpoint_bytes[endpoint]
        entry["p99_ms"] = percentile(endpoint_durations[endpoint], 99)
        top_endpoints.append(entry)

    ranked_users = sorted(user_bytes.keys(), key=lambda u: (-user_bytes[u], u))
    top_users = []
    for user in ranked_users[:TOP_USERS]:
        entry = OrderedDict()
        entry["user"] = user
        entry["bytes"] = user_bytes[user]
        entry["count"] = user_counts[user]
        top_users.append(entry)

    ranked_regions = sorted(region_counts.keys(),
                            key=lambda r: (-region_counts[r], r))
    regions = []
    for region in ranked_regions:
        entry = OrderedDict()
        entry["region"] = region
        entry["count"] = region_counts[region]
        entry["bytes"] = region_bytes[region]
        regions.append(entry)

    by_duration = sorted(records, key=lambda r: (-r[R_DUR], r[R_LINE]))
    slowest = []
    for record in by_duration[:TOP_SLOWEST]:
        entry = OrderedDict()
        entry["line"] = record[R_LINE]
        entry["ts"] = record[R_TS]
        entry["endpoint"] = record[R_ENDPOINT]
        entry["status"] = record[R_STATUS]
        entry["dur_ms"] = record[R_DUR]
        entry["session"] = record[R_SESSION]
        slowest.append(entry)

    return status_totals, top_endpoints, top_users, regions, slowest


# -------------------------------------------------------- section: sessions

def build_sessions(path):
    """Reconstruct every session from the interleaved event stream."""
    events = {}
    line_number = 0
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line_number = line_number + 1
            record = parse_line(line)
            if record is None:
                continue
            session = record["session"]
            if session not in events:
                events[session] = []
            events[session].append((
                record["ts"],
                line_number,
                normalise_endpoint(record["endpoint"]),
                record["status"],
                record["user"],
            ))

    summaries = []
    for session in sorted(events.keys()):
        ordered = sorted(events[session], key=lambda e: (e[0], e[1]))

        first_ts = ordered[0][0]
        last_ts = ordered[-1][0]
        span_ms = epoch_millis(last_ts) - epoch_millis(first_ts)

        path_endpoints = []
        for event in ordered:
            if event[2] not in path_endpoints:
                path_endpoints.append(event[2])

        converted = False
        for event in ordered:
            if event[2] == CHECKOUT_ENDPOINT and event[3] == 200:
                converted = True

        summary = OrderedDict()
        summary["session"] = session
        summary["user"] = ordered[0][4]
        summary["events"] = len(ordered)
        summary["first_ts"] = first_ts
        summary["last_ts"] = last_ts
        summary["span_ms"] = span_ms
        summary["endpoints"] = path_endpoints
        summary["converted"] = converted
        summaries.append(summary)

    total = len(summaries)

    converted_total = 0
    for summary in summaries:
        if summary["converted"]:
            converted_total = converted_total + 1

    multi_endpoint = 0
    for summary in summaries:
        if len(summary["endpoints"]) > 1:
            multi_endpoint = multi_endpoint + 1

    path_counts = {}
    for summary in summaries:
        joined = " > ".join(summary["endpoints"])
        path_counts[joined] = path_counts.get(joined, 0) + 1

    ranked_paths = sorted(path_counts.keys(), key=lambda p: (-path_counts[p], p))
    top_paths = []
    for joined in ranked_paths[:TOP_PATHS]:
        entry = OrderedDict()
        entry["path"] = joined
        entry["count"] = path_counts[joined]
        top_paths.append(entry)

    longest = sorted(summaries, key=lambda s: (-s["span_ms"], s["session"]))

    sessions = OrderedDict()
    sessions["total"] = total
    sessions["converted"] = converted_total
    sessions["multi_endpoint"] = multi_endpoint
    sessions["longest"] = longest[:TOP_SESSIONS]
    sessions["top_paths"] = top_paths
    return sessions


# ---------------------------------------------------------------------- main

def build_report(input_path):
    report = OrderedDict()
    report["meta"] = build_meta(input_path)
    report["buckets"] = build_buckets(input_path)
    status_totals, top_endpoints, top_users, regions, slowest = \
        build_talkers(input_path)
    report["status_totals"] = status_totals
    report["top_endpoints"] = top_endpoints
    report["top_users"] = top_users
    report["regions"] = regions
    report["slowest_requests"] = slowest
    report["sessions"] = build_sessions(input_path)
    return report


def write_report(report, output_path):
    with open(output_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: aggregate.py <input.log> <output.json>\n")
        return 2
    report = build_report(argv[1])
    write_report(report, argv[2])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
