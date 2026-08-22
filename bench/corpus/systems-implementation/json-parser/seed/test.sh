#!/usr/bin/env bash
# The visible check: the seventeen worked exchanges of reference-io/.
#
# This is protocol plumbing plus one example of each error class that is
# easiest to get subtly wrong. It is not the grader. The graded run is a
# conformance suite this workspace does not contain, and passing everything
# here says only that the harness speaks the protocol and the common path
# works.
#
# Add checks of your own below. Do not weaken the command already here.
set -euo pipefail
# No .pyc files: this workspace is under version control during the run,
# and a cache directory appearing under src/ is a source change that is
# not one.
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"

echo "== reference-io plumbing check =="
python3 reference-io/check_io.py --cwd . -- bash run.sh --harness
