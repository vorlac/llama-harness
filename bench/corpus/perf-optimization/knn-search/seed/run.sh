#!/usr/bin/env bash
# Run your solution on a workload.
#
#   ./run.sh [workload-dir]
#
# With no argument it uses WORKLOAD_DIR from workload.conf and generates that
# workload first if it is not there yet. Results are written to out/results.txt.
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=workload.conf
source ./workload.conf

WORKLOAD="${1:-$WORKLOAD_DIR}"

if [ ! -x build/knn_solution ]; then
  echo "run.sh: build/knn_solution is missing - run ./build.sh first" >&2
  exit 1
fi

if [ ! -f "$WORKLOAD/base.bin" ]; then
  if [ "$WORKLOAD" = "$WORKLOAD_DIR" ]; then
    echo "run.sh: generating the canonical workload in $WORKLOAD" >&2
    ./build/gen_workload --n "$N" --d "$D" --queries "$QUERIES" --k "$K" \
                         --seed "$SEED" --out "$WORKLOAD"
  else
    echo "run.sh: no base.bin in $WORKLOAD" >&2
    exit 1
  fi
fi

mkdir -p out
./build/knn_solution --workload "$WORKLOAD" --out out/results.txt
