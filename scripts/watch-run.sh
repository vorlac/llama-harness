#!/usr/bin/env bash
# scripts/watch-run.sh — watch a conductor run with one command and no arguments.
#
# Finds the most recently written run journal on this machine, prints everything
# that is knowable about that run right now, then tails it live until ctrl-C.
#
# READ-ONLY. Every command below opens files for reading. Nothing here takes the
# run lock, writes state, or starts a model, so it is safe to point at a run that
# is in flight — which is the only time it is interesting.
#
#   bash scripts/watch-run.sh                 # find the live run, dump it, follow it
#   bash scripts/watch-run.sh --once          # dump it and exit, no follow
#   bash scripts/watch-run.sh <run-dir>       # a specific .conductor/runs/<runId>
#   CONDUCTOR_RUN_DIR=... bash scripts/watch-run.sh
#
# The follow interval is 2000 ms; override with CONDUCTOR_WATCH_INTERVAL.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
OBSERVE="${REPO_ROOT}/conductor/tools/observe.ts"
LEDGER="${REPO_ROOT}/.data/router/metrics.jsonl"
INTERVAL="${CONDUCTOR_WATCH_INTERVAL:-2000}"

FOLLOW=1
RUN_DIR="${CONDUCTOR_RUN_DIR:-}"
for arg in "$@"; do
    case "${arg}" in
        --once) FOLLOW=0 ;;
        --help | -h)
            sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'
            exit 0
            ;;
        -*)
            echo "watch-run: unknown option ${arg}" >&2
            exit 2
            ;;
        *) RUN_DIR="${arg}" ;;
    esac
done

command -v node > /dev/null 2>&1 || {
    echo "watch-run: node is not on PATH; observe.ts needs it" >&2
    exit 2
}
[ -f "${OBSERVE}" ] || {
    echo "watch-run: cannot find ${OBSERVE}" >&2
    exit 2
}

# ---------------------------------------------------------------- find the run

# mtime in epoch seconds, BSD stat first (macOS), GNU second.
mtime_of() { stat -f %m "$1" 2> /dev/null || stat -c %Y "$1" 2> /dev/null || echo 0; }

if [ -z "${RUN_DIR}" ]; then
    # Every place a run journal plausibly lands: the repo itself, the bench work
    # root, and the per-invocation cache roots the bench driver mints.
    # A bench cell's state sits deep — .cache/<run>/w/<model>/<mech>/<arm>/<task>/<rep>/repo/.conductor
    # is twelve levels down. Rather than walking that blind, find the .conductor
    # directories themselves and prune at them: find never descends inside one,
    # so this stays fast (~25ms over ~/.cache) no matter how much else is there.
    SEARCH_ROOTS="
${REPO_ROOT}/.conductor
${TMPDIR:-/tmp}/llama-leash-conductor-work
${TMPDIR:-/tmp}
${HOME}/.cache
${HOME}/.claude/jobs
"
    CANDIDATES=""
    while IFS= read -r root; do
        [ -n "${root}" ] && [ -d "${root}" ] || continue
        while IFS= read -r cdir; do
            [ -n "${cdir}" ] || continue
            for journal in "${cdir}"/runs/*/journal.jsonl; do
                [ -f "${journal}" ] || continue
                # conductor/tests/live-inject.test.ts leaves its fixtures behind in
                # TMPDIR, and a fixture written seconds ago outranks a real cell that
                # started an hour back. Picking one and saying nothing is how a watcher
                # ends up reading a test while the run it cares about scrolls past.
                case "${journal}" in
                    */fixture/.conductor/*) continue ;;
                esac
                CANDIDATES="${CANDIDATES}$(mtime_of "${journal}") ${journal}
"
            done
        done <<< "$(find "${root}" -maxdepth 14 -type d -name .conductor -prune -print 2> /dev/null)"
    done <<< "${SEARCH_ROOTS}"

    CANDIDATES="$(printf '%s' "${CANDIDATES}" | grep -v '^$' | sort -rn -u)"
    NEWEST="$(printf '%s\n' "${CANDIDATES}" | head -1 | cut -d' ' -f2-)"
    OTHERS="$(printf '%s\n' "${CANDIDATES}" | tail -n +2 | grep -c . )"

    if [ -z "${NEWEST}" ]; then
        cat >&2 << 'EOF'
watch-run: no run journal found.

Looked under the repo's own .conductor, the bench work root, and ~/.cache.
If the run lives somewhere else, name it:

    bash scripts/watch-run.sh /path/to/.conductor/runs/r-YYYYMMDD-xxxx
EOF
        exit 1
    fi
    RUN_DIR="$(dirname "${NEWEST}")"
fi

[ -d "${RUN_DIR}" ] || {
    echo "watch-run: no such run directory: ${RUN_DIR}" >&2
    exit 2
}

RUN_ID="$(basename "${RUN_DIR}")"
CONDUCTOR_ROOT="$(cd "${RUN_DIR}/../.." && pwd -P)"
JOURNAL="${RUN_DIR}/journal.jsonl"
NOW="$(date +%s)"
AGE=$((NOW - $(mtime_of "${JOURNAL}")))

rule() { printf '\n%s\n' "────────────────────────────────────────────────────────────────────────"; }

# ---------------------------------------------------------------- what we found

echo "== WATCHING ${RUN_ID} =="
echo "  run dir   ${RUN_DIR}"
echo "  state     ${CONDUCTOR_ROOT}"
if [ -f "${LEDGER}" ]; then
    echo "  ledger    ${LEDGER}"
else
    echo "  ledger    ${LEDGER} (absent — no per-turn cost column)"
fi
if [ "${AGE}" -lt 120 ]; then
    echo "  journal   last written ${AGE}s ago — this run looks LIVE"
else
    echo "  journal   last written ${AGE}s ago ($((AGE / 60))m) — this run looks idle or finished"
fi

# Say what was passed over. The newest journal is a guess at which run you meant,
# and a guess a watcher cannot see is a guess a watcher cannot correct.
if [ "${OTHERS:-0}" -gt 0 ]; then
    echo "  others    ${OTHERS} older run(s) also found; newest wins. Pass a run dir to override:"
    printf '%s\n' "${CANDIDATES}" | tail -n +2 | head -3 | while IFS=' ' read -r at p; do
        echo "              $(( (NOW - at) / 60 ))m ago  $(dirname "${p}")"
    done
fi

# The state pointer is the run the plugin believes is current. When it disagrees
# with the newest journal, say so rather than quietly watching the wrong one.
CURRENT="${CONDUCTOR_ROOT}/state/current-run.json"
if [ -f "${CURRENT}" ]; then
    POINTS_AT="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("runId",""))' "${CURRENT}" 2> /dev/null)"
    if [ -n "${POINTS_AT}" ] && [ "${POINTS_AT}" != "${RUN_ID}" ]; then
        echo "  NOTE      state/current-run.json points at ${POINTS_AT}, not this run"
    fi
fi

# ---------------------------------------------------------------- the queue

if [ -f "${RUN_DIR}/queue.json" ]; then
    rule
    echo "== QUEUE =="
    /usr/bin/python3 - "${RUN_DIR}/queue.json" << 'PY' 2> /dev/null || echo "  (unreadable)"
import json, sys
q = json.load(open(sys.argv[1]))
items = q.get("items", [])
if not items:
    print("  (empty)")
for it in items:
    print(f"  {it.get('id')}  behavioral={it.get('behavioral')}  dependsOn={it.get('dependsOn') or []}")
    print(f"      title       {it.get('title','')}")
    print(f"      fileScope   {it.get('fileScope') or []}")
    print(f"      testScope   {it.get('testScope') or []}")
    acc = it.get("acceptance") or []
    print(f"      acceptance  {len(acc)} criteria")
PY
fi

# ---------------------------------------------------------------- the decisions

if [ -s "${RUN_DIR}/decisions.jsonl" ]; then
    rule
    echo "== DECISIONS =="
    /usr/bin/python3 - "${RUN_DIR}/decisions.jsonl" << 'PY' 2> /dev/null || echo "  (unreadable)"
import json, sys
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
    except ValueError:
        continue
    print(f"  {d.get('id')} [{d.get('kind')}] {d.get('question','')}")
    print(f"      chose: {d.get('choice','')}")
    why = (d.get("why") or "").replace("\n", " ")
    print(f"      why  : {why[:300]}")
PY
fi

# ---------------------------------------------------------------- observe.ts

# Three views, because observe.ts's modes are mutually exclusive and each one
# knows something the others do not. The report carries item states, the strain
# counters and any crossed threshold; the console carries the stall clock, the
# per-turn table with its token join, the refusals and the sub-session
# transcript. Neither is a superset of the other.

rule
echo "== REPORT — items, in-flight sessions, strain counters, thresholds =="
node "${OBSERVE}" "${RUN_DIR}" 2>&1

rule
echo "== CONSOLE — stall clock, turns, refusals, sub-session exchanges =="
node "${OBSERVE}" "${RUN_DIR}" --console --ledger "${LEDGER}" 2>&1

if [ "${FOLLOW}" -eq 0 ]; then
    rule
    echo "(--once given; not following)"
    exit 0
fi

rule
echo "== FOLLOWING — new records every ${INTERVAL}ms, ctrl-C to stop =="
exec node "${OBSERVE}" "${RUN_DIR}" --follow --interval "${INTERVAL}" --ledger "${LEDGER}"
