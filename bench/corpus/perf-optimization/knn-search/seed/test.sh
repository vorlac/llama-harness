#!/usr/bin/env bash
# Verify the solution: exact-output correctness first, then the speed target.
# Exits 0 if and only if both pass. This is what the scorer runs.
#
# Env:
#   SKIP_BUILD=1   do not rebuild first
#   BENCH_ARGS=... extra arguments for tools/bench.py (e.g. --no-cache)
set -euo pipefail
cd "$(dirname "$0")"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  bash build.sh
fi

"${PYTHON:-python3}" tools/unpack_sample.py
"${PYTHON:-python3}" tools/verify_correctness.py
"${PYTHON:-python3}" tools/bench.py --check-target --json-out bench-result.json ${BENCH_ARGS:-}
