#!/usr/bin/env bash
# Expand a schedule file and print the calendar it produces.
#   ./run.sh [path/to/schedule.json]
# Defaults to data/sample-schedule.json.
set -euo pipefail

SCHEDULE="${1:-data/sample-schedule.json}"
exec node src/cli.ts "$SCHEDULE"
