#!/usr/bin/env python3
"""Run a conductor benchmark and watch all three arms in one terminal.

    /usr/bin/python3 scripts/run_and_watch.py

No arguments. Every knob is a constant in the CONFIG block below, each one
documented with what it does and what happens if you change it. Edit the
constants; do not memorise flags.

WHAT IT DOES

Starts scripts/conductor_bench.py as a child process and, while it runs, prints
three feeds that would otherwise need three terminals:

  1. BENCH      the driver's own output, relayed line by line as it arrives.
  2. SCOREBOARD every arm's outcome, wall clock and token cost, read from the
                result JSON each cell writes the moment it finishes.
  3. CONDUCTOR  the live console for the conductor cell currently running:
                stall clock, per-turn table, refusals, sub-session traffic.

Feeds 1 and 2 cover all three arms. Feed 3 covers only the conductor arm, and
that is a fact about the arms rather than a gap in this script: baseline and
doctrine load no plugin, so they write no journal and there is nothing to read.
While those two run you will see the bench feed and nothing else, which is the
honest picture rather than an empty panel implying something is broken.

READ-ONLY EXCEPT FOR THE RUN ITSELF. This script starts the benchmark; the three
feeds only open files for reading. Ctrl-C stops the benchmark and prints a final
scoreboard.
"""

import glob
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional, Sequence

# ═════════════════════════════════════════════════════════════════════════════
# CONFIG — everything you might want to change lives here.
# ═════════════════════════════════════════════════════════════════════════════

# ── WHAT TO RUN ──────────────────────────────────────────────────────────────

# The task set. Each manifest is a self-contained collection of tasks with its
# own defaults. `bench/conductor-tasks.json` is the 23-task ladder that spans
# T0 through T4. The corpus sets are narrower and heavier:
#
#   bench/conductor-tasks.json   23 tasks, T0-T4, the general ladder
#   bench/corpus-euler.json      20 tasks, Project Euler, mostly T1
#   bench/corpus-systems.json     4 tasks, systems implementation
#   bench/corpus-repair.json      5 tasks, debugging and repair
#   bench/corpus-perf.json        3 tasks, performance work
#   bench/corpus-games.json       2 tasks, TUI games
MANIFEST = "bench/conductor-tasks.json"

# Which tasks to run, by id. EMPTY LIST MEANS EVERY TASK IN THE MANIFEST, which
# is the default and is what "run through all the prompts" means. Naming even
# one id here narrows the run to that id, which is what you want when you are
# chasing a single failure.
#
#   TASKS = []                    every task
#   TASKS = ["euler-001-py"]      one task (also set MANIFEST to its set)
TASKS: List[str] = []

# Which tiers to run. Empty means every tier present in the manifest. Tiers are
# a wall-clock budget per cell, not a difficulty rating: T0 1800s, T1 2700s,
# T2 3600s, T3 7200s, T4 3600s. Combining TASKS and TIERS intersects them.
TIERS: List[str] = []

# Repetitions of each (arm, task) pair. ONE is right for watching a run and for
# chasing a specific failure. THREE is the driver's own default and is the floor
# for saying anything about variance — a single repetition cannot separate a
# real spread from noise, and the generated report says so about itself.
#
# Total cells = 3 arms x tasks x REPS. Every cell is one opencode process
# against one throwaway git repo, so this number multiplies the whole run.
REPS = 1

# The model. None means the manifest's own `defaults.model`, which for every
# set in this repository is llamacpp/qwen3.8-27b. Set a string to override.
MODEL: Optional[str] = None

# The capability dimension. None means "none", the only one wired today.
CAPABILITY: Optional[str] = None

# ALL THREE ARMS ALWAYS RUN. The driver has no arm filter, by design: the whole
# point is the comparison, and a run missing an arm is not one. Listed here so
# the set is visible, not because it is adjustable.
#
#   baseline    stock opencode `build` agent. No plugin, no doctrine.
#   doctrine    same agent, all nine doctrine packs as a static system prompt.
#   conductor   the `conductor-orchestrator` agent with the plugin loaded:
#               per-request doctrine injection, 22 extra tools, live gates.
ARMS = ("baseline", "doctrine", "conductor")

# ── WHERE THINGS GO ──────────────────────────────────────────────────────────

# Where each cell's scored result JSON is written.
#
# THIS IS THE MOST CONSEQUENTIAL SETTING IN THE FILE. The driver treats an
# existing result file as a finished cell: it reuses that JSON and DOES NOT
# CREATE THE WORK TREE. Point two runs at one directory and the second silently
# skips everything the first completed. That is a good property for resuming a
# 200-cell overnight and a trap for a comparison you intend to watch — an
# earlier run of ours reported three arms while only one had actually executed.
#
# The default mints a fresh timestamped directory every launch, so nothing is
# ever reused by accident. Set a fixed path to opt into resume.
#
#   RESULTS_DIR = None                              fresh, timestamped
#   RESULTS_DIR = ".data/benchmark/my-campaign"     fixed; resumes
RESULTS_DIR: Optional[str] = None

# Where each cell's throwaway git repo is built. None means the driver's
# default, $TMPDIR/llama-leash-conductor-work. The layout underneath is
# <work root>/<model>/<capability>/<arm>/<task>/rN/ and each of those holds
# repo/ (what the model edits), repo/.conductor/ (run state, which feed 3
# reads), home/ (a hermetic XDG home) and opencode.log (that cell's own log).
#
# Keep it OUT of this repository: a work tree inside the repo would put a git
# checkout inside a git checkout.
WORK_ROOT: Optional[str] = None

# ── WHAT YOU SEE ─────────────────────────────────────────────────────────────

# Seconds between dashboard repaints. The bench feed is relayed as it arrives
# regardless; this only paces the scoreboard and the conductor console. A
# conductor turn on this hardware takes one to seven minutes, so anything under
# ~10s mostly reprints an unchanged screen.
REFRESH_SECONDS = 20

# Individual feeds. Turning one off silences it entirely.
SHOW_BENCH = True
SHOW_SCOREBOARD = True
SHOW_CONDUCTOR = True

# How many lines of the conductor console to show. It prints a header, then
# refusals, one row per turn and one per sub-session message, so a long run
# outgrows a screen.
#
# The header always survives — it carries the stall clock and the alarm, which
# is the reason to be looking. Trimming eats the oldest turn rows first, and on
# a very long run it will reach the refusals block; the header's `refusals N`
# count still tells you they happened. Set 0 to show everything.
CONDUCTOR_LINES = 40

# How many of the driver's most recent output lines to repeat inside the
# dashboard. The lines are also relayed live as they arrive, so this is a recap
# for when a dashboard scrolls past them.
BENCH_TAIL_LINES = 6

# Clear the terminal on each repaint instead of scrolling. False keeps the whole
# run in your scrollback, which is what you want if you intend to read it later.
CLEAR_SCREEN = False

# ── SAFETY ───────────────────────────────────────────────────────────────────

# Print the plan and exit without running anything. Use it to confirm the cell
# list and the estimated wall clock before committing an evening to it.
DRY_RUN = False

# Refuse to start if the estimated worst case exceeds this many hours.
#
# The estimate sums every planned cell's tier timeout, so it is a CEILING and
# not a forecast. Real cells usually come in far under it: on the one task we
# have measured end to end, baseline finished in 4.5 minutes and doctrine in 21
# against a 45-minute T1 budget. Only the conductor arm has ever actually
# reached a ceiling. Read the printed figure as "this cannot take longer than",
# not as "this will take".
#
# The default is set high enough that the shipped config — every task in the
# ladder, one repetition — runs without argument. It is here to catch the
# genuine mistake, like leaving REPS at 3 on a full sweep. Set 0 to disable.
MAX_ESTIMATED_HOURS = 72.0

# ═════════════════════════════════════════════════════════════════════════════
# Below here is the implementation. You should not need to edit it.
# ═════════════════════════════════════════════════════════════════════════════

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH = os.path.join(REPO_ROOT, "scripts", "conductor_bench.py")
OBSERVE = os.path.join(REPO_ROOT, "conductor", "tools", "observe.ts")
LEDGER = os.path.join(REPO_ROOT, ".data", "router", "metrics.jsonl")
PYTHON = "/usr/bin/python3"
ARM_ORDER = {arm: i for i, arm in enumerate(ARMS)}

BENCH_LINES: deque = deque(maxlen=400)
STARTED_AT = time.time()


def hms(seconds: float) -> str:
    """A duration a person can read at a glance."""
    seconds = int(max(0, seconds))
    if seconds < 60:
        return "%ds" % seconds
    if seconds < 3600:
        return "%dm%02ds" % (seconds // 60, seconds % 60)
    return "%dh%02dm" % (seconds // 3600, (seconds % 3600) // 60)


def rule(title: str = "") -> str:
    bar = "─" * 78
    return "\n%s %s" % (title, bar[: max(0, 78 - len(title))]) if title else "\n" + bar


def work_root() -> str:
    return WORK_ROOT or os.path.join(tempfile.gettempdir(), "llama-leash-conductor-work")


def results_dir() -> str:
    if RESULTS_DIR:
        return os.path.join(REPO_ROOT, RESULTS_DIR) if not os.path.isabs(RESULTS_DIR) else RESULTS_DIR
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return os.path.join(REPO_ROOT, ".data", "benchmark", "watch", stamp)


def bench_argv(results: str, plan_only: bool) -> List[str]:
    """The command this script runs on your behalf, assembled from the config."""
    argv = [PYTHON, BENCH, "--manifest", MANIFEST, "--reps", str(REPS), "--results-dir", results]
    for task in TASKS:
        argv += ["--task", task]
    for tier in TIERS:
        argv += ["--tier", tier]
    if MODEL:
        argv += ["--model", MODEL]
    if CAPABILITY:
        argv += ["--capability", CAPABILITY]
    if WORK_ROOT:
        argv += ["--work-root", work_root()]
    if plan_only:
        argv += ["--plan-only"]
    return argv


def planned_cells(results: str) -> List[str]:
    """Ask the driver itself what it intends to run. Never guess the plan."""
    out = subprocess.run(
        bench_argv(results, plan_only=True),
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.stderr.write(out.stdout + out.stderr)
        raise SystemExit("run_and_watch: the driver refused the plan (see above)")
    return [ln.strip() for ln in out.stdout.splitlines() if re.match(r"^\s+\S+/\S+/\S+/\S+/r\d+$", ln)]


def tier_budget_hours(cells: Sequence[str]) -> float:
    """Worst case: every cell burning its whole tier timeout and none finishing early."""
    try:
        manifest = json.load(open(os.path.join(REPO_ROOT, MANIFEST)))
    except (OSError, ValueError):
        return 0.0
    timeouts = manifest.get("defaults", {}).get("tierTimeoutSec", {})
    tier_of = {t["id"]: t.get("tier", "T1") for t in manifest.get("tasks", [])}
    total = 0
    for cell in cells:
        parts = cell.split("/")
        task = parts[3] if len(parts) > 3 else ""
        total += timeouts.get(tier_of.get(task, "T1"), 2700)
    return total / 3600.0


# ── the three feeds ──────────────────────────────────────────────────────────


def read_results(results: str) -> List[dict]:
    rows = []
    for path in sorted(glob.glob(os.path.join(results, "*.json"))):
        try:
            rows.append(json.load(open(path)))
        except (OSError, ValueError):
            continue
    return rows


def scoreboard(results: str, total_cells: int) -> str:
    """Feed 2: every arm, side by side, as each cell lands."""
    rows = read_results(results)
    if not rows:
        return "  no cell has finished yet (%d planned)" % total_cells

    by_task: Dict[str, List[dict]] = {}
    for row in rows:
        by_task.setdefault(row.get("taskId", "?"), []).append(row)

    out = ["  %-22s %-10s %-9s %7s %9s %8s" % ("task", "arm", "outcome", "wall", "prompt", "compl")]
    for task in sorted(by_task):
        cells = sorted(by_task[task], key=lambda d: (ARM_ORDER.get(d.get("arm"), 9), d.get("rep", 0)))
        base = next((c for c in cells if c.get("arm") == "baseline"), None)
        for i, d in enumerate(cells):
            tok = d.get("tokens") or {}
            wall = (d.get("wallClockMs") or 0) / 1000.0
            tail = ""
            if base and d is not base and (base.get("wallClockMs") or 0) > 0:
                tail = "   %.1fx baseline" % ((d.get("wallClockMs") or 0) / base["wallClockMs"])
            out.append("  %-22s %-10s %-9s %7s %9d %8d%s" % (
                task if i == 0 else "", d.get("arm", ""), d.get("outcome", ""),
                hms(wall), tok.get("prompt", 0), tok.get("completion", 0), tail))
        missing = set(ARMS) - {c.get("arm") for c in cells}
        if missing:
            out.append("  %-22s (waiting on %s)" % ("", ", ".join(sorted(missing))))
    out.append("")
    out.append("  %d of %d cell(s) scored" % (len(rows), total_cells))
    return "\n".join(out)


def live_conductor_run() -> Optional[str]:
    """The newest conductor run journal under the work root, if a cell is up."""
    pattern = os.path.join(work_root(), "*", "*", "conductor", "*", "*", "repo", ".conductor", "runs", "*")
    newest, newest_at = None, 0.0
    for run_dir in glob.glob(pattern):
        journal = os.path.join(run_dir, "journal.jsonl")
        if not os.path.isfile(journal):
            continue
        at = os.path.getmtime(journal)
        if at > newest_at:
            newest, newest_at = run_dir, at
    return newest


def conductor_console(run_dir: str) -> str:
    """Feed 3: the live console, via the read-only observer."""
    if shutil.which("node") is None:
        return "  node is not on PATH, so the conductor console is unavailable"
    try:
        out = subprocess.run(
            ["node", OBSERVE, run_dir, "--console", "--ledger", LEDGER],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        return "  (observer timed out; the run is still going)"
    text = (out.stdout or out.stderr or "").rstrip()
    lines = text.splitlines()
    if CONDUCTOR_LINES and len(lines) > CONDUCTOR_LINES:
        # Trim the turn rows, never the header. The header carries the stall
        # clock, the alarm and the mismatch count — the whole reason to be
        # looking — and it sits at the top, so a plain "keep the last N lines"
        # discards precisely what the watcher came for and leaves a wall of
        # turn rows that look fine.
        split = next((i for i, ln in enumerate(lines) if ln.startswith("-- ")), min(10, len(lines)))
        head, rest = lines[:split], lines[split:]
        keep = max(0, CONDUCTOR_LINES - len(head))
        if len(rest) > keep:
            rest = ["... %d earlier row(s) ..." % (len(rest) - keep)] + rest[-keep:]
        lines = head + rest
    return "\n".join("  " + ln for ln in lines)


def dashboard(results: str, total_cells: int) -> str:
    blocks = [rule("== %s  elapsed %s " % (datetime.now().strftime("%H:%M:%S"), hms(time.time() - STARTED_AT)))]

    if SHOW_SCOREBOARD:
        blocks.append(rule("SCOREBOARD — all arms "))
        blocks.append(scoreboard(results, total_cells))

    if SHOW_CONDUCTOR:
        run_dir = live_conductor_run()
        blocks.append(rule("CONDUCTOR — live "))
        if run_dir is None:
            blocks.append("  no conductor cell is running yet.")
            blocks.append("  (baseline and doctrine load no plugin, so they write no journal;")
            blocks.append("   there is nothing to show while one of those two is the live arm.)")
        else:
            blocks.append(conductor_console(run_dir))

    if SHOW_BENCH and BENCH_TAIL_LINES:
        blocks.append(rule("BENCH — driver output "))
        tail = list(BENCH_LINES)[-BENCH_TAIL_LINES:]
        blocks.append("\n".join("  " + ln for ln in tail) if tail else "  (nothing yet)")

    return "\n".join(blocks) + "\n"


# ── the run ──────────────────────────────────────────────────────────────────


def relay(stream) -> None:
    """Pump the driver's output into the log and, if asked, onto the screen."""
    for raw in iter(stream.readline, ""):
        line = raw.rstrip("\n")
        BENCH_LINES.append(line)
        if SHOW_BENCH:
            sys.stdout.write("[bench] %s\n" % line)
            sys.stdout.flush()
    stream.close()


def main() -> int:
    if not os.path.isfile(BENCH):
        sys.stderr.write("run_and_watch: cannot find %s\n" % BENCH)
        return 2

    results = results_dir()
    cells = planned_cells(results)
    hours = tier_budget_hours(cells)

    print(rule("PLAN "))
    print("  manifest      %s" % MANIFEST)
    print("  tasks         %s" % (", ".join(TASKS) if TASKS else "every task in the manifest"))
    print("  tiers         %s" % (", ".join(TIERS) if TIERS else "every tier"))
    print("  arms          %s  (always all three)" % ", ".join(ARMS))
    print("  reps          %d" % REPS)
    print("  cells         %d" % len(cells))
    print("  results       %s" % results)
    print("  work root     %s" % work_root())
    print("  worst case    %.1f hours if every cell burns its whole tier timeout" % hours)
    if os.path.isdir(results) and glob.glob(os.path.join(results, "*.json")):
        print("  NOTE          this results directory already holds scored cells;")
        print("                those cells will be REUSED and not re-run.")

    if DRY_RUN:
        print("\nDRY_RUN is on. Nothing was started.")
        for cell in cells:
            print("  %s" % cell)
        return 0

    if MAX_ESTIMATED_HOURS and hours > MAX_ESTIMATED_HOURS:
        print("\nrun_and_watch: worst case %.1fh exceeds MAX_ESTIMATED_HOURS (%.1fh)." % (hours, MAX_ESTIMATED_HOURS))
        print("Narrow it with TASKS or TIERS, lower REPS, or raise the ceiling.")
        return 1

    os.makedirs(results, exist_ok=True)
    argv = bench_argv(results, plan_only=False)
    print(rule("STARTING "))
    print("  %s\n" % " ".join(argv))

    proc = subprocess.Popen(
        argv, cwd=REPO_ROOT, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    pump = threading.Thread(target=relay, args=(proc.stdout,), daemon=True)
    pump.start()

    def stop(_signum, _frame):
        print("\n\nrun_and_watch: stopping the benchmark…")
        proc.terminate()

    signal.signal(signal.SIGINT, stop)

    try:
        while proc.poll() is None:
            time.sleep(REFRESH_SECONDS)
            if CLEAR_SCREEN:
                sys.stdout.write("\033[H\033[J")
            sys.stdout.write(dashboard(results, len(cells)))
            sys.stdout.flush()
    finally:
        pump.join(timeout=5)

    print(rule("FINAL "))
    print(dashboard(results, len(cells)))
    print("  driver exit   %s" % proc.returncode)
    print("  results       %s" % results)
    print("  report        %s" % os.path.join(REPO_ROOT, ".data", "benchmark", "conductor-report.md"))
    print("  work trees    %s  (kept, for reading afterwards)" % work_root())
    return proc.returncode or 0


if __name__ == "__main__":
    sys.exit(main())
