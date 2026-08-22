#!/usr/bin/env bash
# The frozen behavioural suite, then the migration-completeness check.
#
# On the pristine starting code the completeness check reports "baseline" and
# passes. Once any part of the service imports modern_http it switches to strict
# mode: see scripts/check_migration.sh.
set -euo pipefail

PY="${PYTHON:-python3}"

"$PY" -m unittest discover -s tests -t . -v
scripts/check_migration.sh
