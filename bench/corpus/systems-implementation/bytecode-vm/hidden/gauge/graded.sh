#!/usr/bin/env bash
# The graded run.
#
# The conformance runner spawns vm.sh directly and refuses one that is not
# executable. The work tree is seeded from a text manifest, which carries file
# contents and not file modes, so the mode is restored here rather than asked
# of the workspace.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x vm.sh
exec /usr/bin/python3 gauge/run_conformance.py --vm ./vm.sh "$@"
