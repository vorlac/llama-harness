#!/usr/bin/env bash
# Load every module so a syntax or import error fails the build. There is
# nothing to compile: Node runs the TypeScript sources directly by stripping
# the type annotations, and the package has no dependencies to install.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "node is not on PATH" >&2
  exit 1
fi

echo "node $(node --version)" >&2

node -e 'import("./src/index.ts").then(
  () => { process.exit(0); },
  (error) => { console.error(error); process.exit(1); },
);'

echo "build ok" >&2
