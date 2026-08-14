#!/usr/bin/env bash
# Conductor build: canonical test gate (M1 + M3). Authored and owned by the build
# orchestrator; subagents must never edit this file.
#
# NEVER invoke `node --test` directly for a gate decision. On node v26.7.0:
#   - a directory positional is resolved as a module -> a bogus "failing test"
#     (MODULE_NOT_FOUND) that looks exactly like a legitimate red;
#   - a glob matching zero files exits 0 -> a vacuous green.
# Both behaviors re-verified 2026-08-12; transcript in docs/build/GATES.json.
#
# This wrapper parses the TAP trailer and fails unless:
#   tests > 0, fail == 0, cancelled == 0, skipped == 0, todo == 0.
# The skipped/todo rejection closes the "turn a hard test into a skip" erosion route.
# Once conductor/tsconfig.json exists (Task 0.3), it also typechecks (M3).
set -u

GLOB="${1:-conductor/tests/**/*.test.ts}"
# Convert a directory arg into a glob so node never sees a directory positional.
if [ -d "$GLOB" ]; then
  GLOB="${GLOB%/}/**/*.test.ts"
fi

OUT="$(node --test --test-reporter=tap "$GLOB" 2>&1)"
EC=$?

count() { printf '%s\n' "$OUT" | awk -v k="$1" '$1=="#" && $2==k {v=$3} END{print v+0}'; }
TESTS=$(count tests); PASS=$(count pass); FAIL=$(count fail)
CANC=$(count cancelled); SKIP=$(count skipped); TODO=$(count todo)
# describe-level skips are invisible to the trailer counts on node 26.7.0: a skipped
# SUITE reports "# suites 1" with "# skipped 0" (phase-0 gate finding, C-015). Catch
# every SKIP/TODO directive on TAP point lines instead, at any subtest depth.
DIRECTIVES=$(printf '%s\n' "$OUT" | grep -cE '^[[:space:]]*(not )?ok [0-9]+.*# (SKIP|TODO)' || true)

echo "TAP: tests=$TESTS pass=$PASS fail=$FAIL cancelled=$CANC skipped=$SKIP todo=$TODO skipdirectives=$DIRECTIVES (node exit=$EC)"

BAD=0
[ "$TESTS" -eq 0 ] && { echo "GATE FAIL: zero tests ran (wrong glob or empty suite)"; BAD=1; }
[ "$FAIL" -gt 0 ] && { echo "GATE FAIL: $FAIL test(s) failing"; BAD=1; }
[ "$CANC" -gt 0 ] && { echo "GATE FAIL: $CANC test(s) cancelled"; BAD=1; }
[ "$SKIP" -gt 0 ] && { echo "GATE FAIL: $SKIP test(s) skipped (skips forbidden, G4)"; BAD=1; }
[ "$TODO" -gt 0 ] && { echo "GATE FAIL: $TODO todo test(s) (todos forbidden, G4)"; BAD=1; }
[ "$DIRECTIVES" -gt 0 ] && { echo "GATE FAIL: $DIRECTIVES SKIP/TODO directive(s) in TAP output (describe-level skips evade the trailer counts, C-015)"; BAD=1; }
if [ "$EC" -ne 0 ] && [ "$BAD" -eq 0 ]; then
  echo "GATE FAIL: node exited $EC despite clean TAP counts (investigate)"; BAD=1
fi

if [ "$BAD" -ne 0 ]; then
  echo "---- failure excerpt (non-ok lines) ----"
  printf '%s\n' "$OUT" | grep -vE '^ok ' | tail -60
  exit 1
fi

# M3 typecheck leg (active from Task 0.3 onward).
TSC=conductor/node_modules/.bin/tsc
if [ -f conductor/tsconfig.json ]; then
  if [ ! -x "$TSC" ]; then
    echo "GATE FAIL: conductor/tsconfig.json exists but tsc is not installed (npm install in conductor/)"
    exit 1
  fi
  if ! "$TSC" -p conductor/tsconfig.json --noEmit; then
    echo "GATE FAIL: typecheck (tsc --noEmit)"
    exit 1
  fi
  echo "typecheck: OK"
fi

# M9 bun leg (active from Task 2.2 onward): the dual-runtime smoke (G14) must pass
# under Bun as well as Node. Runs ONLY the single bun-smoke file, not the whole suite
# (only that file is authored to be runtime-agnostic). bun 1.3.14 was installed at
# preflight (C-002), so this leg is ACTIVE; a loud SKIP only if bun ever disappears.
BUN_SMOKE=conductor/tests/bun-smoke.test.ts
if [ -f "$BUN_SMOKE" ]; then
  if command -v bun >/dev/null 2>&1; then
    if ! bun test "$BUN_SMOKE" >/tmp/bun-smoke.out 2>&1; then
      echo "GATE FAIL: bun leg (bun test $BUN_SMOKE) — G14 dual-runtime divergence"
      tail -30 /tmp/bun-smoke.out
      exit 1
    fi
    echo "bun leg: OK ($(grep -Eo '[0-9]+ pass' /tmp/bun-smoke.out | head -1))"
  else
    echo "GATE WARN: bun absent — bun-smoke leg SKIPPED (loud notice; bun was installed at preflight, so this is a regression to investigate)"
  fi
fi

# §11.1 schema export: regenerate the §2 JSON Schemas (from core/types.ts SCHEMAS,
# the single source) into router/tests/schemas/ so the C++ router-tests (Task
# 11.6) validate against the exact same objects the fan-out engine uses. A
# GENERATION step, not a pass/fail assertion (export-schemas.test.ts covers
# correctness); a nonzero exit means the exporter itself is broken.
if [ -f conductor/tools/export-schemas.ts ]; then
  if ! node conductor/tools/export-schemas.ts router/tests/schemas >/dev/null 2>&1; then
    echo "GATE FAIL: export-schemas.ts failed to run (§11.1 schema export)"
    exit 1
  fi
  echo "schema export: OK (router/tests/schemas/)"
fi

# §12.1 python leg: scripts/conductor_wiring.py and its unittest, on the pinned
# /usr/bin/python3 (3.9.6, STATE.json meta.environment). Placed AFTER the schema
# export so router/tests/schemas/RouterConfig.schema.json is fresh when the
# RouterConfig parity test reads it. The leg starts no server, opens no socket and
# writes nothing under .data/ or .out/.
if ! /usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py' >/tmp/python-leg.out 2>&1; then
  echo "GATE FAIL: python leg (/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py')"
  tail -60 /tmp/python-leg.out
  exit 1
fi
# unittest discover exits 0 on "Ran 0 tests" — the same vacuous-green hole the node
# leg exists to close (a zero-match glob also exits 0). A leg that silently stops
# discovering is indistinguishable from a passing one, so assert the count itself.
PY_RAN=$(grep -Eo '^Ran ([0-9]+) tests?' /tmp/python-leg.out | grep -Eo '[0-9]+' | head -1)
PY_RAN=${PY_RAN:-0}
if [ "$PY_RAN" -lt 1 ]; then
  echo "GATE FAIL: python leg discovered ZERO tests (scripts/test_*.py moved or renamed?)"
  tail -20 /tmp/python-leg.out
  exit 1
fi
# unittest reports skips in the trailer, e.g. "OK (skipped=3)". Skips are forbidden (G4).
if grep -qE '\(.*(skipped|expected failures)=' /tmp/python-leg.out; then
  echo "GATE FAIL: python leg reported skipped/expected-failure tests (skips forbidden, G4)"
  grep -E '\(.*(skipped|expected failures)=' /tmp/python-leg.out
  exit 1
fi
echo "python leg: OK (Ran $PY_RAN tests)"

echo "GATE PASS"
exit 0
