#!/usr/bin/env bash
# Start the server of SPEC.md section 2.
#
# The graded runner spawns this file directly and needs it executable, which
# the seeding path cannot carry, so the runner makes it executable first. From
# a shell, `bash run.sh --port 7000` works either way.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/src/main.py" "$@"
