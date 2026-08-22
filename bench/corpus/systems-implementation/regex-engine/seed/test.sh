#!/usr/bin/env bash
# The visible check: the six worked sessions of reference-io/.
#
# This is protocol plumbing plus one worked example of each reply shape. It is
# not the grader. The graded run is a conformance suite this workspace does not
# contain, and passing everything here says only that the harness speaks the
# protocol and the common path works.
#
# Add checks of your own below. Do not weaken the command already here.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"

echo "== reference-io plumbing check =="
python3 reference-io/check_io.py --cwd . -- bash run.sh
