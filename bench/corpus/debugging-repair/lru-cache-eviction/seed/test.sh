#!/usr/bin/env bash
# Run the test suite. Exits 0 only when every test passes.
# An optional argument filters tests by name substring, e.g.
#   ./test.sh purge
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
make -s build/lru_tests >&2
exec ./build/lru_tests "${1:-}"
