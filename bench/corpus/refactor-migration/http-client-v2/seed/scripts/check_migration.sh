#!/usr/bin/env bash
# Migration completeness gate.
#
# Two modes, chosen automatically:
#
#   baseline  Nothing outside the vendored libraries mentions modern_http, so
#             this is the untouched starting code. Reports what the migration
#             surface looks like and exits 0.
#
#   strict    Something imports modern_http, so a migration has been attempted.
#             Then ALL of the following must hold:
#               1. no source file outside legacy_http/ mentions legacy_http;
#               2. the suite passes with legacy_http made unimportable;
#               3. MIGRATION-NOTES.md exists and is not a stub.
#
# Shim smells (types that re-create the old API on top of the new one) are
# reported as warnings; a human decides. Re-creating legacy_http's interface to
# avoid changing call sites fails the task on review even when this script is
# quiet.
set -euo pipefail

PY="${PYTHON:-python3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Every Python file that is not a vendored library and not this tooling.
legacy_hits() {
  find . -name '*.py' \
    -not -path './legacy_http/*' -not -path './modern_http/*' \
    -not -path './wirenet/*' -not -path './scripts/*' \
    -not -path './.git/*' -not -path '*/__pycache__/*' \
    -exec grep -n "legacy_http" {} + 2>/dev/null || true
}
modern_hits() {
  find . -name '*.py' \
    -not -path './legacy_http/*' -not -path './modern_http/*' \
    -not -path './wirenet/*' -not -path './scripts/*' \
    -not -path './.git/*' -not -path '*/__pycache__/*' \
    -exec grep -ln "modern_http" {} + 2>/dev/null || true
}

LEGACY="$(legacy_hits)"
MODERN="$(modern_hits)"
LEGACY_COUNT=0
[ -n "$LEGACY" ] && LEGACY_COUNT="$(printf '%s\n' "$LEGACY" | wc -l | tr -d ' ')"

if [ -z "$MODERN" ]; then
  echo "check_migration: BASELINE (nothing imports modern_http yet)"
  echo "  legacy_http references outside the vendored library: $LEGACY_COUNT"
  echo "  run this again after migrating; it will switch to strict mode."
  exit 0
fi

echo "check_migration: STRICT (modern_http is in use)"
STATUS=0

if [ "$LEGACY_COUNT" != "0" ]; then
  echo "FAIL: $LEGACY_COUNT reference(s) to legacy_http remain:"
  printf '%s\n' "$LEGACY" | sed 's/^/    /'
  STATUS=1
else
  echo "  ok: no legacy_http references outside the vendored library"
fi

if [ ! -f MIGRATION-NOTES.md ]; then
  echo "FAIL: MIGRATION-NOTES.md is missing"
  STATUS=1
else
  SIZE="$(wc -c < MIGRATION-NOTES.md | tr -d ' ')"
  if [ "$SIZE" -lt 500 ]; then
    echo "FAIL: MIGRATION-NOTES.md is $SIZE bytes; that is not a decision record"
    STATUS=1
  else
    echo "  ok: MIGRATION-NOTES.md present ($SIZE bytes)"
  fi
fi

echo "  running the suite with legacy_http poisoned..."
POISON_LOG="$(mktemp "${TMPDIR:-/tmp}/poison_legacy.XXXXXX")"
if "$PY" scripts/poison_legacy.py > "$POISON_LOG" 2>&1; then
  echo "  ok: suite passes with legacy_http unimportable"
else
  echo "FAIL: the suite does not pass with legacy_http unimportable:"
  tail -30 "$POISON_LOG" | sed 's/^/    /'
  STATUS=1
fi
rm -f "$POISON_LOG"

SMELL="$(grep -rnE '\b(status_code|error_kind|get_stream)\b' feedservice 2>/dev/null || true)"
if [ -n "$SMELL" ]; then
  echo "WARNING: the old API's vocabulary survives in the new code; check that"
  echo "         this is not a compatibility shim:"
  printf '%s\n' "$SMELL" | sed 's/^/    /'
fi

exit "$STATUS"
