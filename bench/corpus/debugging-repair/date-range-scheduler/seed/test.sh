#!/usr/bin/env bash
# Run the test suite. Exits 0 only when every test passes.
set -euo pipefail

exec node --test 'test/*.test.ts'
