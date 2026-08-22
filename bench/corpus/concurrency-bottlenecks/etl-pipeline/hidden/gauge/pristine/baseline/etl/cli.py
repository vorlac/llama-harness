"""Command line entry point (SPEC.md section 7).

`run.sh` is the normative surface; this module implements the flags it passes
through, the same defaults and environment fallbacks, and the exit codes of
section 7.2.  Nothing is ever written to stdout.
"""

import argparse
import os
import re
import sys
import time

from .config import (EXIT_DEVICES, EXIT_EVENTS, EXIT_INTERNAL, EXIT_OK,
                     EXIT_OUTPUT, EXIT_USAGE, REJECT_REASONS)
from .devices import DeviceTableError, load_device_table
from .output import WindowWriter, write_summary
from .pipeline import Pipeline

DEFAULT_EVENTS = "data/main/events.ndjson"
DEFAULT_DEVICES = "data/main/devices.tsv"
DEFAULT_OUT = "./out"
DEFAULT_WORKERS = "0"

WORKERS_PATTERN = r"\A(?:0|[1-9][0-9]*)\Z"


def build_parser():
    parser = argparse.ArgumentParser(
        prog="etl",
        description="Window a newline-delimited event stream into aggregates.")
    parser.add_argument("--events",
                        default=os.environ.get("ETL_EVENTS", DEFAULT_EVENTS),
                        help="path to events.ndjson")
    parser.add_argument("--devices",
                        default=os.environ.get("ETL_DEVICES", DEFAULT_DEVICES),
                        help="path to devices.tsv")
    parser.add_argument("--out",
                        default=os.environ.get("ETL_OUT", DEFAULT_OUT),
                        help="directory the three output files are written to")
    parser.add_argument("--workers",
                        default=os.environ.get("ETL_WORKERS", DEFAULT_WORKERS),
                        help="transform workers; 0 chooses from the hardware")
    return parser


def resolve_workers(requested):
    """Section 7.1: 0 means choose, anything >= 1 is a hard request."""
    if requested >= 1:
        return requested
    return os.cpu_count() or 1


def summary_values(pipeline, window_rows):
    counters = pipeline.counters
    values = {
        "input_lines": counters.input_lines,
        "rejected_total": counters.rejected_total(),
        "dropped_inactive": counters.dropped_inactive,
        "dropped_non_telemetry": counters.dropped_non_telemetry,
        "dropped_low_quality": counters.dropped_low_quality,
        "aggregated_records": counters.aggregated_records,
        "window_rows": window_rows,
        "distinct_devices": pipeline.windows.distinct_device_count(),
        "sum_milli_total": pipeline.windows.total_sum_milli(),
    }
    for reason in REJECT_REASONS:
        values["rejected_" + reason] = counters.rejected[reason]
    return values


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)

    if re.compile(WORKERS_PATTERN).match(str(args.workers)) is None:
        sys.stderr.write("etl: --workers must be a non-negative integer, "
                         "got %r\n" % args.workers)
        return EXIT_USAGE
    workers = resolve_workers(int(args.workers))

    if not os.path.isfile(args.events):
        sys.stderr.write("etl: cannot read events file %s\n" % args.events)
        return EXIT_EVENTS

    try:
        device_table = load_device_table(args.devices)
    except DeviceTableError as exc:
        sys.stderr.write("etl: %s\n" % exc)
        return EXIT_DEVICES

    try:
        os.makedirs(args.out, exist_ok=True)
    except OSError as exc:
        sys.stderr.write("etl: cannot create %s: %s\n" % (args.out, exc))
        return EXIT_OUTPUT

    started = time.time()
    pipeline = Pipeline(device_table, workers)
    try:
        pipeline.run(args.events)
    except OSError as exc:
        sys.stderr.write("etl: cannot read %s: %s\n" % (args.events, exc))
        return EXIT_EVENTS

    try:
        writer = WindowWriter(args.out)
        window_rows = 0
        for row in pipeline.windows.rows():
            writer.append(row)
            window_rows += 1
        pipeline.reject_log.write(args.out)
        write_summary(args.out, summary_values(pipeline, window_rows))
    except OSError as exc:
        sys.stderr.write("etl: cannot write into %s: %s\n" % (args.out, exc))
        return EXIT_OUTPUT

    elapsed = time.time() - started
    sys.stderr.write(
        "etl: %d lines, %d windows, %d rejects, %d workers, %.2fs\n"
        % (pipeline.counters.input_lines, window_rows,
           len(pipeline.reject_log), workers, elapsed))
    return EXIT_OK


def run():
    try:
        return main(sys.argv[1:])
    except KeyboardInterrupt:
        return EXIT_INTERNAL
    except Exception as exc:                 # pragma: no cover - last resort
        sys.stderr.write("etl: internal error: %r\n" % (exc,))
        return EXIT_INTERNAL
