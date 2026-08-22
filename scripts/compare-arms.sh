#!/usr/bin/env bash
# scripts/compare-arms.sh — the cross-arm scoreboard, one line per scored cell.
#
# watch-run.sh shows one run's insides and only the conductor arm has any, because
# the other two load no plugin and write no journal. This is the other half: what
# every arm produced, side by side, read from the result JSON each cell writes as
# it finishes. Re-run it whenever you want; it is a snapshot, not a tail.
#
#   bash scripts/compare-arms.sh                 # the default results directory
#   bash scripts/compare-arms.sh <results-dir>   # a run that used --results-dir
#
# READ-ONLY. It opens finished result files and nothing else.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
RESULTS="${1:-${REPO_ROOT}/.data/benchmark/conductor/runs}"

[ -d "${RESULTS}" ] || {
    echo "compare-arms: no results directory at ${RESULTS}"
    echo "  (a run writes each cell's JSON there as that cell finishes)"
    exit 1
}

/usr/bin/python3 - "${RESULTS}" << 'PY'
import glob, json, os, sys

files = sorted(glob.glob(os.path.join(sys.argv[1], "*.json")))
if not files:
    print(f"no scored cells yet in {sys.argv[1]}")
    raise SystemExit(0)

rows = []
for f in files:
    try:
        rows.append(json.load(open(f)))
    except (ValueError, OSError) as exc:
        print(f"  (unreadable: {os.path.basename(f)} — {exc})")

# Group by task so a multi-task run stays legible, and keep the arms in the
# order the driver runs them rather than alphabetically.
ARM_ORDER = {"baseline": 0, "doctrine": 1, "conductor": 2}
by_task = {}
for d in rows:
    by_task.setdefault(d.get("taskId", "?"), []).append(d)

for task in sorted(by_task):
    cells = sorted(by_task[task], key=lambda d: (ARM_ORDER.get(d.get("arm"), 9), d.get("rep", 0)))
    print(f"\n== {task} ==")
    print(f"  {'arm':<10} {'rep':>3} {'outcome':<9} {'wall':>7} {'prompt':>8} {'compl':>7} "
          f"{'waves':>5} {'subs':>5} {'retries':>7} {'rtr err':>7}")
    base = next((c for c in cells if c.get("arm") == "baseline"), None)
    for d in cells:
        t = d.get("tokens") or {}
        wall = (d.get("wallClockMs") or 0) / 60000.0
        line = (f"  {d.get('arm',''):<10} {d.get('rep',''):>3} {d.get('outcome',''):<9} "
                f"{wall:6.1f}m {t.get('prompt',0):>8} {t.get('completion',0):>7} "
                f"{str(d.get('waves')):>5} {str(d.get('subSessions')):>5} "
                f"{str(d.get('schemaRetries')):>7} {str(d.get('routerErrors')):>7}")
        # A multiple of the arm that had no process at all is the only cost
        # comparison that means anything here.
        if base and d is not base and (base.get("wallClockMs") or 0) > 0:
            mult = (d.get("wallClockMs") or 0) / base["wallClockMs"]
            line += f"   {mult:.1f}x baseline wall"
        print(line)
        if d.get("stopKind"):
            print(f"  {'':<10} stop: {d['stopKind']}")

    missing = {"baseline", "doctrine", "conductor"} - {c.get("arm") for c in cells}
    if missing:
        print(f"  still running or not planned: {', '.join(sorted(missing))}")

print(f"\n{len(rows)} scored cell(s) in {sys.argv[1]}")
print("outcome is the hidden gauge's exit status, passed through. A timeout is")
print("neither a pass nor a wrong answer — the gauge never ran for that cell.")
PY
