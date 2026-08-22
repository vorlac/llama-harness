#!/usr/bin/env bash
# The full gate: byte-equality against the reference, then the speed target.
# Exits 0 if and only if both pass.
#
# The benchmark needs the canonical workload. Generate it once with
#   python3 tools/generate_workload.py --lines 1500000 --seed 20260320 \
#       --minutes 240 --out data/access.log
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"

"$PYTHON" tools/check_correctness.py --candidate "bash run.sh"
"$PYTHON" tools/bench.py --input data/access.log --candidate "bash run.sh" --runs 5
