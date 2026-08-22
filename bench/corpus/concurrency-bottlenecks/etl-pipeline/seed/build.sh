#!/usr/bin/env bash
#
# Nothing to compile: the pipeline is pure Python and uses only the standard
# library. This checks that the interpreter it needs is present.

set -euo pipefail

PYTHON="${ETL_PYTHON:-python3}"

if ! command -v "$PYTHON" >/dev/null 2>&1 && [ ! -x "$PYTHON" ]; then
    echo "build.sh: $PYTHON not found" >&2
    exit 1
fi

if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
    echo "build.sh: python 3.9 or newer is required, found $("$PYTHON" -V 2>&1)" >&2
    exit 1
fi

echo "build.sh: $("$PYTHON" -V 2>&1), no build step required" >&2
