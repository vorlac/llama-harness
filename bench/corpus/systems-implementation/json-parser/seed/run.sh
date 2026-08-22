#!/usr/bin/env bash
# The three modes of SPEC.md section 4, all reaching src/main.py.
#
# Invoked as `bash run.sh ...` rather than `./run.sh ...`: this workspace is
# seeded from a text manifest, which carries file contents and not file modes,
# so nothing here is executable.
set -euo pipefail
# No .pyc files: this workspace is under version control during the run,
# and a cache directory appearing under src/ is a source change that is
# not one.
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$(dirname "$0")/src/main.py" "$@"
