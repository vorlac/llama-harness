#!/usr/bin/env bash
# Run the demonstration workload. This task takes no input file; any argument
# is accepted and ignored so the workspace contract stays uniform.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
if [ ! -x build/lru_demo ]; then
  make all >&2
fi
exec ./build/lru_demo
