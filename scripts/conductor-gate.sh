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

# Placeholder/stub markers name unfinished PRODUCT, so — like the bare word "stub"
# below — they are scanned in production source only and allowed under conductor/tests/
# (C-013, C-026). In test files these same tokens appear legitimately as test DATA
# ("git grep TODO" fed to the shell-parser), as the SUBJECT of anti-stub enforcement
# (doctrine.test.ts's "placeholder marker"; the 15.1 doc-fidelity test), and in example
# strings (…conductor-quar-outside-XXXX/…). An UNFINISHED TEST — the real test-file risk
# — is caught independently and does NOT rely on this scan: test-conductor.sh hard-fails
# any skipped/todo test or SKIP/TODO TAP directive at any depth, and PAT_SKIP below still
# applies to tests. XXX is word-bounded so a real `XXX` marker still trips but a longer
# XXXX random-suffix token does not (C-026).
PAT_STUB='TODO|FIXME|\bXXX\b|not implemented|placeholder'
# The bare word "stub" is forbidden in production source but is the plan's own
# vocabulary for test doubles ("a fake OpenAI-compatible stub server", §8 Task 0.2;
# httplib stubs, Phase 11) — so it is allowed under conductor/tests/ only (C-013).
PAT_STUBWORD='\bstub'
PAT_SKIP='test\.skip|it\.skip|describe\.skip|t\.skip|\.todo\('
PAT_TRIV='assert\.ok\(true\)|assert\.equal\(1, ?1\)|expect\(true\)'
PAT_CATCH='catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}'

BAD=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in *.md) continue ;; esac   # docs are governed by anchor tests, not M5
  # Marker/stub-word scans: production source only (test files carry these tokens as
  # data and as the subject of anti-stub enforcement — C-026; unfinished tests are
  # caught by test-conductor.sh's skip/todo/directive gate, not here).
  case "$f" in
    *conductor/tests/*) ;;
    *)
      if grep -nE "$PAT_STUB" "$f"; then echo "M5 FAIL: stub marker in $f"; BAD=1; fi
      if grep -inE "$PAT_STUBWORD" "$f"; then echo "M5 FAIL: 'stub' in production source $f"; BAD=1; fi
      ;;
  esac
  # Semantic test-defect scans: universal (apply to tests too).
  if grep -nE "$PAT_SKIP" "$f"; then echo "M5 FAIL: skip/todo test in $f"; BAD=1; fi
  if grep -nE "$PAT_TRIV" "$f"; then echo "M5 FAIL: trivially-true assertion in $f"; BAD=1; fi
  if grep -nzE "$PAT_CATCH" "$f" >/dev/null 2>&1; then echo "M5 FAIL: empty catch block in $f"; BAD=1; fi
done

if [ "$BAD" -eq 0 ]; then echo "M5 PASS (${#FILES[@]} file(s) scanned)"; fi
exit "$BAD"
