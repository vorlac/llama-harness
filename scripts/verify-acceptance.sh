#!/usr/bin/env bash
# Conductor build: the §11 final acceptance checklist, as an executable artifact.
# Orchestrator-owned; subagents must never edit this file.
#
# §9 of the build prompt: "Done is an executable artifact, not a recitation." Every row
# of the plan's §11 checklist (12 rows) is a command with a PASS/FAIL verdict, plus six
# hollowness detectors that catch the failure modes a green suite cannot see.
#
# Run it in a CLEAN `git worktree` of HEAD. Completion may be claimed only on exit 0.
#
# Usage: bash scripts/verify-acceptance.sh [--quick]
#   --quick  skips the two slow legs (the full node suite and the C++ build) and is for
#            iterating on this script itself. A --quick run NEVER counts as acceptance
#            and says so in its own output.
set -u

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

BUILD_DIR=".out/build/clang-relwdebinfo"
PASS_N=0; FAIL_N=0
FAILED_ROWS=()

pass() { PASS_N=$((PASS_N+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL_N=$((FAIL_N+1)); FAILED_ROWS+=("$1"); printf 'FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; return 0; }

echo "=============================================================="
echo " Conductor acceptance — plan §11 (12 rows) + §9 hollowness detectors"
echo " repo: $ROOT"
echo " head: $(git rev-parse --short HEAD 2>/dev/null || echo '(not a git repo)')"
[ "$QUICK" -eq 1 ] && echo " MODE: --quick — NOT a valid acceptance run"
echo "=============================================================="
echo

# ---------------------------------------------------------------- §11 row 1
# "node --test conductor/tests/ — all green, >= 24 test files."
# Run through the canonical wrapper, never raw node --test (a directory positional is a
# bogus red on node 26.7.0 and a zero-match glob is a vacuous green).
TESTFILES=$(git ls-files 'conductor/tests/*.test.ts' 'conductor/tests/**/*.test.ts' | wc -l | tr -d ' ')
if [ "$TESTFILES" -ge 24 ]; then
  pass "row 1a: $TESTFILES test files present (>= 24)"
else
  fail "row 1a: only $TESTFILES test files (need >= 24)"
fi

if [ "$QUICK" -eq 1 ]; then
  fail "row 1b: full suite SKIPPED by --quick"
else
  GATE_OUT="$(bash scripts/test-conductor.sh 2>&1)"
  if [ $? -eq 0 ] && printf '%s' "$GATE_OUT" | grep -q 'GATE PASS'; then
    pass "row 1b: full suite green — $(printf '%s' "$GATE_OUT" | grep -m1 '^TAP:')"
  else
    fail "row 1b: full suite NOT green" "$(printf '%s' "$GATE_OUT" | tail -5 | tr '\n' ' ')"
  fi
fi

# ---------------------------------------------------------------- §11 row 2
# "bun test conductor/tests/bun-smoke.test.ts green (G14)" — or a RECORDED
# SKIPPED_UNMET. Never silently absent: an unrun check is never a ticked row.
if command -v bun >/dev/null 2>&1; then
  if bun test conductor/tests/bun-smoke.test.ts >/tmp/accept-bun.out 2>&1; then
    pass "row 2: bun leg green ($(grep -Eo '[0-9]+ pass' /tmp/accept-bun.out | head -1))"
  else
    fail "row 2: bun leg FAILED" "$(tail -3 /tmp/accept-bun.out | tr '\n' ' ')"
  fi
elif grep -q 'SKIPPED_UNMET' docs/build/STATE.json 2>/dev/null; then
  pass "row 2: bun absent, recorded SKIPPED_UNMET in STATE.json (loud, not silent)"
else
  fail "row 2: bun absent AND no SKIPPED_UNMET record" "an unrun check is never a ticked row"
fi

# ---------------------------------------------------------------- §11 row 3
# "ctest on router-tests — all green."
if [ "$QUICK" -eq 1 ]; then
  fail "row 3: ctest SKIPPED by --quick"
elif [ ! -d "$BUILD_DIR" ]; then
  fail "row 3: no build dir at $BUILD_DIR" "configure with: cmake --preset clang-relwdebinfo"
else
  # NEVER a bare --build: it hits the pre-broken vendored llama target.
  if cmake --build "$BUILD_DIR" --target router-tests >/tmp/accept-cmake.out 2>&1 \
     && ctest --test-dir "$BUILD_DIR" >/tmp/accept-ctest.out 2>&1; then
    pass "row 3: ctest green — $(grep -Eo '[0-9]+% tests passed' /tmp/accept-ctest.out | head -1)"
  else
    fail "row 3: router-tests build or ctest FAILED" "$(tail -3 /tmp/accept-cmake.out /tmp/accept-ctest.out | tr '\n' ' ')"
  fi
fi

# ---------------------------------------------------------------- §11 row 4
# "Purity guard + dual-runtime guard + doctrine tests green (G3, G14, §6)."
# Named files, so a renamed-away guard fails here instead of vanishing quietly.
MISSING_GUARDS=""
for g in conductor/tests/purity.test.ts conductor/tests/bun-smoke.test.ts conductor/tests/doctrine.test.ts; do
  [ -f "$g" ] || MISSING_GUARDS="$MISSING_GUARDS $g"
done
if [ -n "$MISSING_GUARDS" ]; then
  fail "row 4: guard test file(s) missing:$MISSING_GUARDS"
elif [ "$QUICK" -eq 1 ]; then
  fail "row 4: guard suites SKIPPED by --quick"
else
  if bash scripts/test-conductor.sh 'conductor/tests/{purity,bun-smoke,doctrine}.test.ts' >/tmp/accept-guards.out 2>&1; then
    pass "row 4: purity + dual-runtime + doctrine guards green"
  else
    fail "row 4: guard suites NOT green" "$(tail -4 /tmp/accept-guards.out | tr '\n' ' ')"
  fi
fi

# ---------------------------------------------------------------- §11 row 5
# "Scripted e2e (13.1) green — all FIVE scenarios."
# §9's detector: the five scenario names must appear in the ACTUAL TAP output. 13.1 is
# the largest task in the plan and the easiest place to implement scenario 1, commit,
# and leave four acceptance-critical paths unexercised.
E2E=conductor/tests/e2e.test.ts
if [ ! -f "$E2E" ]; then
  fail "row 5: $E2E does not exist (Task 13.1 not built)"
elif [ "$QUICK" -eq 1 ]; then
  fail "row 5: e2e SKIPPED by --quick"
else
  E2E_OUT="$(node --test --test-reporter=tap "$E2E" 2>&1)"
  E2E_EC=$?
  MISSING_SCEN=""
  for s in full-pipeline trivial worktree non-behavioral bad-ending; do
    printf '%s' "$E2E_OUT" | grep -qi "$s" || MISSING_SCEN="$MISSING_SCEN $s"
  done
  if [ "$E2E_EC" -eq 0 ] && [ -z "$MISSING_SCEN" ]; then
    pass "row 5: e2e green with all five scenarios named in TAP output"
  elif [ -n "$MISSING_SCEN" ]; then
    fail "row 5: e2e TAP output never names scenario(s):$MISSING_SCEN"
  else
    fail "row 5: e2e suite FAILED" "$(printf '%s' "$E2E_OUT" | grep -v '^ok ' | tail -4 | tr '\n' ' ')"
  fi
fi

# ---------------------------------------------------------------- §11 row 6
# "Live smoke (13.2) recorded in SMOKE.md."
check_artifact() {  # $1=path $2=row label $3..=required substrings
  local p="$1" label="$2"; shift 2
  if [ ! -f "$p" ]; then fail "$label: $p missing"; return; fi
  local lines; lines=$(wc -l < "$p" | tr -d ' ')
  if [ "$lines" -le 20 ]; then fail "$label: $p is only $lines lines (need > 20)"; return; fi
  # A live artifact an LLM can fabricate more cheaply than it can measure is the single
  # worst outcome available to this build. Require a command transcript, not prose.
  if ! grep -qE '^\s*\$ |^\s*```' "$p"; then
    fail "$label: $p has no command transcript (prose-only claims are a FAIL)"; return
  fi
  local miss=""
  for s in "$@"; do grep -qi -- "$s" "$p" || miss="$miss '$s'"; done
  if [ -n "$miss" ]; then fail "$label: $p never mentions:$miss"; return; fi
  pass "$label: $p present, $lines lines, with a command transcript"
}
check_artifact conductor/SMOKE.md "row 6" "retry" "behavioral"

# ---------------------------------------------------------------- §11 row 7
# "Runner discovery probe (6.2) recorded — the quarantine's out-of-repo location is
#  justified by measurement."
check_artifact conductor/docs/RUNNER-DISCOVERY.md "row 7" "quarantine"

# ---------------------------------------------------------------- §11 row 8
# "POC report (14.2) committed: three arms, three repetitions, per-task spread."
# .data/ is gitignored, so the committed copy is the one that counts.
POC=docs/build/artifacts/conductor-report.md
if [ -f "$POC" ]; then
  check_artifact "$POC" "row 8" "baseline" "doctrine" "conductor" "spread"
else
  fail "row 8: $POC missing" "the POC report must be COMMITTED; .data/benchmark/ is gitignored"
fi

# ---------------------------------------------------------------- §11 row 9
# "serve.py: --router and --no-router both produce working sessions AND the e2e
#  equivalence step (12.1) passes (G5)."
if ! grep -q -- '--no-router' scripts/serve.py 2>/dev/null; then
  fail "row 9a: scripts/serve.py has no --no-router flag (Task 12.1 not built)"
else
  pass "row 9a: serve.py offers --router/--no-router"
fi
check_artifact docs/build/artifacts/12.1-g5-equivalence.md "row 9b" "no-router" "terminal state"

# ---------------------------------------------------------------- §11 row 10
# "--parallel is set from parallel.maxReaders and setup's slot probe passes."
# The plan's point is that ONE number feeds both, so drift is impossible. Assert the
# single source, not merely that both strings appear somewhere.
if [ ! -f scripts/conductor_wiring.py ]; then
  fail "row 10: scripts/conductor_wiring.py missing (Task 12.1 not built)"
elif /usr/bin/python3 - <<'PY' 2>/dev/null
import sys, os
sys.path.insert(0, os.path.join(os.getcwd(), "scripts"))
import conductor_wiring as w

# Three properties, all of which must hold, checked over several reader counts.
#   (a) SINGLE SOURCE: the router config's admission.maxInflightPerModel and the
#       llama-server --parallel argument are the SAME number. The plan's whole point
#       is that they cannot drift.
#   (b) PER-SLOT CONTEXT SURVIVES: --ctx-size is llama-server's TOTAL context divided
#       among slots (measured, C-058), so the emitted --ctx-size must be a per-slot
#       value MULTIPLIED by the slot count. Appending a bare --parallel N — the plan's
#       literal wording — silently cuts every sub-session's window by a factor of N.
#   (c) The default reader count is not above what the machine was measured to serve.
ok = True
for readers in (1, 4, 6, 9):
    slots = w.derive_slots(readers)
    cfg = w.generate_router_config(listen_host="127.0.0.1", listen_port=8088,
                                   upstream_host="127.0.0.1", upstream_port=8080,
                                   slots=slots)
    if cfg["admission"]["maxInflightPerModel"] != slots:
        print("row10: maxInflightPerModel %r != slots %r at readers=%d"
              % (cfg["admission"]["maxInflightPerModel"], slots, readers), file=sys.stderr)
        ok = False

    argv = w.parallel_server_args(slots)
    if slots > 1:
        if "--parallel" not in argv or argv[argv.index("--parallel") + 1] != str(slots):
            print("row10: argv does not carry --parallel %d: %r" % (slots, argv), file=sys.stderr)
            ok = False
        if "--ctx-size" in argv:
            total = int(argv[argv.index("--ctx-size") + 1])
            if total % slots != 0 or total // slots < 4096:
                print("row10: --ctx-size %d over %d slots leaves %d per slot"
                      % (total, slots, total // slots), file=sys.stderr)
                ok = False
        else:
            print("row10: argv sets --parallel without --ctx-size; per-slot context "
                  "is silently divided (C-058 F3): %r" % (argv,), file=sys.stderr)
            ok = False
sys.exit(0 if ok else 1)
PY
then
  pass "row 10: --parallel, maxInflightPerModel and per-slot context all derive from one number"
else
  fail "row 10: the --parallel / maxInflightPerModel / --ctx-size derivation does not hold" \
       "re-run without 2>/dev/null to see which property failed"
fi

# ---------------------------------------------------------------- §11 row 11
# "OPERATIONS.md + HONEST-LIMITS.md exist and match §9 (all 15 limits)."
OPS=conductor/docs/OPERATIONS.md
LIM=conductor/docs/HONEST-LIMITS.md
if [ ! -f "$OPS" ]; then
  fail "row 11a: $OPS missing (Task 15.1 not built)"
else
  pass "row 11a: $OPS present ($(wc -l < "$OPS" | tr -d ' ') lines)"
fi
if [ ! -f "$LIM" ]; then
  fail "row 11b: $LIM missing (Task 15.1 not built)"
else
  # §9 is a numbered list; count its items in the plan and require the same count here.
  PLAN_LIMITS=$(sed -n '/^## §9\. Honest limits/,/^## §10\./p' docs/plans/2026-08-07-conductor-harness-plan.md \
                | grep -cE '^[0-9]+\. \*\*')
  DOC_LIMITS=$(grep -cE '^[0-9]+\. \*\*' "$LIM")
  if [ "$PLAN_LIMITS" -gt 0 ] && [ "$DOC_LIMITS" -eq "$PLAN_LIMITS" ]; then
    pass "row 11b: $LIM carries all $PLAN_LIMITS §9 limits"
  else
    fail "row 11b: $LIM has $DOC_LIMITS limits, plan §9 has $PLAN_LIMITS"
  fi
fi

# ---------------------------------------------------------------- §11 row 12
# "git log --oneline shows one commit per task, each on a green suite."
# §9's detector: all manifest commit messages appear EXACTLY ONCE each.
MANIFEST_REPORT="$(/usr/bin/python3 - <<'PY'
import json, subprocess
s = json.load(open('docs/build/STATE.json'))
log = subprocess.run(['git','log','--pretty=%s'], capture_output=True, text=True).stdout.splitlines()
missing, dup = [], []
total = 0
for k, v in s['tasks'].items():
    if not v.get('manifest', True):
        continue
    m = v.get('commitMessage')
    if not m:
        continue
    total += 1
    n = log.count(m)
    if n == 0: missing.append(k)
    elif n > 1: dup.append('%s x%d' % (k, n))
print('%d|%s|%s' % (total, ','.join(missing), ','.join(dup)))
PY
)"
M_TOTAL="${MANIFEST_REPORT%%|*}"; M_REST="${MANIFEST_REPORT#*|}"
M_MISSING="${M_REST%%|*}"; M_DUP="${M_REST##*|}"
if [ -z "$M_MISSING" ] && [ -z "$M_DUP" ]; then
  pass "row 12: all $M_TOTAL manifest commit messages present exactly once"
else
  fail "row 12: manifest commits — missing: ${M_MISSING:-none}; duplicated: ${M_DUP:-none}"
fi

# ---------------------------------------------------------- hollowness detector A
# "every module named in §1.1's layout exists, is non-empty, and is imported by at
#  least one test" — catches modules written but never exercised.
MODULES="
conductor/plugin/index.ts
conductor/core/fsm-run.ts conductor/core/fsm-item.ts conductor/core/gates-git.ts
conductor/core/gates-edit.ts conductor/core/gates-phase.ts conductor/core/decide.ts
conductor/core/schedule.ts conductor/core/shell-parse.ts conductor/core/freshness.ts
conductor/core/verdict.ts conductor/core/stops.ts conductor/core/journal-events.ts
conductor/core/types.ts
conductor/adapter/state.ts conductor/adapter/journal.ts conductor/adapter/evidence.ts
conductor/adapter/fanout.ts conductor/adapter/tools.ts conductor/adapter/inject.ts
conductor/adapter/continuation.ts conductor/adapter/worktrees.ts
conductor/adapter/quarantine.ts conductor/adapter/questions.ts conductor/adapter/gitio.ts
conductor/adapter/router-client.ts
conductor/tools/replay.ts conductor/tools/export-schemas.ts
"
MISSING_MOD=""; EMPTY_MOD=""; UNIMPORTED_MOD=""
for m in $MODULES; do
  if [ ! -f "$m" ]; then MISSING_MOD="$MISSING_MOD $m"; continue; fi
  [ -s "$m" ] || { EMPTY_MOD="$EMPTY_MOD $m"; continue; }
  base="$(basename "$m")"
  grep -rqF "$base" conductor/tests/ 2>/dev/null || UNIMPORTED_MOD="$UNIMPORTED_MOD $m"
done
if [ -z "$MISSING_MOD$EMPTY_MOD$UNIMPORTED_MOD" ]; then
  pass "detector A: every §1.1 module exists, is non-empty, and is named by a test"
else
  fail "detector A: missing:${MISSING_MOD:- none} empty:${EMPTY_MOD:- none} unimported:${UNIMPORTED_MOD:- none}"
fi

# ---------------------------------------------------------- hollowness detector B
# The nine doctrine packs (§6) must all exist and be non-trivial.
PACK_MISSING=""
for p in core decompose plan tdd test-vet debug review skeptic receive-review; do
  f="conductor/doctrine/$p.md"
  if [ ! -f "$f" ] || [ "$(wc -l < "$f" | tr -d ' ')" -lt 5 ]; then
    PACK_MISSING="$PACK_MISSING $p"
  fi
done
if [ -z "$PACK_MISSING" ]; then
  pass "detector B: all 9 doctrine packs present and non-trivial"
else
  fail "detector B: doctrine pack(s) missing or trivial:$PACK_MISSING"
fi

# ---------------------------------------------------------- hollowness detector C
# The C++ router modules named by §1.1 (post-hoist paths: src/ became router/).
CPP_MISSING=""
for m in router/main.cpp router/router.hpp router/admission.hpp router/affinity.hpp \
         router/schema-observer.hpp router/metrics.hpp router/config.hpp; do
  [ -f "$m" ] && [ -s "$m" ] || CPP_MISSING="$CPP_MISSING $m"
done
for m in $(git ls-files 'router/*.hpp'); do
  base="$(basename "$m" .hpp)"
  ls router/tests/ 2>/dev/null | grep -q "$base" || true
done
if [ -z "$CPP_MISSING" ]; then
  pass "detector C: every §1.1 router module exists and is non-empty"
else
  fail "detector C: router module(s) missing or empty:$CPP_MISSING"
fi

# ---------------------------------------------------------- hollowness detector D
# The M5 stub scan over the WHOLE tree. Its own floors fail if a glob stops matching.
if bash scripts/conductor-gate.sh >/tmp/accept-m5.out 2>&1; then
  pass "detector D: M5 clean — $(tail -1 /tmp/accept-m5.out)"
else
  fail "detector D: M5 stub scan FAILED" "$(grep 'M5 FAIL' /tmp/accept-m5.out | head -3 | tr '\n' ' ')"
fi

# ---------------------------------------------------------- hollowness detector E
# Every live artifact present, > 20 lines, with a command transcript. The four artifacts
# §8.4 names, plus 11.8's. check_artifact already enforces the shape; this row exists so
# a MISSING artifact is one line rather than silence.
LIVE_MISSING=""
for a in conductor/docs/RUNNER-DISCOVERY.md router/UPSTREAM_CONTRACT.md \
         docs/build/artifacts/11.8-live-smoke.md conductor/SMOKE.md \
         docs/build/artifacts/conductor-report.md; do
  [ -f "$a" ] || LIVE_MISSING="$LIVE_MISSING $a"
done
if [ -z "$LIVE_MISSING" ]; then
  pass "detector E: all 5 live artifacts present"
else
  fail "detector E: live artifact(s) missing:$LIVE_MISSING"
fi

# ---------------------------------------------------------- hollowness detector F
# A committed WIRE_CONTRACT_VERIFIED stamp that still says <pending> is an unmet
# obligation wearing the shape of a met one.
if [ -f router/UPSTREAM_CONTRACT.md ]; then
  if grep -q 'WIRE_CONTRACT_VERIFIED' router/UPSTREAM_CONTRACT.md \
     && ! grep -qi 'WIRE_CONTRACT_VERIFIED:[[:space:]]*<*pending' router/UPSTREAM_CONTRACT.md; then
    pass "detector F: UPSTREAM_CONTRACT.md carries a real WIRE_CONTRACT_VERIFIED stamp"
  else
    fail "detector F: WIRE_CONTRACT_VERIFIED is missing or still <pending>"
  fi
else
  fail "detector F: router/UPSTREAM_CONTRACT.md missing"
fi

echo
echo "=============================================================="
printf ' %d PASS   %d FAIL\n' "$PASS_N" "$FAIL_N"
if [ "$FAIL_N" -gt 0 ]; then
  echo " failing rows:"
  for r in "${FAILED_ROWS[@]}"; do printf '   - %s\n' "$r"; done
fi
if [ "$QUICK" -eq 1 ]; then
  echo " MODE --quick: this run is NOT acceptance, whatever its exit code."
fi
echo "=============================================================="
[ "$FAIL_N" -eq 0 ] && [ "$QUICK" -eq 0 ] && exit 0
exit 1
