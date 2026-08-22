#!/usr/bin/env bash
# The harness entry point of SPEC.md section 3.1.
#
# The graded runner spawns this file directly and needs it executable, which
# the seeding path cannot carry, so the runner restores the mode first. From a
# shell, `bash vm.sh version` works either way.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/src/main.py" "$@"
