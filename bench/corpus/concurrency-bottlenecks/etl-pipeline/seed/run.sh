#!/usr/bin/env bash
#
# Run the pipeline. See SPEC.md section 7.1 for the argument contract:
#
#   bash run.sh [EVENTS_PATH] [DEVICES_PATH] [OUT_DIR] [WORKERS]
#
# Every argument is optional and positional, and each falls back to an
# environment variable and then to a default. Nothing is written to stdout.
#
# Python is launched as "${ETL_PYTHON:-python3}". The benchmark exports
# ETL_PYTHON as the interpreter it is itself running under and runs the
# baseline under that same one, so both sides of the ratio use one CPython.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_EVENTS="data/main/events.ndjson"
DEFAULT_DEVICES="data/main/devices.tsv"
DEFAULT_OUT="./out"
DEFAULT_WORKERS="0"

if [ "$#" -gt 4 ]; then
    echo "usage: run.sh [EVENTS_PATH] [DEVICES_PATH] [OUT_DIR] [WORKERS]" >&2
    exit 2
fi

events="${1:-${ETL_EVENTS:-$DEFAULT_EVENTS}}"
devices="${2:-${ETL_DEVICES:-$DEFAULT_DEVICES}}"
out="${3:-${ETL_OUT:-$DEFAULT_OUT}}"
workers="${4:-${ETL_WORKERS:-$DEFAULT_WORKERS}}"

PYTHONPATH="$here${PYTHONPATH:+:$PYTHONPATH}" exec "${ETL_PYTHON:-python3}" -m etl \
    --events "$events" \
    --devices "$devices" \
    --out "$out" \
    --workers "$workers"
