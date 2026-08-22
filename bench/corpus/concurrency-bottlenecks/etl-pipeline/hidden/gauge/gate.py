#!/usr/bin/env python3
"""The graded gate for the etl-pipeline task.

It is materialized into the work tree only after the model's process has
exited, so nothing it contains can be read, run or targeted while the task is
being worked on.

The verdict is the exit status and it has three parts, decided in this order:

  1. integrity - SPEC.md, the workload generator, the output checker and the
     frozen starting implementation under baseline/ still hold the bytes
     gauge/pristine holds. baseline/ is the performance denominator, so a
     workspace that slowed it down has answered a different question;
  2. correctness - the pipeline's three output files, over a workload generated
     for this run, byte-for-byte against tools/verify_output.py's independent
     implementation of SPEC.md, and then the same workload again at ONE worker
     with the two output directories required to be identical. SPEC.md section
     6 makes the bytes independent of how the work was scheduled, and that is
     the property a careless parallelisation breaks. Both are decided before a
     single timing run, so a fast wrong answer fails as a wrong answer;
  3. speed - the ratio between the frozen baseline's median wall clock and the
     candidate's, both measured here, alternating, on this machine, in this
     process, over a workload generated for this run, with the candidate's
     output compared against the baseline's after every pair.

Why a ratio. An absolute second count is a property of the machine that
measured it, so a gate built on one is a gate that passes or fails on hardware
rather than on the work. The baseline is re-timed beside the candidate every
time the gate runs, and the threshold is the factor between them. It is also
the shape the task's own rubric defines: S = baseline median / candidate
median, both at 8 workers, same machine, same session, baseline being the
unmodified starting implementation in the same language.

Why THIS ratio, and what is weak about it. The task ships NO pass/fail speed
gate of its own - its published harness prints an unjudged throughput line and
a person applies a band table - so unlike the other two speed tasks in this set
the threshold here is chosen rather than inherited. It is chosen at 4.0, which
is the floor of the rubric's 19-point band, and two bands above where that
rubric says constant-factor tidying lands (1.25-2). Two measurements on the
authoring machine anchor it, at 400,000 records and 8 workers: the starting
implementation takes 31.9 s, and the deliberately-most-obvious single-threaded
implementation of the same specification - the oracle inside
tools/verify_output.py - computes and writes the same three files in 13.7 s,
which is x2.3. So 4.0 sits above "transcribe the obvious implementation" with
room to spare, and far below the x12 the rubric's top band asks for. What it is
NOT is calibrated against a real solve: no reference solution to this task
exists anywhere in the material it was ported from. Treat 4.0 as a defensible
starting bar to be re-checked against the first genuine solve, not as a
measured separation the way the knn-search 40x is.

Why one interpreter. Both sides run under THIS interpreter: ETL_PYTHON is
exported, and a `python3` shim resolving to it is put at the head of PATH, so a
candidate that ignores the variable still cannot win by finding a faster
CPython on the box.

Which baseline. The baseline child is spawned FROM gauge/pristine/baseline, not
from the workspace. `python -m etl` puts the working directory at the head of
sys.path, ahead of PYTHONPATH, and the workspace root holds the `etl/` package
the task hands to the candidate - so a baseline spawned from the workspace root
imports the candidate's own code, and the ratio is 1.0 by construction no
matter what the candidate does. The working directory, not PYTHONPATH, is what
decides which of the two same-named packages is measured.

Flakiness. Each side runs one discarded warmup and GATE_TIMED_RUNS timed runs,
and the reported figure is the MEDIAN, which one scheduling hiccup cannot move.
The pairs alternate which side goes first, so an even number of timed runs
gives each side the same number of first and second slots. The workload is read
through the page cache before each pair, so neither side pays for disk the
other did not. A run whose first timed pair is already below half the target is
refused there rather than paying three more minutes to reach the same verdict.

    python3 gauge/gate.py
"""

import os
import random
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

GAUGE = os.path.dirname(os.path.abspath(__file__))
PRISTINE = os.path.join(GAUGE, "pristine")
ROOT = os.path.dirname(GAUGE)
WORK = os.path.join(GAUGE, "work")

# The directory the frozen baseline is executed from. `python -m etl` puts the
# working directory at the head of sys.path, ahead of PYTHONPATH, and the
# workspace root holds an `etl/` package the task hands to the candidate. A
# baseline spawned from the workspace root therefore imports the candidate's
# own code and the ratio is 1.0 by construction, whatever the candidate does.
# Spawning it from here makes the frozen copy the only `etl` on the path.
BASELINE_ROOT = os.path.join(PRISTINE, "baseline")

PYTHON = sys.executable or "python3"

TARGET_SPEEDUP = 4.0

# The timing workload. 400,000 records rather than the 1,200,000 the task's own
# published workload uses: the pipeline is linear in records - measured 32.4 s
# at 400k against 95.8 s at 1.2M for the Python baseline, and 2.08 s against
# 6.23 s for the C++ one, so the cross-implementation ratio moves by under 2%
# across the two sizes - and a third of the records is a third of the wall
# clock for the same measured factor. The seed appears nowhere the workspace
# can read.
GATE_RECORDS = 400000
GATE_SEED = 705193822
GATE_WORKERS = "8"

# The correctness workload, small enough to run twice and to recompute against
# in a couple of seconds.
CHECK_RECORDS = 25000
CHECK_SEED = 344911067
CHECK_DEVICES = "140"

GATE_WARMUP_RUNS = 1
# Even, so each side leads the same number of pairs.
GATE_TIMED_RUNS = 4

# A first timed pair below this fraction of the target is refused immediately.
# The band is a factor of two, which is far outside the measured noise.
EARLY_REFUSAL_FRACTION = 0.5

OUTPUT_FILES = ("windows.csv", "rejects.tsv", "summary.txt")


def say(text):
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def fail(text):
    sys.stdout.write("FAIL  " + text + "\n")
    sys.stdout.flush()


def pristine_files():
    """Every guarded relpath, as forward-slash paths in a stable order."""
    out = []
    for base, _dirs, names in os.walk(PRISTINE):
        for name in sorted(names):
            full = os.path.join(base, name)
            out.append(os.path.relpath(full, PRISTINE).replace(os.sep, "/"))
    return sorted(out)


def check_integrity():
    """Refuse a workspace that edited the specification, the checker or the
    implementation the ratio is measured against."""
    guarded = pristine_files()
    if not guarded:
        fail("gauge/pristine is empty; the gate cannot vouch for anything")
        return False
    problems = []
    for rel in guarded:
        expected = os.path.join(PRISTINE, rel.replace("/", os.sep))
        actual = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(actual):
            problems.append("missing read-only file: %s" % rel)
            continue
        with open(expected, "rb") as handle:
            want = handle.read()
        with open(actual, "rb") as handle:
            got = handle.read()
        if want != got:
            problems.append("modified read-only file: %s" % rel)
    for problem in problems:
        fail(problem)
    if problems:
        return False
    say("ok    read-only material intact (%d files)" % len(guarded))
    return True


def pinned_environment():
    """One interpreter for both sides, whatever run.sh reaches for.

    ETL_PYTHON is the contract the workspace states. The shim directory is the
    part a candidate cannot decline: `python3` and `python` on PATH both
    resolve to the interpreter running this gate.
    """
    bindir = os.path.join(WORK, "bin")
    os.makedirs(bindir, exist_ok=True)
    for name in ("python3", "python"):
        shim = os.path.join(bindir, name)
        with open(shim, "w", encoding="utf-8") as handle:
            handle.write('#!/bin/sh\nexec "%s" "$@"\n' % PYTHON)
        os.chmod(shim, 0o755)
    env = dict(os.environ)
    env["ETL_PYTHON"] = PYTHON
    env["PATH"] = bindir + os.pathsep + env.get("PATH", "")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env.pop("ETL_EVENTS", None)
    env.pop("ETL_DEVICES", None)
    env.pop("ETL_OUT", None)
    env.pop("ETL_WORKERS", None)
    say("ok    both sides pinned to %s" % PYTHON)
    return env


def generate(env, out_dir, records, seed, devices=None):
    argv = [PYTHON, os.path.join(PRISTINE, "tools", "gen_workload.py"),
            "--out", out_dir, "--records", str(records), "--seed", str(seed),
            "--quiet"]
    if devices is not None:
        argv += ["--devices", devices]
    completed = subprocess.run(argv, cwd=ROOT, env=env)
    if completed.returncode != 0:
        fail("the gate could not generate a workload in %s" % out_dir)
        return None
    return (os.path.join(out_dir, "events.ndjson"),
            os.path.join(out_dir, "devices.tsv"))


def rss_bytes(raw):
    """ru_maxrss is bytes on macOS and BSD, kibibytes on Linux."""
    if sys.platform == "darwin":
        return int(raw)
    return int(raw) * 1024


def measure(argv, env, cwd):
    """Wall clock and peak RSS of one child, or None if it did not exit 0.

    os.wait4 reports the resource usage of THAT child. getrusage on the
    children bucket would report the maximum over every child reaped so far,
    which is the baseline's footprint attributed to the candidate.

    ``cwd`` is per side and decides which `etl` package the child imports, so
    it is required rather than defaulted to the workspace root.
    """
    out = tempfile.TemporaryFile()
    err = tempfile.TemporaryFile()
    started = time.perf_counter()
    proc = subprocess.Popen(argv, cwd=cwd, env=env, stdout=out, stderr=err)
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
        sys.stdout.write(stderr_text[-2000:] + "\n")
        return None
    return elapsed, rss_bytes(usage.ru_maxrss)


def same_output(left, right):
    """Whether two output directories hold the same three files, byte for byte."""
    for name in OUTPUT_FILES:
        a = os.path.join(left, name)
        b = os.path.join(right, name)
        if not os.path.exists(a) or not os.path.exists(b):
            return False, "%s is missing" % name
        with open(a, "rb") as fa, open(b, "rb") as fb:
            if fa.read() != fb.read():
                return False, "%s differs" % name
    return True, "byte-identical"


def candidate_command(events, devices, out_dir, workers):
    return ["bash", "run.sh", events, devices, out_dir, workers]


def baseline_command(events, devices, out_dir, workers):
    return [PYTHON, "-m", "etl", "--events", events, "--devices", devices,
            "--out", out_dir, "--workers", workers]


def baseline_environment(env):
    """The frozen starting implementation, imported out of gauge/pristine.

    PYTHONPATH states the intent; BASELINE_ROOT as the child's working
    directory is what enforces it, because sys.path[0] outranks PYTHONPATH.
    Both name the same directory, so there is one answer to `import etl`.
    """
    out = dict(env)
    out["PYTHONPATH"] = BASELINE_ROOT
    return out


def check_correctness(env):
    """Exact output against an independent implementation, and at one worker."""
    check_dir = os.path.join(WORK, "check")
    paths = generate(env, check_dir, CHECK_RECORDS, CHECK_SEED, CHECK_DEVICES)
    if paths is None:
        return False
    events, devices = paths

    eight = os.path.join(WORK, "check-out-8")
    one = os.path.join(WORK, "check-out-1")
    for out_dir in (eight, one):
        if os.path.isdir(out_dir):
            shutil.rmtree(out_dir, ignore_errors=True)

    for out_dir, workers in ((eight, GATE_WORKERS), (one, "1")):
        result = measure(candidate_command(events, devices, out_dir, workers), env, ROOT)
        if result is None:
            fail("run.sh exited non-zero on the correctness workload at %s worker(s)"
                 % workers)
            return False

    argv = [PYTHON, os.path.join(PRISTINE, "tools", "verify_output.py"),
            "--events", events, "--devices", devices, "--out", eight, "--recompute"]
    completed = subprocess.run(argv, cwd=ROOT, env=env)
    if completed.returncode != 0:
        fail("the output is not what SPEC.md defines for this input")
        return False
    say("ok    output byte-exact against an independent implementation of SPEC.md")

    identical, detail = same_output(eight, one)
    if not identical:
        fail("the output at 1 worker differs from the output at %s (%s); SPEC.md "
             "section 6 makes the bytes independent of how the work was scheduled"
             % (GATE_WORKERS, detail))
        return False
    say("ok    output identical at 1 worker and at %s" % GATE_WORKERS)
    return True


def warm(paths):
    """Pull the timing inputs through the page cache before each pair.

    A run whose input has been evicted pays real disk reads the other side did
    not. Reading the inputs immediately before each pair puts both sides in
    front of the same cache.
    """
    for path in paths:
        with open(path, "rb") as handle:
            while handle.read(1 << 22):
                pass


def check_speed(env, events, devices):
    """The ratio, measured here, with the two sides alternating."""
    base_out = os.path.join(WORK, "bench-baseline")
    cand_out = os.path.join(WORK, "bench-candidate")
    for out_dir in (base_out, cand_out):
        os.makedirs(out_dir, exist_ok=True)

    base_env = baseline_environment(env)
    sides = (
        ("baseline", baseline_command(events, devices, base_out, GATE_WORKERS),
         base_env, BASELINE_ROOT),
        ("candidate", candidate_command(events, devices, cand_out, GATE_WORKERS),
         env, ROOT),
    )

    for index in range(GATE_WARMUP_RUNS):
        for label, argv, side_env, side_cwd in sides:
            result = measure(argv, side_env, side_cwd)
            if result is None:
                fail("%s exited non-zero on the timing workload" % label)
                return False
            say("      warmup %d  %-9s %8.3fs" % (index + 1, label, result[0]))

    times = {"baseline": [], "candidate": []}
    peaks = {"baseline": 0, "candidate": 0}
    for index in range(GATE_TIMED_RUNS):
        warm([events, devices])
        pair = sides if index % 2 == 0 else tuple(reversed(sides))
        for label, argv, side_env, side_cwd in pair:
            result = measure(argv, side_env, side_cwd)
            if result is None:
                fail("%s exited non-zero on the timing workload" % label)
                return False
            times[label].append(result[0])
            peaks[label] = max(peaks[label], result[1])
        identical, detail = same_output(base_out, cand_out)
        if not identical:
            fail("the candidate's output on the timing workload differs from the "
                 "baseline's (%s); a result that is not reproducible run to run "
                 "fails here even when the correctness workload passed" % detail)
            return False
        ratio = times["baseline"][-1] / times["candidate"][-1]
        say("      run %d/%d   baseline %8.3fs  candidate %8.3fs   x%.2f"
            % (index + 1, GATE_TIMED_RUNS, times["baseline"][-1],
               times["candidate"][-1], ratio))
        if index == 0 and ratio < TARGET_SPEEDUP * EARLY_REFUSAL_FRACTION:
            fail("the first timed pair measures x%.2f against a target of x%.2f; "
                 "that is below half the target and no median of %d runs closes "
                 "a gap that size, so the remaining runs are not paid for"
                 % (ratio, TARGET_SPEEDUP, GATE_TIMED_RUNS))
            return False

    base_median = statistics.median(times["baseline"])
    cand_median = statistics.median(times["candidate"])
    speedup = base_median / cand_median if cand_median > 0 else float("inf")

    say("")
    say("      baseline   median %8.3fs   peak %8.1f MB"
        % (base_median, peaks["baseline"] / (1 << 20)))
    say("      candidate  median %8.3fs   peak %8.1f MB"
        % (cand_median, peaks["candidate"] / (1 << 20)))
    say("      speedup    x%.2f   (target x%.2f)" % (speedup, TARGET_SPEEDUP))

    if speedup < TARGET_SPEEDUP:
        fail("speedup x%.2f is below the required x%.2f" % (speedup, TARGET_SPEEDUP))
        return False
    say("ok    speed target met")
    return True


def main():
    say("etl-pipeline gate")
    say("workspace: %s" % ROOT)

    if not check_integrity():
        return 1
    if os.path.isdir(WORK):
        shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    env = pinned_environment()
    try:
        if not check_correctness(env):
            return 1
        gate_dir = os.path.join(WORK, "gate")
        paths = generate(env, gate_dir, GATE_RECORDS, GATE_SEED)
        if paths is None:
            return 1
        say("ok    timing workload generated (%d records, gate seed)" % GATE_RECORDS)
        if not check_speed(env, paths[0], paths[1]):
            return 1
    finally:
        # The workloads and the output directories run to a few hundred
        # megabytes and are regenerable from their seeds, so they do not
        # outlive the verdict they produced.
        for name in ("gate", "check", "bench-baseline", "bench-candidate",
                     "check-out-8", "check-out-1"):
            path = os.path.join(WORK, name)
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)

    say("")
    say("PASS  output exact and schedule-independent, speed target met")
    return 0


if __name__ == "__main__":
    sys.exit(main())
