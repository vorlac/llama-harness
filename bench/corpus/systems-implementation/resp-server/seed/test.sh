#!/usr/bin/env bash
# The visible check: the eight smoke cases of reference-io/smoke.json.
#
# This is the harness contract end to end - framing, pipelining, two
# connections, one error of each shape - and it is not the grader. The graded
# run is a conformance suite this workspace does not contain, and passing
# everything here says only that the plumbing works.
#
# Add checks of your own below. Do not weaken the command already here.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"

echo "== reference-io smoke check =="
python3 reference-io/smoke.py --run-sh run.sh
