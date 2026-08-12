#!/usr/bin/env bash
# Conductor build: mechanical stub scan (task gate M5). Orchestrator-owned.
# Scans committed conductor/TS and router/C++ sources for the G4-forbidden shapes the
# plan names but supplies no mechanism for. Covers: stub markers, skip/todo tests,
# trivially-true assertions, empty catch blocks. (New-source-not-imported-by-any-test
# is checked separately in verify-acceptance.sh; empty function bodies are checked by
# eyeball during the mandatory diff read - too idiom-dependent for a regex.)
# Usage: bash scripts/conductor-gate.sh [file ...]   (no args = all tracked sources)
set -u

FILES=()
if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  while IFS= read -r f; do FILES+=("$f"); done \
    < <(git ls-files 'conductor/*.ts' 'conductor/**/*.ts' 'src/router/*' 'src/router/**' 2>/dev/null)
fi
if [ ${#FILES[@]} -eq 0 ]; then echo "M5: no files to scan"; exit 0; fi

PAT_STUB='TODO|FIXME|XXX|not implemented|placeholder|stub'
PAT_SKIP='test\.skip|it\.skip|describe\.skip|t\.skip|\.todo\('
PAT_TRIV='assert\.ok\(true\)|assert\.equal\(1, ?1\)|expect\(true\)'
PAT_CATCH='catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}'

BAD=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  if grep -nE "$PAT_STUB" "$f"; then echo "M5 FAIL: stub marker in $f"; BAD=1; fi
  if grep -nE "$PAT_SKIP" "$f"; then echo "M5 FAIL: skip/todo test in $f"; BAD=1; fi
  if grep -nE "$PAT_TRIV" "$f"; then echo "M5 FAIL: trivially-true assertion in $f"; BAD=1; fi
  if grep -nzE "$PAT_CATCH" "$f" >/dev/null 2>&1; then echo "M5 FAIL: empty catch block in $f"; BAD=1; fi
done

if [ "$BAD" -eq 0 ]; then echo "M5 PASS (${#FILES[@]} file(s) scanned)"; fi
exit "$BAD"
