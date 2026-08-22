#!/usr/bin/env python3
"""Benchmark harness for the log-aggregation task.

Runs the reference aggregator and the candidate over the *same* workload, on
the *same* machine, in the *same* invocation, and reports the ratio between
them. The ratio is the only number that transfers between machines; an absolute
wall-clock figure does not, which is why the pass/fail gate is a speedup factor.

Method
------
* one warmup execution of each program, discarded, so the page cache holds the
  input file and neither side pays for a cold read;
* `--runs` timed executions of each (default 5, minimum 5 for a valid result),
  interleaved reference/candidate/reference/candidate so that thermal drift or
  a noisy neighbour hits both sides roughly equally;
* wall clock from `time.perf_counter()` around a fork/exec, peak RSS from
  `os.wait4()`, which reports the resource usage of that one child;
* both sides are run under the *same* Python interpreter: the one running this
  harness is exported to the children as `LOGAGG_PYTHON`, and `run.sh` is
  required to use `"${LOGAGG_PYTHON:-python3}"`. Beating the reference by
  picking a newer interpreter is not an optimisation of the program;
* the reported figure is the **median** of the timed runs, which is far less
  sensitive to a single scheduling hiccup than the mean;
* after every timed pair the two output files are compared byte for byte. A
  candidate that is fast and wrong scores nothing, so the benchmark refuses to
  report a speedup unless the outputs match.

Usage
-----
    python3 tools/bench.py
    python3 tools/bench.py --input data/access.log --runs 7
    python3 tools/bench.py --candidate ./run.sh --target 6.0
    python3 tools/bench.py --no-gate            # report, never fail

The last line of stdout is `BENCHMARK_JSON {...}`, for the scorer.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "reference" / "aggregate.py"
DEFAULT_INPUT = ROOT / "data" / "access.log"

# The gate. Mirrored in task.json ("speedup_target") and in the prompt.
REQUIRED_SPEEDUP = 6.0

MIN_VALID_RUNS = 5


def maxrss_bytes(raw):
    """os.wait4 reports ru_maxrss in bytes on macOS and in KiB on Linux."""
    if sys.platform == "darwin":
        return int(raw)
    return int(raw) * 1024


def run_measured(argv, cwd):
    """Execute argv, returning (exit_code, wall_seconds, peak_rss_bytes)."""
    start = time.perf_counter()
    pid = os.fork()
    if pid == 0:  # pragma: no cover - child process
        try:
            os.chdir(str(cwd))
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.execvp(argv[0], argv)
        except BaseException:
            os._exit(127)
    _, status, usage = os.wait4(pid, 0)
    elapsed = time.perf_counter() - start
    if os.WIFEXITED(status):
        code = os.WEXITSTATUS(status)
    elif os.WIFSIGNALED(status):
        code = -os.WTERMSIG(status)
    else:
        code = 1
    return code, elapsed, maxrss_bytes(usage.ru_maxrss)


def median(values):
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return None
    if n % 2 == 1:
        return ordered[n // 2]
    return (ordered[n // 2 - 1] + ordered[n // 2]) / 2.0


def human_bytes(n):
    step = 1024.0
    value = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < step or unit == "GiB":
            return "%.1f %s" % (value, unit)
        value /= step
    return "%.1f GiB" % value


def same_bytes(a: Path, b: Path):
    if not a.exists() or not b.exists():
        return False
    if a.stat().st_size != b.stat().st_size:
        return False
    with a.open("rb") as fa, b.open("rb") as fb:
        while True:
            chunk_a = fa.read(1 << 20)
            chunk_b = fb.read(1 << 20)
            if chunk_a != chunk_b:
                return False
            if not chunk_a:
                return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default=None,
                    help="workload to aggregate (default: data/access.log)")
    ap.add_argument("--candidate", default="./run.sh",
                    help="candidate command, invoked as <cmd> <input> <output> "
                         "from the workspace root (default: ./run.sh)")
    ap.add_argument("--runs", type=int, default=MIN_VALID_RUNS,
                    help="timed executions of each program (default and "
                         "minimum for a valid result: %d)" % MIN_VALID_RUNS)
    ap.add_argument("--warmup", type=int, default=1,
                    help="discarded executions of each program first (default: 1)")
    ap.add_argument("--target", type=float, default=REQUIRED_SPEEDUP,
                    help="required minimum speedup (default: %.1f)" % REQUIRED_SPEEDUP)
    ap.add_argument("--outdir", default=None,
                    help="where to write the two report files "
                         "(default: bench-out/ under the workspace root)")
    ap.add_argument("--no-gate", action="store_true",
                    help="always exit 0; report the numbers without judging them")
    args = ap.parse_args(argv)

    input_path = Path(args.input) if args.input else DEFAULT_INPUT
    if not input_path.is_absolute():
        input_path = (Path.cwd() / input_path).resolve()
    if not input_path.exists():
        sys.stderr.write(
            "workload not found: %s\n"
            "generate it first, for example:\n"
            "  python3 tools/generate_workload.py --lines 1500000 "
            "--seed 20260320 --minutes 240 --out data/access.log\n" % input_path)
        return 2
    if not REFERENCE.exists():
        sys.stderr.write("reference not found at %s\n" % REFERENCE)
        return 2

    outdir = Path(args.outdir) if args.outdir else ROOT / "bench-out"
    if not outdir.is_absolute():
        outdir = (Path.cwd() / outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    ref_out = outdir / "reference-report.json"
    cand_out = outdir / "candidate-report.json"

    # Both sides must run under one interpreter, or the ratio measures CPython
    # releases rather than the candidate's work. run.sh honours this variable.
    os.environ["LOGAGG_PYTHON"] = sys.executable

    reference_cmd = [sys.executable, str(REFERENCE), str(input_path), str(ref_out)]
    candidate_cmd = args.candidate.split() + [str(input_path), str(cand_out)]

    size = input_path.stat().st_size
    sys.stdout.write("workload   %s (%s)\n" % (input_path, human_bytes(size)))
    sys.stdout.write("reference  %s\n" % " ".join(reference_cmd))
    sys.stdout.write("candidate  %s\n" % " ".join(candidate_cmd))
    sys.stdout.write("runs       %d timed, %d warmup\n" % (args.runs, args.warmup))
    sys.stdout.write("python     %s (exported as LOGAGG_PYTHON)\n\n" % sys.executable)
    sys.stdout.flush()

    for index in range(args.warmup):
        for label, cmd in (("reference", reference_cmd), ("candidate", candidate_cmd)):
            code, elapsed, _ = run_measured(cmd, ROOT)
            sys.stdout.write("  warmup %d  %-9s %7.2fs%s\n"
                             % (index + 1, label, elapsed,
                                "" if code == 0 else "   EXIT %d" % code))
            sys.stdout.flush()
            if code != 0:
                sys.stderr.write("%s failed during warmup (exit %d)\n" % (label, code))
                return 2
    if args.warmup:
        sys.stdout.write("\n")

    ref_times, ref_rss = [], []
    cand_times, cand_rss = [], []
    mismatch = False

    for index in range(args.runs):
        code, elapsed, rss = run_measured(reference_cmd, ROOT)
        if code != 0:
            sys.stderr.write("reference failed (exit %d)\n" % code)
            return 2
        ref_times.append(elapsed)
        ref_rss.append(rss)

        code, elapsed_c, rss_c = run_measured(candidate_cmd, ROOT)
        if code != 0:
            sys.stderr.write("candidate failed (exit %d)\n" % code)
            return 2
        cand_times.append(elapsed_c)
        cand_rss.append(rss_c)

        identical = same_bytes(ref_out, cand_out)
        if not identical:
            mismatch = True

        sys.stdout.write("  run %d/%d   reference %7.2fs  candidate %7.2fs   "
                         "x%5.2f   %s\n"
                         % (index + 1, args.runs, elapsed, elapsed_c,
                            elapsed / elapsed_c if elapsed_c > 0 else float("inf"),
                            "identical" if identical else "OUTPUT DIFFERS"))
        sys.stdout.flush()

    ref_median = median(ref_times)
    cand_median = median(cand_times)
    speedup = ref_median / cand_median if cand_median > 0 else float("inf")
    ref_peak = max(ref_rss)
    cand_peak = max(cand_rss)

    valid = args.runs >= MIN_VALID_RUNS
    passed = (not mismatch) and valid and speedup >= args.target

    sys.stdout.write("\n")
    sys.stdout.write("  reference  median %7.2fs   min %7.2fs   max %7.2fs   "
                     "peak RSS %s\n"
                     % (ref_median, min(ref_times), max(ref_times),
                        human_bytes(ref_peak)))
    sys.stdout.write("  candidate  median %7.2fs   min %7.2fs   max %7.2fs   "
                     "peak RSS %s\n"
                     % (cand_median, min(cand_times), max(cand_times),
                        human_bytes(cand_peak)))
    sys.stdout.write("\n  speedup    x%.2f   (required: x%.2f)\n"
                     % (speedup, args.target))
    sys.stdout.write("  memory     x%.2f less peak RSS\n"
                     % (ref_peak / cand_peak if cand_peak else float("inf")))
    sys.stdout.write("  output     %s\n"
                     % ("byte-identical to the reference on every run"
                        if not mismatch else
                        "DIFFERS FROM THE REFERENCE - the result is void"))
    if not valid:
        sys.stdout.write("  WARNING    fewer than %d timed runs: result is not "
                         "valid for scoring\n" % MIN_VALID_RUNS)
    sys.stdout.write("  verdict    %s\n" % ("PASS" if passed else "FAIL"))

    payload = {
        "task": "log-aggregation",
        "input": str(input_path),
        "input_bytes": size,
        "runs": args.runs,
        "warmup": args.warmup,
        "reference_median_s": round(ref_median, 4),
        "reference_times_s": [round(t, 4) for t in ref_times],
        "reference_peak_rss_bytes": ref_peak,
        "candidate_median_s": round(cand_median, 4),
        "candidate_times_s": [round(t, 4) for t in cand_times],
        "candidate_peak_rss_bytes": cand_peak,
        "speedup": round(speedup, 4),
        "memory_ratio": round(ref_peak / cand_peak, 4) if cand_peak else None,
        "target_speedup": args.target,
        "python": sys.executable,
        "platform": sys.platform,
        "outputs_identical": not mismatch,
        "valid": valid,
        "pass": passed,
    }
    sys.stdout.write("BENCHMARK_JSON " + json.dumps(payload, sort_keys=True) + "\n")

    if args.no_gate:
        return 0
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
