#!/usr/bin/env bash
# Nothing to compile: this is pure Python with vendored dependencies and no
# network access. The build step byte-compiles the tree (so a syntax error fails
# here rather than half way through the suite) and verifies that the vendored
# HTTP libraries are intact.
set -euo pipefail

PY="${PYTHON:-python3}"

"$PY" - <<'PYCHECK'
import sys
if sys.version_info < (3, 8):
    raise SystemExit("python 3.8+ required, found %s" % (sys.version.split()[0],))
print("python %s" % (sys.version.split()[0],))
PYCHECK

"$PY" -m compileall -q feedservice legacy_http modern_http wirenet tests > /dev/null
"$PY" -m modern_http._selfcheck > /dev/null
echo "build ok"
