#!/usr/bin/env bash
# Aggregate one log file into one report.
#
#   bash run.sh [INPUT_LOG] [OUTPUT_JSON]
#
# Defaults: data/access.log -> out/report.json.
#
# It delegates to reference/aggregate.py, which is correct and slow. Point it
# at the implementation you write instead; leave reference/aggregate.py alone,
# because the correctness suite and the benchmark both execute it as the thing
# you are measured against.
#
# Python is launched as "${LOGAGG_PYTHON:-python3}". The harness exports
# LOGAGG_PYTHON as the interpreter it is itself running under and runs the
# reference under that same one, so both sides of the ratio use one CPython.
# Hardcoding an interpreter here turns the measurement into a comparison of
# Python releases.
set -euo pipefail
cd "$(dirname "$0")"

IN="${1:-data/access.log}"
OUT="${2:-out/report.json}"

mkdir -p "$(dirname "$OUT")"
exec "${LOGAGG_PYTHON:-python3}" reference/aggregate.py "$IN" "$OUT"
