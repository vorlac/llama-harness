#!/usr/bin/env bash
# Convenience wrapper: everything this workspace does is reached through vm.sh.
set -euo pipefail
exec bash "$(dirname "$0")/vm.sh" "$@"
