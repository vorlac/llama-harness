#!/usr/bin/env bash
set -euo pipefail

# $1 is the data directory; defaults to the one shipped with the task.
DATA_DIR="${1:-data}"
exec python3 -m ledger "$DATA_DIR"
