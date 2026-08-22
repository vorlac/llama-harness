#!/usr/bin/env bash
# The graded run.
#
# The conformance runner spawns run.sh directly and refuses a run.sh that is
# not executable. The work tree is seeded from a text manifest, which carries
# file contents and not file modes, so the mode is restored here rather than
# asked of the workspace.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x run.sh
exec /usr/bin/python3 gauge/run_conformance.py --run-sh ./run.sh "$@"
