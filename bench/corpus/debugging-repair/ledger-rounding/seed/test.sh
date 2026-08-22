#!/usr/bin/env bash
#
# The visible suite: standard-library unittest over tests/. Nothing to install.

set -euo pipefail
cd "$(dirname "$0")"

exec "${LEDGER_PYTHON:-python3}" -m unittest discover --start-directory tests \
    --top-level-directory .
