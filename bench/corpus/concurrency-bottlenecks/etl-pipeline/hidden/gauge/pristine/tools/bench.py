#!/usr/bin/env python3
"""Benchmark harness for the etl-pipeline task.

READ-ONLY.

Runs the unmodified starting implementation under baseline/ and the pipeline
under etl/ over the *same* workload, on the *same* machine, in the *same*
invocation, and reports the ratio between them. The ratio is the only number
that transfers between machines; an absolute wall-clock figure does not, which
is why the target is a speedup factor.

Method
------
* one warmup execution of each side, discarded;
* `--runs` timed executions of each, the two sides alternating and each pair
  swapping which side goes first, so an even `--runs` gives both sides the same
  number of first and second slots;
* the input files are read through the page cache before each pair, so a run
  whose input was evicted by the other side does not pay for disk the other
  side did not;
* wall clock from `time.perf_counter()` around a fork/exec, peak RSS from
  `os.wait4()`, which reports the resource usage of that one child;
* both sides run under the *same* interpreter: the one running this harness is
  exported to the children as `ETL_PYTHON`, and `run.sh` is required to use
  `"${ETL_PYTHON:-python3}"`. Beating the baseline by picking a newer
  interpreter is not an optimisation of the program;
* the baseline child runs *from* `baseline/`. `python -m etl` puts the working
  directory at the head of `sys.path`, ahead of `PYTHONPATH`, so a baseline
  spawned from the project root would import the `etl/` package under
  optimisation and report a ratio of 1.0 however fast that package became;
* the reported figure is the **median** of the timed runs;
* after every timed run the candidate's output directory is compared against
  the baseline's, file by file. A candidate that is fast and wrong reports
  nothing.

Usage
-----
    python3 tools/bench.py
    python3 tools/bench.py --events data/main/events.ndjson --workers 8 --runs 5

The last line of stdout is `BENCHMARK_JSON {...}`.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The directory the frozen starting implementation is executed from: it holds
# the only `etl` package the baseline child may import.
BASELINE_ROOT = ROOT / "baseline"
PYTHON = sys.executable or "python3"

OUTPUT_FILES = ("windows.csv", "rejects.tsv", "summary.txt")


def rss_bytes(raw):
    """ru_maxrss is bytes on macOS and BSD, kibibytes on Linux."""
    if sys.platform == "darwin":
        return int(raw)
    return int(raw) * 1024


def measure(argv, env, cwd):
    """Wall clock and peak RSS of one child, or None if it did not exit 0.

    ``cwd`` is per side and decides which `etl` package the child imports, so
    it is required rather than defaulted to the project root.
    """
    out = tempfile.TemporaryFile()
    err = tempfile.TemporaryFile()
    started = time.perf_counter()
    proc = subprocess.Popen(argv, cwd=str(cwd), env=env, stdout=out, stderr=err)
    _pid, status, usage = os.wait4(proc.pid, 0)
    elapsed = time.perf_counter() - started
    proc.returncode = os.waitstatus_to_exitcode(status) if hasattr(
        os, "waitstatus_to_exitcode") else (
            -(status & 0x7F) if (status & 0x7F) else (status >> 8))
    err.seek(0)
    stderr_text = err.read().decode("utf-8", "replace")
    out.close()
    err.close()
    if proc.returncode != 0:
        sys.stderr.write(stderr_text[-2000:] + "\n")
        return None
    return elapsed, rss_bytes(usage.ru_maxrss)


def warm(paths):
    """Pull the inputs through the page cache before each pair."""
    for path in paths:
        with open(str(path), "rb") as handle:
            while handle.read(1 << 22):
                pass


def same_output(left: Path, right: Path):
    for name in OUTPUT_FILES:
        a = left / name
        b = right / name
        if not a.exists() or not b.exists():
            return False, "%s is missing" % name
        if a.read_bytes() != b.read_bytes():
            return False, "%s differs" % name
    return True, "byte-identical"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--events", default="data/main/events.ndjson")
    ap.add_argument("--devices", default="data/main/devices.tsv")
    ap.add_argument("--workers", default="8")
    ap.add_argument("--runs", type=int, default=4,
                    help="timed executions of each side; keep it even so both "
                         "sides lead the same number of pairs (default: 4)")
    ap.add_argument("--warmup", type=int, default=1)
    ap.add_argument("--outdir", default="bench-out")
    args = ap.parse_args(argv)

    events = Path(args.events)
    devices = Path(args.devices)
    if not events.is_absolute():
        events = (Path.cwd() / events).resolve()
    if not devices.is_absolute():
        devices = (Path.cwd() / devices).resolve()
    for path in (events, devices):
        if not path.exists():
            sys.stderr.write(
                "workload not found: %s\ngenerate it first, for example:\n"
                "  python3 tools/gen_workload.py --out data/main --records "
                "1200000 --seed 20260820\n" % path)
            return 2

    outdir = Path(args.outdir)
    if not outdir.is_absolute():
        outdir = (Path.cwd() / outdir).resolve()
    base_out = outdir / "baseline"
    cand_out = outdir / "candidate"
    for path in (base_out, cand_out):
        path.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env["ETL_PYTHON"] = PYTHON
    env["PYTHONDONTWRITEBYTECODE"] = "1"

    base_env = dict(env)
    base_env["PYTHONPATH"] = str(BASELINE_ROOT)
    baseline_cmd = [PYTHON, "-m", "etl", "--events", str(events),
                    "--devices", str(devices), "--out", str(base_out),
                    "--workers", str(args.workers)]
    candidate_cmd = ["bash", "run.sh", str(events), str(devices),
                     str(cand_out), str(args.workers)]

    sys.stdout.write("events     %s\n" % events)
    sys.stdout.write("workers    %s\n" % args.workers)
    sys.stdout.write("runs       %d timed, %d warmup\n" % (args.runs, args.warmup))
    sys.stdout.write("python     %s (exported as ETL_PYTHON)\n\n" % PYTHON)
    sys.stdout.flush()

    sides = (
        ("baseline", baseline_cmd, base_env, BASELINE_ROOT),
        ("candidate", candidate_cmd, env, ROOT),
    )

    for index in range(args.warmup):
        for label, cmd, cmd_env, cmd_cwd in sides:
            result = measure(cmd, cmd_env, cmd_cwd)
            if result is None:
                sys.stderr.write("%s failed during warmup\n" % label)
                return 2
            sys.stdout.write("  warmup %d  %-9s %7.2fs\n" % (index + 1, label, result[0]))
            sys.stdout.flush()

    times = {"baseline": [], "candidate": []}
    peaks = {"baseline": 0, "candidate": 0}
    mismatch = None

    for index in range(args.runs):
        warm([events, devices])
        pair = sides if index % 2 == 0 else tuple(reversed(sides))
        for label, cmd, cmd_env, cmd_cwd in pair:
            result = measure(cmd, cmd_env, cmd_cwd)
            if result is None:
                sys.stderr.write("%s failed on run %d\n" % (label, index + 1))
                return 2
            times[label].append(result[0])
            peaks[label] = max(peaks[label], result[1])
        identical, detail = same_output(base_out, cand_out)
        if not identical:
            mismatch = detail
        sys.stdout.write("  run %d/%d   baseline %7.2fs  candidate %7.2fs   x%5.2f   %s\n"
                         % (index + 1, args.runs, times["baseline"][-1],
                            times["candidate"][-1],
                            times["baseline"][-1] / times["candidate"][-1],
                            detail))
        sys.stdout.flush()

    base_median = statistics.median(times["baseline"])
    cand_median = statistics.median(times["candidate"])
    speedup = base_median / cand_median if cand_median > 0 else float("inf")

    sys.stdout.write("\n")
    sys.stdout.write("  baseline   median %7.2fs   peak %8.1f MB\n"
                     % (base_median, peaks["baseline"] / (1 << 20)))
    sys.stdout.write("  candidate  median %7.2fs   peak %8.1f MB\n"
                     % (cand_median, peaks["candidate"] / (1 << 20)))
    sys.stdout.write("  speedup    x%.2f\n" % speedup)
    sys.stdout.write("  output     %s\n"
                     % ("byte-identical to the baseline on every run"
                        if mismatch is None else
                        "DIFFERS FROM THE BASELINE (%s) - the result is void" % mismatch))

    payload = {
        "task": "etl-pipeline",
        "events": str(events),
        "workers": args.workers,
        "runs": args.runs,
        "warmup": args.warmup,
        "baseline_median_s": round(base_median, 4),
        "baseline_times_s": [round(t, 4) for t in times["baseline"]],
        "baseline_peak_rss_bytes": peaks["baseline"],
        "candidate_median_s": round(cand_median, 4),
        "candidate_times_s": [round(t, 4) for t in times["candidate"]],
        "candidate_peak_rss_bytes": peaks["candidate"],
        "speedup": round(speedup, 4),
        "outputs_identical": mismatch is None,
        "python": PYTHON,
    }
    sys.stdout.write("BENCHMARK_JSON " + json.dumps(payload, sort_keys=True) + "\n")
    return 0 if mismatch is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
