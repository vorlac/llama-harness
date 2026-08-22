#!/usr/bin/env python3
"""The graded gate for the log-aggregation task.

It is materialized into the work tree only after the model's process has
exited, so nothing it contains can be read, run or targeted while the task is
being worked on.

The verdict is the exit status and it has three parts, decided in this order:

  1. integrity - FORMAT.md, the reference, the generator, the correctness suite,
     the benchmark and the committed sample still hold the bytes
     gauge/pristine holds. The reference is both the definition of correctness
     and the performance baseline, so a workspace that edited it has answered a
     different question;
  2. correctness - byte-identical reports against the reference on ten
     hand-written fixtures, the committed sample, a renamed copy of it, and six
     generated workloads whose seeds are drawn at run time. This is decided
     before a single timing run, so a fast wrong answer fails as a wrong answer;
  3. speed - the ratio between the reference's median wall clock and the
     candidate's, both measured here, alternating, on this machine, in this
     process, over a workload generated for this run.

Why a ratio. An absolute second count is a property of the machine that
measured it, so a gate built on one is a gate that passes or fails on hardware
rather than on the work. The reference is re-timed beside the candidate every
time the gate runs, and the threshold is the factor between them.

Why THIS ratio. 6.0 is the task's own declared target, in its registry entry and
in its prompt, and it sits at the top of a published band ladder that runs
< 2.0x, 2.0-2.9x, 3.0-4.4x, 4.5-5.9x, >= 6.0x. The reference is naive in four
independent ways at once and each output section re-reads and re-parses the
whole file, so merging the passes is worth well under 2x on its own: 6.0 is
above what tidying reaches and below what the available structural wins reach
together.

Why one interpreter. Both sides run under THIS interpreter: LOGAGG_PYTHON is
exported, and a `python3` shim resolving to it is put at the head of PATH, so a
candidate that ignores the variable still cannot win by finding a faster
CPython on the box. Picking a newer interpreter than the reference got is not
an optimisation of the program.

Flakiness. Each side runs one discarded warmup and GATE_TIMED_RUNS timed runs,
and the reported figure is the MEDIAN, which one scheduling hiccup cannot move.
The pairs alternate which side goes first, so an even number of timed runs
gives each side the same number of first and second slots and any advantage in
a slot cancels. The workload is read through the page cache before each pair
for the same reason: this reference peaks over a gigabyte resident, which is
enough to evict a 275 MiB input and charge the next run for disk the other side
did not pay for. A run whose first timed pair is already below half the target
is refused there rather than paying six more minutes to reach the same
verdict.

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

PYTHON = sys.executable or "python3"

# The task's declared target, in perf-optimization/tasks/log-aggregation/task.json
# as `speedup_target` and in the prompt as "Required minimum speedup".
TARGET_SPEEDUP = 6.0

# The canonical workload SHAPE, with a seed that appears nowhere the workspace
# can read. Same lines, same time window, so the published baseline and the
# target transfer unchanged; a different seed, so an answer precomputed for the
# workload the model iterated against buys nothing.
GATE_LINES = 1500000
GATE_MINUTES = 240
GATE_SEED = 918273645

GATE_WARMUP_RUNS = 1
# Even, so each side leads the same number of pairs.
GATE_TIMED_RUNS = 4

# A first timed pair below this fraction of the target is refused immediately.
# The band is a factor of two, which is far outside the measured noise.
EARLY_REFUSAL_FRACTION = 0.5

CANDIDATE = ["bash", "run.sh"]


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
    """Refuse a workspace that edited the oracle, the harness or the sample."""
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

    LOGAGG_PYTHON is the contract the task states. The shim directory is the
    part a candidate cannot decline: `python3` and `python` on PATH both
    resolve to the interpreter running this gate, so a hardcoded `python3`
    measures the same CPython the reference is measured under.
    """
    bindir = os.path.join(WORK, "bin")
    os.makedirs(bindir, exist_ok=True)
    for name in ("python3", "python"):
        shim = os.path.join(bindir, name)
        with open(shim, "w", encoding="utf-8") as handle:
            handle.write('#!/bin/sh\nexec "%s" "$@"\n' % PYTHON)
        os.chmod(shim, 0o755)
    env = dict(os.environ)
    env["LOGAGG_PYTHON"] = PYTHON
    env["PATH"] = bindir + os.pathsep + env.get("PATH", "")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    say("ok    both sides pinned to %s" % PYTHON)
    return env


def check_correctness(env, salt):
    """Byte-equality against the reference, decided before anything is timed."""
    argv = [PYTHON, os.path.join("tools", "check_correctness.py"),
            "--candidate", " ".join(CANDIDATE), "--salt", str(salt)]
    completed = subprocess.run(argv, cwd=ROOT, env=env)
    if completed.returncode != 0:
        fail("the candidate's report is not byte-identical to the reference")
        return False
    say("ok    every correctness case byte-identical (salt %d)" % salt)
    return True


def generate_gate_workload(env):
    workload = os.path.join(WORK, "access.log")
    argv = [PYTHON, os.path.join("tools", "generate_workload.py"),
            "--lines", str(GATE_LINES), "--seed", str(GATE_SEED),
            "--minutes", str(GATE_MINUTES), "--out", workload, "--quiet"]
    completed = subprocess.run(argv, cwd=ROOT, env=env)
    if completed.returncode != 0:
        fail("the gate could not generate its timing workload")
        return None
    say("ok    timing workload generated (%d lines, %d minutes, gate seed)"
        % (GATE_LINES, GATE_MINUTES))
    return workload


def rss_bytes(raw):
    """ru_maxrss is bytes on macOS and BSD, kibibytes on Linux."""
    if sys.platform == "darwin":
        return int(raw)
    return int(raw) * 1024


def measure(argv, env):
    """Wall clock and peak RSS of one child, or None if it did not exit 0.

    os.wait4 reports the resource usage of THAT child. getrusage on the
    children bucket would report the maximum over every child reaped so far,
    which is the reference's footprint attributed to the candidate.
    """
    out = tempfile.TemporaryFile()
    err = tempfile.TemporaryFile()
    started = time.perf_counter()
    proc = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=out, stderr=err)
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


def same_bytes(left, right):
    if not os.path.exists(left) or not os.path.exists(right):
        return False
    if os.path.getsize(left) != os.path.getsize(right):
        return False
    with open(left, "rb") as a, open(right, "rb") as b:
        while True:
            chunk_a = a.read(1 << 20)
            chunk_b = b.read(1 << 20)
            if chunk_a != chunk_b:
                return False
            if not chunk_a:
                return True


def warm(paths):
    """Pull the timing inputs through the page cache before each pair.

    A run whose input has been evicted pays real disk reads the other side did
    not, and the reference's resident set is over a gigabyte on this workload -
    large enough to evict it. Reading the inputs immediately before each pair
    puts both sides in front of the same cache.
    """
    for path in paths:
        with open(path, "rb") as handle:
            while handle.read(1 << 22):
                pass


def check_speed(env, workload):
    """The ratio, measured here, with both sides alternating."""
    ref_out = os.path.join(WORK, "reference-report.json")
    cand_out = os.path.join(WORK, "candidate-report.json")
    reference_cmd = [PYTHON, os.path.join(PRISTINE, "reference", "aggregate.py"),
                     workload, ref_out]
    candidate_cmd = CANDIDATE + [workload, cand_out]

    for index in range(GATE_WARMUP_RUNS):
        for label, argv in (("reference", reference_cmd), ("candidate", candidate_cmd)):
            result = measure(argv, env)
            if result is None:
                fail("%s exited non-zero on the timing workload" % label)
                return False
            say("      warmup %d  %-9s %8.3fs" % (index + 1, label, result[0]))

    sides = (("reference", reference_cmd), ("candidate", candidate_cmd))
    ref_times = []
    cand_times = []
    ref_peak = 0
    cand_peak = 0
    for index in range(GATE_TIMED_RUNS):
        warm([workload])
        pair = sides if index % 2 == 0 else tuple(reversed(sides))
        timings = {}
        for label, argv in pair:
            result = measure(argv, env)
            if result is None:
                fail("%s exited non-zero on the timing workload" % label)
                return False
            timings[label] = result
        ref = timings["reference"]
        cand = timings["candidate"]
        ref_times.append(ref[0])
        cand_times.append(cand[0])
        ref_peak = max(ref_peak, ref[1])
        cand_peak = max(cand_peak, cand[1])
        if not same_bytes(ref_out, cand_out):
            fail("the candidate's report on the timing workload differs from the "
                 "reference; a result that is not reproducible run to run fails "
                 "here even when the correctness suite passed")
            return False
        ratio = ref[0] / cand[0] if cand[0] > 0 else float("inf")
        say("      run %d/%d   reference %8.3fs  candidate %8.3fs   x%.2f"
            % (index + 1, GATE_TIMED_RUNS, ref[0], cand[0], ratio))
        if index == 0 and ratio < TARGET_SPEEDUP * EARLY_REFUSAL_FRACTION:
            fail("the first timed pair measures x%.2f against a target of x%.2f; "
                 "that is below half the target and no median of %d runs closes "
                 "a gap that size, so the remaining runs are not paid for"
                 % (ratio, TARGET_SPEEDUP, GATE_TIMED_RUNS))
            return False

    ref_median = statistics.median(ref_times)
    cand_median = statistics.median(cand_times)
    speedup = ref_median / cand_median if cand_median > 0 else float("inf")

    say("")
    say("      reference  median %8.3fs   peak %7.1f MB" % (ref_median, ref_peak / (1 << 20)))
    say("      candidate  median %8.3fs   peak %7.1f MB" % (cand_median, cand_peak / (1 << 20)))
    say("      speedup    x%.2f   (target x%.2f)" % (speedup, TARGET_SPEEDUP))

    if speedup < TARGET_SPEEDUP:
        fail("speedup x%.2f is below the required x%.2f" % (speedup, TARGET_SPEEDUP))
        return False
    say("ok    speed target met")
    return True


def main():
    say("log-aggregation gate")
    say("workspace: %s" % ROOT)

    if not check_integrity():
        return 1
    if os.path.isdir(WORK):
        shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    env = pinned_environment()
    try:
        if not check_correctness(env, random.randrange(1, 1 << 20)):
            return 1
        workload = generate_gate_workload(env)
        if workload is None:
            return 1
        if not check_speed(env, workload):
            return 1
    finally:
        # The timing workload is a quarter of a gigabyte and is regenerable
        # from its seed, so it does not outlive the verdict it produced.
        for name in ("access.log", "reference-report.json", "candidate-report.json"):
            path = os.path.join(WORK, name)
            if os.path.exists(path):
                os.remove(path)

    say("")
    say("PASS  every report byte-identical, speed target met")
    return 0


if __name__ == "__main__":
    sys.exit(main())
