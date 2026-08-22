#!/usr/bin/env bash
# The visible check: the checklist in reference-io/README.md.
#
# Five worked programs, byte-exact assembly and disassembly, the round trip,
# the traces, the collector and the trap. It is not the grader. The graded run
# is a conformance suite this workspace does not contain, and passing
# everything here says only that the plumbing works.
#
# Add checks of your own below. Do not weaken the command already here.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")"

echo "== reference-io checklist =="
python3 reference-io/check_refio.py --vm vm.sh
