#!/usr/bin/env bash
# Run the test suite. Exits 0 only if every test passes.
#
# The suite uses node:test and node:assert only; there is nothing to install.
set -euo pipefail

exec node --test test/config-precedence.test.ts \
                test/config-validation.test.ts \
                test/observability.test.ts \
                test/pipeline.test.ts \
                test/server.test.ts \
                test/storage.test.ts
