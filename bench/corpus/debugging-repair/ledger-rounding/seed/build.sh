#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# No third-party dependencies and no network access: the "build" is a syntax
# check plus a confirmation that the package imports.
PYTHON="${LEDGER_PYTHON:-python3}"

"$PYTHON" --version
"$PYTHON" -m compileall -q ledger tests
"$PYTHON" -c "import ledger; print('ledger', ledger.__version__)"
