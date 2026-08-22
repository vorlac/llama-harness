#!/usr/bin/env bash
# Type-check the project.
#
# There are no dependencies to install: the project is plain TypeScript run by
# Node's built-in type stripping, and types/node-builtins.d.ts stands in for
# @types/node so that tsc needs no node_modules.
#
# If a TypeScript compiler is available it is authoritative and any type error
# fails the build. If none is installed, the build degrades to a parse check
# (see scripts/parse-check.mjs), reports that type checking was SKIPPED on
# stderr, and still exits 0 so the rest of the harness can run.
set -euo pipefail

find_tsc() {
  local candidate
  for candidate in "./node_modules/.bin/tsc" "$(command -v tsc 2>/dev/null || true)"; do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue
    # Guard against unrelated programs called "tsc": the TypeScript compiler
    # prints "Version <n>.<n>...". npx is deliberately not consulted, because it
    # would try to reach the network.
    if "$candidate" --version 2>/dev/null | grep -Eq '^Version [0-9]+\.[0-9]+'; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if TSC="$(find_tsc)"; then
  echo "build: type checking with $TSC ($("$TSC" --version))" >&2
  "$TSC" -p tsconfig.json
  echo "build: type check OK" >&2
else
  echo "build: no TypeScript compiler found - TYPE CHECK SKIPPED" >&2
  echo "build: falling back to a parse check of src/" >&2
  node scripts/parse-check.mjs src
fi

echo "build: ok" >&2
