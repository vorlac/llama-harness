#!/usr/bin/env bash
#
# The visible check: run the pipeline over the small workload and require the
# three output files to be byte-exact against an independent implementation of
# SPEC.md. Generates data/small the first time, because the workloads are
# derived from a seed rather than committed.
#
# This says nothing about speed. tools/bench.py is the ratio.

set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${ETL_PYTHON:-python3}"

if [ ! -f data/small/events.ndjson ]; then
    echo "test.sh: generating data/small" >&2
    "$PYTHON" tools/gen_workload.py --out data/small --records 20000 --seed 7 \
        --devices 120 --quiet
fi

bash build.sh
bash run.sh data/small/events.ndjson data/small/devices.tsv out/small 4

"$PYTHON" tools/verify_output.py \
    --events data/small/events.ndjson \
    --devices data/small/devices.tsv \
    --out out/small --recompute
