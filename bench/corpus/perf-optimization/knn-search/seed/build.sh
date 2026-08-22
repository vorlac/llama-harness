#!/usr/bin/env bash
# Build the reference, the generator and your solution.
#
# The reference and the generator are built with FIXED flags: the baseline this
# task is scored against must be reproducible, so REFERENCE_FLAGS is not yours
# to change. SOLUTION_FLAGS is.
set -euo pipefail
cd "$(dirname "$0")"

CXX="${CXX:-c++}"
PYTHON="${PYTHON:-python3}"

# sample/base.bin and sample/queries.bin travel as base64 text and are
# decoded here, before anything that reads them runs.
"$PYTHON" tools/unpack_sample.py

# FIXED - do not change. A normal release build of the baseline.
REFERENCE_FLAGS="-O2 -std=c++17 -DNDEBUG"

# YOURS - change freely. Add -march=native / -mcpu=native, -pthread, -O3,
# whatever you need. Keep it portable enough that build.sh still succeeds on a
# machine that is not this one: if you use an architecture-specific flag, probe
# for it and fall back rather than hard-failing.
SOLUTION_FLAGS="${SOLUTION_FLAGS:--O2 -std=c++17 -DNDEBUG}"

mkdir -p build

echo "building reference   ($REFERENCE_FLAGS)" >&2
$CXX $REFERENCE_FLAGS -I src -o build/knn_reference src/knn_reference.cpp

echo "building generator   ($REFERENCE_FLAGS)" >&2
$CXX $REFERENCE_FLAGS -o build/gen_workload tools/gen_workload.cpp

echo "building solution    ($SOLUTION_FLAGS)" >&2
$CXX $SOLUTION_FLAGS -I src -o build/knn_solution src/knn_solution.cpp

echo "build ok" >&2
