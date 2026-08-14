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
    < <(git ls-files 'conductor/*.ts' 'conductor/**/*.ts' 'router/*' 'router/**' 'tools/*' 'tools/**' 2>/dev/null)
  # A glob that stops matching is the failure mode this scan cannot otherwise see: it
  # reports PASS over an empty set and reads exactly like a clean tree. The C++ half
  # went unscanned for two commits that way (the tree moved src/router -> router and
  # this list did not follow), so each half now carries a floor. The floors are
  # deliberately loose — they catch a path that has MOVED, not a file that was deleted.
  TS_N=$(git ls-files 'conductor/*.ts' 'conductor/**/*.ts' 2>/dev/null | wc -l | tr -d ' ')
  CPP_N=$(git ls-files 'router/*' 'router/**' 'tools/*' 'tools/**' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$TS_N" -lt 40 ]; then
    echo "M5 FAIL: the TypeScript glob matched $TS_N tracked files (floor 40) — the tree moved and this scan did not follow"
    exit 1
  fi
  if [ "$CPP_N" -lt 10 ]; then
    echo "M5 FAIL: the C++ glob matched $CPP_N tracked files (floor 10) — the tree moved and this scan did not follow"
    exit 1
  fi
fi
if [ ${#FILES[@]} -eq 0 ]; then echo "M5 FAIL: no files to scan (an explicit file list matched nothing)"; exit 1; fi

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
#
# These match marker SHAPES, not the words themselves. The bare-word version could not
# be run over the whole tree: conductor/core/planning.ts IS the placeholder detector and
# conductor/adapter/tools.ts writes the prompts that forbid stubbing, so a word-level
# scan flags the enforcement machinery as the violation and the no-argument mode becomes
# unusable — which is how the C++ half went unscanned without anyone noticing.
# The shapes below deliberately mirror the ones the PRODUCT pins for the same job at
# conductor/core/planning.ts:562-577. If you change one, change both: this is the
# one-rule-in-two-places pattern that has already drifted six times in this build.
PAT_STUB='(\b(TODO|FIXME|XXX)[[:space:]]*:)|(^|[^[:alnum:]_])(//|#|\*)[[:space:]]*(TODO|FIXME|XXX)\b|not implemented|<placeholder>|\[placeholder\]|placeholder[[:space:]]+(for|here|text|value)\b|as a placeholder'
# The bare word "stub" is forbidden in production source but is the plan's own
# vocabulary for test doubles ("a fake OpenAI-compatible stub server", §8 Task 0.2;
# httplib stubs, Phase 11) — so it is allowed under conductor/tests/ and router/tests/
# only (C-013), and narrowed to shapes that assert a stub EXISTS in the product rather
# than prose that merely mentions one.
PAT_STUBWORD='\bis a stub\b|\bstub implementation\b|\bstubbed out\b|(^|[^[:alnum:]_])(//|#|\*)[[:space:]]*stub\b'
PAT_SKIP='test\.skip|it\.skip|describe\.skip|t\.skip|\.todo\('
PAT_TRIV='assert\.ok\(true\)|assert\.equal\(1, ?1\)|expect\(true\)'
PAT_CATCH='catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}'

# Line-level exemptions: `<path>|<scan>|<substring that must appear on the matched line>`.
# Three modules in this repo are ABOUT unfinished-work markers, so a textual scan reads
# their subject matter as their content. The exemption is per LINE, not per file — any
# OTHER marker in the same file still fails — and every entry is verified to still match
# something below, so an exemption cannot quietly outlive the line it was written for.
EXEMPT=(
  'conductor/adapter/tools.ts|STUB|throwing "not implemented", skipping the stage'
  'conductor/core/planning.ts|STUB|A comment-marker shape'
  'conductor/core/planning.ts|STUB|Placeholder USAGE, not the word'
  'conductor/core/planning.ts|STUB|"placeholder for the real X", "as a placeholder"'
  'conductor/core/planning.ts|STUB|pattern: /<placeholder>|\[placeholder\]'
  'conductor/tests/tools-9.4b.test.ts|CATCH|catch (_) {} process.exit(3);'
)
# Emit the scan's matches for one file, dropping any line an exemption covers.
# $1=file $2=scan-name $3=grep flags $4=pattern
# Runs in a command substitution, i.e. a SUBSHELL — it can print but it cannot record
# anything for the parent. Exemption liveness is therefore checked separately, below.
scan() {
  local f="$1" scan_name="$2" flags="$3" pat="$4" out line i ex_f ex_s ex_sub kept=""
  out="$(grep -n$flags -E "$pat" "$f" 2>/dev/null)" || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local covered=0
    for i in "${!EXEMPT[@]}"; do
      IFS='|' read -r ex_f ex_s ex_sub <<< "${EXEMPT[$i]}"
      [ "$ex_f" = "$f" ] || continue
      [ "$ex_s" = "$scan_name" ] || continue
      case "$line" in *"$ex_sub"*) covered=1 ;; esac
      [ "$covered" -eq 1 ] && break
    done
    [ "$covered" -eq 0 ] && kept="$kept$line"$'\n'
  done <<< "$out"
  [ -n "$kept" ] && printf '%s' "$kept"
  return 0
}

# Pattern for a scan name, so exemption liveness can re-run the same match the scan did.
pat_for() {
  case "$1" in
    STUB) printf '%s' "$PAT_STUB" ;;
    STUBWORD) printf '%s' "$PAT_STUBWORD" ;;
    SKIP) printf '%s' "$PAT_SKIP" ;;
    TRIV) printf '%s' "$PAT_TRIV" ;;
    CATCH) printf '%s' "$PAT_CATCH" ;;
  esac
}

BAD=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in *.md) continue ;; esac   # docs are governed by anchor tests, not M5
  # Marker/stub-word scans: production source only (test files carry these tokens as
  # data and as the subject of anti-stub enforcement — C-026; unfinished tests are
  # caught by test-conductor.sh's skip/todo/directive gate, not here).
  case "$f" in
    *conductor/tests/*|router/tests/*) ;;
    *)
      HITS="$(scan "$f" STUB '' "$PAT_STUB")"
      [ -n "$HITS" ] && { printf "%s\n" "$HITS"; echo "M5 FAIL: stub marker in $f"; BAD=1; }
      HITS="$(scan "$f" STUBWORD 'i' "$PAT_STUBWORD")"
      [ -n "$HITS" ] && { printf "%s\n" "$HITS"; echo "M5 FAIL: 'stub' in production source $f"; BAD=1; }
      ;;
  esac
  # Semantic test-defect scans: universal (apply to tests too).
  HITS="$(scan "$f" SKIP '' "$PAT_SKIP")"
  [ -n "$HITS" ] && { printf "%s\n" "$HITS"; echo "M5 FAIL: skip/todo test in $f"; BAD=1; }
  HITS="$(scan "$f" TRIV '' "$PAT_TRIV")"
  [ -n "$HITS" ] && { printf "%s\n" "$HITS"; echo "M5 FAIL: trivially-true assertion in $f"; BAD=1; }
  HITS="$(scan "$f" CATCH '' "$PAT_CATCH")"
  [ -n "$HITS" ] && { printf "%s\n" "$HITS"; echo "M5 FAIL: empty catch block in $f"; BAD=1; }
done

# A stale exemption is a failure, not a shrug: it means the line it was written for is
# gone, and an unexamined exemption is exactly how a scan quietly stops enforcing. An
# exemption is live only if its file still holds a line that BOTH contains the anchor
# substring AND trips the scan it exempts — an anchor that no longer trips anything is
# suppressing nothing and must go.
# Only meaningful for a whole-tree scan — an explicit file list legitimately misses most.
if [ "$#" -eq 0 ]; then
  for i in "${!EXEMPT[@]}"; do
    IFS='|' read -r ex_f ex_s ex_sub <<< "${EXEMPT[$i]}"
    live=0
    if [ -f "$ex_f" ]; then
      while IFS= read -r line; do
        case "$line" in *"$ex_sub"*) live=1; break ;; esac
      done <<< "$(grep -nE "$(pat_for "$ex_s")" "$ex_f" 2>/dev/null)"
    fi
    if [ "$live" -eq 0 ]; then
      echo "M5 FAIL: exemption ${i} suppresses nothing and is stale — remove it: ${EXEMPT[$i]}"
      BAD=1
    fi
  done
fi

if [ "$BAD" -eq 0 ]; then echo "M5 PASS (${#FILES[@]} file(s) scanned, ${#EXEMPT[@]} line exemption(s) all live)"; fi
exit "$BAD"
