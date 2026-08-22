#!/usr/bin/env bash
# Compile the library, the demo binary and the test binary into build/.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
make clean
make all
