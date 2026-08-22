#!/usr/bin/env bash
# Start relay, exercise it over the loopback, and exit.
#
# $1, when given, is the path to a JSON config file; otherwise the bundled
# config/relay.config.json is used. --port 0 is passed on the command line so
# the demo binds an ephemeral port regardless of what the file says, which also
# demonstrates that the command line outranks the file.
set -euo pipefail

CONFIG="${1:-config/relay.config.json}"

exec node src/cli/main.ts --demo --config "$CONFIG" --port 0
