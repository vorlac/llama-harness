#!/usr/bin/env bash
# Build one report against the demo upstreams and print it as JSON on stdout.
#
#   bash run.sh [scenario]
#
# The optional argument selects one of the fake upstream worlds in
# feedservice/demo_upstreams.py; it defaults to "default". Counters go to
# stderr.
set -euo pipefail

PY="${PYTHON:-python3}"
SCENARIO="${1:-default}"

exec "$PY" -m feedservice.cli --scenario "$SCENARIO" --live --stats
