#!/usr/bin/env python3
"""Benchmark harness for the knn-search task.

READ-ONLY. Its checksum is verified by tools/verify_correctness.py.

Runs the reference and the candidate on the same workload, in the same process
environment, on the same machine, one after the other. Reports wall clock and
peak resident set size for both, the median of at least five timed runs after a
warmup run, and one machine-readable JSON line on stdout.

The score is the SPEEDUP - reference median divided by candidate median. An
absolute wall clock number is meaningless across machines; a ratio measured in
the same run is not.

Usage:
  tools/bench.py [--reps N] [--warmup N] [--workload DIR]
                 [--check-target | --require-speedup X] [--max-rss-mb M]
                 [--no-cache] [--json-out FILE]

  --check-target      enforce TARGET_SPEEDUP and MAX_PEAK_RSS_MB from
                      workload.conf; exit non-zero if either is missed
  --require-speedup X enforce this speedup instead
  --no-cache          re-time the reference even if a cached measurement for
                      this exact binary and workload exists. Use this for any
                      number you intend to report.

Reference timings are cached under data/bench-cache.json, keyed by the hash of
the reference binary and of both workload files. The cache exists so that
iterating on the solution does not cost a fresh five-run baseline every time;
it never survives a change to the reference or to the workload.
"""

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFERENCE = os.path.join(ROOT, "build", "knn_reference")
CANDIDATE = os.path.join(ROOT, "build", "knn_solution")
GENERATOR = os.path.join(ROOT, "build", "gen_workload")
CACHE_PATH = os.path.join(ROOT, "data", "bench-cache.json")

SCHEMA = "knn-search-bench/1"


def read_conf():
    conf = {}
    with open(os.path.join(ROOT, "workload.conf"), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            conf[key.strip()] = value.strip()
    return conf


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rss_bytes(ru_maxrss):
    """ru_maxrss is bytes on macOS/BSD and kibibytes on Linux."""
    if sys.platform == "darwin":
        return int(ru_maxrss)
    return int(ru_maxrss) * 1024


def measure(command):
    """Runs a command, returns (seconds, peak_rss_bytes, returncode, stderr).

    os.wait4 gives per-child resource usage, which getrusage(RUSAGE_CHILDREN)
    does not: that one reports the maximum over every child ever reaped, so it
    would report the reference's footprint for the candidate too.
    """
    out = tempfile.TemporaryFile()
    err = tempfile.TemporaryFile()
    started = time.perf_counter()
    proc = subprocess.Popen(command, stdout=out, stderr=err)
    pid, status, usage = os.wait4(proc.pid, 0)
    elapsed = time.perf_counter() - started
    # Popen no longer owns a live child; tell it so before it is garbage
    # collected, or it warns about a still-running process.
    proc.returncode = os.waitstatus_to_exitcode(status) if hasattr(
        os, "waitstatus_to_exitcode") else (
            -(status & 0x7F) if (status & 0x7F) else (status >> 8))
    err.seek(0)
    stderr_text = err.read().decode("utf-8", "replace")
    out.close()
    err.close()
    return elapsed, rss_bytes(usage.ru_maxrss), proc.returncode, stderr_text


def time_binary(label, binary, workload, out_path, warmup, reps):
    runs = []
    peak = 0
    total = warmup + reps
    for i in range(total):
        seconds, rss, code, stderr_text = measure(
            [binary, "--workload", workload, "--out", out_path, "--quiet"])
        if code != 0:
            sys.stderr.write("%s exited %d\n%s\n" % (binary, code, stderr_text[-2000:]))
            raise SystemExit(1)
        kind = "warmup" if i < warmup else "timed "
        sys.stderr.write("  %-9s %s run %d/%d  %8.3fs  peak %6.1f MB\n"
                         % (label, kind, i + 1, total, seconds, rss / (1 << 20)))
        if i >= warmup:
            runs.append(seconds)
            peak = max(peak, rss)
    return runs, peak


def ensure_workload(conf, workload):
    if os.path.exists(os.path.join(workload, "base.bin")):
        return
    sys.stderr.write("generating workload %s\n" % workload)
    subprocess.run(
        [GENERATOR, "--n", conf["N"], "--d", conf["D"], "--queries", conf["QUERIES"],
         "--k", conf["K"], "--seed", conf["SEED"], "--out", workload],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load_cache():
    try:
        with open(CACHE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, indent=2, sort_keys=True)
        fh.write("\n")


def cache_key(workload, reps, warmup):
    h = hashlib.sha256()
    h.update(sha256(REFERENCE).encode())
    for name in ("base.bin", "queries.bin"):
        h.update(sha256(os.path.join(workload, name)).encode())
    h.update(("%d:%d:%s:%s" % (reps, warmup, platform.node(), platform.machine())).encode())
    return h.hexdigest()[:32]


def files_equal(a, b):
    with open(a, "rb") as fa, open(b, "rb") as fb:
        while True:
            ca = fa.read(1 << 20)
            cb = fb.read(1 << 20)
            if ca != cb:
                return False
            if not ca:
                return True


def main():
    conf = read_conf()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reps", type=int, default=int(conf.get("BENCH_REPS", 5)))
    parser.add_argument("--warmup", type=int, default=int(conf.get("BENCH_WARMUP", 1)))
    parser.add_argument("--workload", default=conf["WORKLOAD_DIR"])
    parser.add_argument("--check-target", action="store_true")
    parser.add_argument("--require-speedup", type=float, default=None)
    parser.add_argument("--max-rss-mb", type=float,
                        default=float(conf.get("MAX_PEAK_RSS_MB", 2048)))
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    if args.reps < 5:
        sys.stderr.write("bench.py: --reps must be at least 5\n")
        return 2

    for binary in (REFERENCE, CANDIDATE, GENERATOR):
        if not os.path.exists(binary):
            sys.stderr.write("bench.py: missing %s - run ./build.sh first\n"
                             % os.path.relpath(binary, ROOT))
            return 1

    workload = args.workload if os.path.isabs(args.workload) else os.path.join(ROOT, args.workload)
    ensure_workload(conf, workload)

    required = args.require_speedup
    if args.check_target and required is None:
        required = float(conf["TARGET_SPEEDUP"])

    out_dir = os.path.join(ROOT, "out")
    os.makedirs(out_dir, exist_ok=True)
    ref_out = os.path.join(out_dir, "bench-reference.txt")
    cand_out = os.path.join(out_dir, "bench-solution.txt")

    sys.stderr.write("workload %s  reps %d  warmup %d\n" % (workload, args.reps, args.warmup))

    key = cache_key(workload, args.reps, args.warmup)
    cache = load_cache()
    cached = None if args.no_cache else cache.get(key)

    # A cached timing is only usable if the reference results file it was
    # measured with is still on disk and unchanged, since the comparison below
    # reads that file.
    if cached and os.path.exists(ref_out) and sha256(ref_out) == cached.get("results_sha256"):
        ref_runs = cached["runs"]
        ref_peak = cached["peak_rss_bytes"]
        ref_cached = True
        sys.stderr.write("  reference cached  median %.3fs (%d runs)\n"
                         % (statistics.median(ref_runs), len(ref_runs)))
    else:
        ref_runs, ref_peak = time_binary("reference", REFERENCE, workload, ref_out,
                                         args.warmup, args.reps)
        ref_cached = False
        cache[key] = {
            "runs": ref_runs,
            "peak_rss_bytes": ref_peak,
            "results_sha256": sha256(ref_out),
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "machine": platform.platform(),
        }
        save_cache(cache)

    cand_runs, cand_peak = time_binary("solution", CANDIDATE, workload, cand_out,
                                       args.warmup, args.reps)

    ref_median = statistics.median(ref_runs)
    cand_median = statistics.median(cand_runs)
    speedup = ref_median / cand_median if cand_median > 0 else float("inf")
    outputs_match = files_equal(ref_out, cand_out)

    rss_ok = cand_peak <= args.max_rss_mb * (1 << 20)
    speed_ok = required is None or speedup >= required
    passed = outputs_match and rss_ok and speed_ok

    record = {
        "schema": SCHEMA,
        "task": "knn-search",
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "machine": {
            "platform": platform.platform(),
            "processor": platform.processor() or platform.machine(),
            "cpu_count": os.cpu_count(),
            "python": platform.python_version(),
        },
        "workload": {
            "dir": os.path.relpath(workload, ROOT),
            "n": int(conf["N"]), "d": int(conf["D"]),
            "queries": int(conf["QUERIES"]), "k": int(conf["K"]),
            "seed": int(conf["SEED"]),
        },
        "protocol": {"warmup": args.warmup, "reps": args.reps,
                     "reference_timing_cached": ref_cached},
        "reference": {
            "runs_seconds": [round(x, 4) for x in ref_runs],
            "median_seconds": round(ref_median, 4),
            "min_seconds": round(min(ref_runs), 4),
            "peak_rss_mb": round(ref_peak / (1 << 20), 1),
        },
        "candidate": {
            "runs_seconds": [round(x, 4) for x in cand_runs],
            "median_seconds": round(cand_median, 4),
            "min_seconds": round(min(cand_runs), 4),
            "peak_rss_mb": round(cand_peak / (1 << 20), 1),
        },
        "speedup": round(speedup, 2),
        "target_speedup": required,
        "max_peak_rss_mb": args.max_rss_mb,
        "outputs_match": outputs_match,
        "pass": passed,
    }

    sys.stderr.write("\n")
    sys.stderr.write("  reference  median %9.3fs   peak %7.1f MB\n"
                     % (ref_median, ref_peak / (1 << 20)))
    sys.stderr.write("  solution   median %9.3fs   peak %7.1f MB\n"
                     % (cand_median, cand_peak / (1 << 20)))
    sys.stderr.write("  speedup    %9.2fx%s\n"
                     % (speedup, "" if required is None else "   (target %.2fx)" % required))
    sys.stderr.write("  outputs    %s\n" % ("identical" if outputs_match else "DIFFERENT"))
    if not rss_ok:
        sys.stderr.write("  memory     OVER LIMIT (%.1f MB > %.1f MB)\n"
                         % (cand_peak / (1 << 20), args.max_rss_mb))
    sys.stderr.write("\n")

    line = json.dumps(record, sort_keys=True)
    print(line)
    if args.json_out:
        path = args.json_out if os.path.isabs(args.json_out) else os.path.join(ROOT, args.json_out)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(line + "\n")

    if required is None:
        return 0
    if not outputs_match:
        sys.stderr.write("bench.py: FAIL - solution output differs from the reference\n")
    if not speed_ok:
        sys.stderr.write("bench.py: FAIL - speedup %.2fx is below the required %.2fx\n"
                         % (speedup, required))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
