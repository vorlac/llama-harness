#!/usr/bin/env bash
# Preparation before a run. The aggregator is pure standard-library Python, so
# there is nothing to compile and nothing to fetch; the script exists because
# run.sh and test.sh are contracted to have a build step beside them.
set -euo pipefail
cd "$(dirname "$0")"

echo "build ok (nothing to compile)" >&2
