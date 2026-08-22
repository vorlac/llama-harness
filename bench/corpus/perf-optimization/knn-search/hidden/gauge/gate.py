#!/usr/bin/env python3
"""The graded gate for the knn-search task.

It is materialized into the work tree only after the model's process has
exited, so nothing it contains can be read, run or targeted while the task is
being worked on.

The verdict is the exit status and it has three parts, decided in this order:

  1. integrity - every read-only file still holds the bytes gauge/pristine
     holds. The reference algorithm is the definition of correctness AND the
     performance baseline, so a workspace that edited it has answered a
     different question;
  2. correctness - byte-identical output against the reference on the committed
     sample, the ten probe workloads and one probe workload whose seed is drawn
     at run time. This is decided before a single timing run, so a fast wrong
     answer fails as a wrong answer;
  3. speed - the ratio between the reference's median wall clock and the
     solution's, both measured here, interleaved, on this machine, in this
     process, over a workload generated for this run.

Why a ratio. An absolute second count is a property of the machine that
measured it, so a gate built on one is a gate that passes or fails on hardware
rather than on the work. The reference is re-timed beside the candidate every
time the gate runs, and the threshold is the factor between them.

Why THIS ratio. TARGET_SPEEDUP in workload.conf is 40, and the number is
calibrated rather than chosen: on the machine this task was authored against, a
straightforward exact single-threaded rewrite - flat arrays, precomputed norms,
the dot-product identity, no square root, a k-sized heap instead of the full
sort - measures about 22x and does not clear the gate, while the same rewrite
across two threads measures about 42x and does. So 40 sits between "fixed the
obvious four things" and "did the work", which is the discrimination the task
exists to make.

Flakiness. Each side runs one discarded warmup and GATE_TIMED_RUNS timed runs,
and the reported figure is the MEDIAN, which one scheduling hiccup cannot move.
The two sides alternate inside each pair and the pairs alternate which side
goes first, so an even number of timed runs gives each side the same number of
first and second slots and any advantage in a slot cancels. The workload is
read through the page cache before each pair for the same reason. Four timed
runs is enough here because the required margin is 40x and the measured
run-to-run spread of the reference on the authoring machine is under 10%: no
plausible noise turns a 22x into a 40x or a 42x into a 39x. A run whose first
timed pair is already below half the target is refused there rather than paying
four more minutes to reach the same verdict.

The reference and the generator are compiled HERE, from the pristine sources,
with the fixed flags - never by the workspace's build.sh, whose REFERENCE_FLAGS
line is not checksummed and would otherwise let a slow baseline be arranged.

    python3 gauge/gate.py
"""

import base64
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

# The corpus's fixed baseline build, mirrored here so the gate never reads it
# out of a file the workspace may edit.
REFERENCE_FLAGS = ["-O2", "-std=c++17", "-DNDEBUG"]

# The timing workload has the canonical shape from workload.conf and a seed
# that appears nowhere the workspace can read, so a precomputed answer for the
# workload the model iterated against buys nothing.
GATE_SEED = 1327042781

GATE_WARMUP_RUNS = 1
# Even, so each side leads the same number of pairs.
GATE_TIMED_RUNS = 4

# A first timed pair below this fraction of the target is refused immediately.
# The band is a factor of two, which is far outside the measured noise.
EARLY_REFUSAL_FRACTION = 0.5

# The read-only targets that reach the workspace as base64 text.
CARRIERS = {
    os.path.join("sample", "base.bin"): os.path.join("sample", "base.bin.b64"),
    os.path.join("sample", "queries.bin"): os.path.join("sample", "queries.bin.b64"),
}


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
    """Refuse a workspace that edited the oracle, the harness or the data."""
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


def unpack_sample():
    """Write the binary sample straight from the pristine carriers."""
    for target, carrier in sorted(CARRIERS.items()):
        with open(os.path.join(PRISTINE, carrier), encoding="ascii") as handle:
            raw = base64.b64decode(handle.read())
        path = os.path.join(ROOT, target)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(raw)
    say("ok    committed sample decoded from the pristine carriers")


def purge_caches():
    """Drop everything the workspace may have cached about the reference.

    data/golden holds reference OUTPUT keyed by binary and workload, and
    data/bench-cache.json holds reference TIMINGS. Both survive the model's
    session into the tree this gate inherits: a hand-written golden would
    launder a wrong answer for a workload with no committed expected file, and
    a timing measured while the machine was busy would inflate the ratio.
    """
    for rel in ("data/golden", "data/probes", "data/bench-cache.json"):
        path = os.path.join(ROOT, rel.replace("/", os.sep))
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.exists(path):
            os.remove(path)
    say("ok    reference output and timing caches purged")


def read_conf():
    conf = {}
    with open(os.path.join(PRISTINE, "workload.conf"), encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            conf[key.strip()] = value.strip()
    return conf


def build_candidate():
    """The workspace's own build, with the workspace's own flags."""
    completed = subprocess.run(["bash", "build.sh"], cwd=ROOT)
    if completed.returncode != 0:
        fail("build.sh exited %d; the solution does not build" % completed.returncode)
        return False
    if not os.path.isfile(os.path.join(ROOT, "build", "knn_solution")):
        fail("build.sh left no build/knn_solution")
        return False
    say("ok    solution built by the workspace's build.sh")
    return True


def build_baseline():
    """The reference and the generator, from pristine sources, fixed flags."""
    cxx = os.environ.get("CXX") or "c++"
    build_dir = os.path.join(ROOT, "build")
    os.makedirs(build_dir, exist_ok=True)
    jobs = (
        (["-I", os.path.join(PRISTINE, "src")],
         os.path.join(PRISTINE, "src", "knn_reference.cpp"),
         os.path.join(build_dir, "knn_reference")),
        ([], os.path.join(PRISTINE, "tools", "gen_workload.cpp"),
         os.path.join(build_dir, "gen_workload")),
    )
    for includes, source, output in jobs:
        argv = [cxx] + REFERENCE_FLAGS + includes + ["-o", output, source]
        completed = subprocess.run(argv, cwd=ROOT)
        if completed.returncode != 0:
            fail("the gate could not build %s" % os.path.basename(output))
            return False
    say("ok    reference and generator rebuilt from pristine sources (%s)"
        % " ".join(REFERENCE_FLAGS))
    return True


def check_correctness(extra_seed):
    """Exact-output probes, decided before anything is timed."""
    argv = [PYTHON, os.path.join("tools", "verify_correctness.py"),
            "--quick", "--extra-seed", str(extra_seed)]
    completed = subprocess.run(argv, cwd=ROOT)
    if completed.returncode != 0:
        fail("the solution's output is not byte-identical to the reference")
        return False
    say("ok    exact-output probes passed (extra seed %d)" % extra_seed)
    return True


def generate_gate_workload(conf):
    if os.path.isdir(WORK):
        shutil.rmtree(WORK, ignore_errors=True)
    workload = os.path.join(WORK, "workload")
    os.makedirs(workload)
    argv = [os.path.join(ROOT, "build", "gen_workload"),
            "--n", conf["N"], "--d", conf["D"], "--queries", conf["QUERIES"],
            "--k", conf["K"], "--seed", str(GATE_SEED), "--out", workload]
    completed = subprocess.run(argv, cwd=ROOT, stdout=subprocess.DEVNULL)
    if completed.returncode != 0:
        fail("the gate could not generate its timing workload")
        return None
    say("ok    timing workload generated (n=%s d=%s queries=%s k=%s, gate seed)"
        % (conf["N"], conf["D"], conf["QUERIES"], conf["K"]))
    return workload


def rss_bytes(raw):
    """ru_maxrss is bytes on macOS and BSD, kibibytes on Linux."""
    if sys.platform == "darwin":
        return int(raw)
    return int(raw) * 1024


def measure(argv):
    """Wall clock and peak RSS of one child, or None if it did not exit 0.

    os.wait4 reports the resource usage of THAT child. getrusage on the
    children bucket would report the maximum over every child reaped so far,
    which is the reference's footprint attributed to the candidate.
    """
    out = tempfile.TemporaryFile()
    err = tempfile.TemporaryFile()
    started = time.perf_counter()
    proc = subprocess.Popen(argv, cwd=ROOT, stdout=out, stderr=err)
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
    not, and the reference's resident set is large enough to evict it. Reading
    the inputs immediately before each pair puts both sides in front of the
    same cache.
    """
    for path in paths:
        with open(path, "rb") as handle:
            while handle.read(1 << 22):
                pass


def check_speed(conf, workload):
    """The ratio, measured here, with both sides alternating."""
    target = float(conf["TARGET_SPEEDUP"])
    max_rss = float(conf["MAX_PEAK_RSS_MB"]) * (1 << 20)
    reference = os.path.join(ROOT, "build", "knn_reference")
    candidate = os.path.join(ROOT, "build", "knn_solution")
    ref_out = os.path.join(WORK, "reference-results.txt")
    cand_out = os.path.join(WORK, "solution-results.txt")

    sides = (("reference", reference, ref_out), ("solution", candidate, cand_out))

    for index in range(GATE_WARMUP_RUNS):
        for label, binary, out_path in sides:
            result = measure([binary, "--workload", workload, "--out", out_path, "--quiet"])
            if result is None:
                fail("%s exited non-zero on the timing workload" % label)
                return False
            say("      warmup %d  %-9s %8.3fs" % (index + 1, label, result[0]))

    inputs = [os.path.join(workload, "base.bin"), os.path.join(workload, "queries.bin")]
    ref_times = []
    cand_times = []
    ref_peak = 0
    cand_peak = 0
    for index in range(GATE_TIMED_RUNS):
        warm(inputs)
        pair = sides if index % 2 == 0 else tuple(reversed(sides))
        timings = {}
        for label, binary, out_path in pair:
            result = measure([binary, "--workload", workload, "--out", out_path, "--quiet"])
            if result is None:
                fail("%s exited non-zero on the timing workload" % label)
                return False
            timings[label] = result
        ref = timings["reference"]
        cand = timings["solution"]
        ref_times.append(ref[0])
        cand_times.append(cand[0])
        ref_peak = max(ref_peak, ref[1])
        cand_peak = max(cand_peak, cand[1])
        if not same_bytes(ref_out, cand_out):
            fail("the solution's output on the timing workload differs from the "
                 "reference; a result that is not reproducible run to run fails "
                 "here even when the probe suite passed")
            return False
        ratio = ref[0] / cand[0] if cand[0] > 0 else float("inf")
        say("      run %d/%d   reference %8.3fs  solution %8.3fs   x%.2f"
            % (index + 1, GATE_TIMED_RUNS, ref[0], cand[0], ratio))
        if index == 0 and ratio < target * EARLY_REFUSAL_FRACTION:
            fail("the first timed pair measures x%.2f against a target of x%.2f; "
                 "that is below half the target and no median of %d runs closes "
                 "a gap that size, so the remaining runs are not paid for"
                 % (ratio, target, GATE_TIMED_RUNS))
            return False

    ref_median = statistics.median(ref_times)
    cand_median = statistics.median(cand_times)
    speedup = ref_median / cand_median if cand_median > 0 else float("inf")

    say("")
    say("      reference  median %8.3fs   peak %7.1f MB" % (ref_median, ref_peak / (1 << 20)))
    say("      solution   median %8.3fs   peak %7.1f MB" % (cand_median, cand_peak / (1 << 20)))
    say("      speedup    x%.2f   (target x%.2f)" % (speedup, target))

    ok = True
    if cand_peak > max_rss:
        fail("peak RSS %.1f MB is over the %.1f MB ceiling"
             % (cand_peak / (1 << 20), max_rss / (1 << 20)))
        ok = False
    if speedup < target:
        fail("speedup x%.2f is below the required x%.2f" % (speedup, target))
        ok = False
    if ok:
        say("ok    speed target met")
    return ok


def main():
    say("knn-search gate")
    say("workspace: %s" % ROOT)

    if not check_integrity():
        return 1
    purge_caches()
    unpack_sample()
    if not build_candidate():
        return 1
    if not build_baseline():
        return 1
    if not check_correctness(random.randrange(1, 2 ** 31 - 1)):
        return 1

    conf = read_conf()
    workload = generate_gate_workload(conf)
    if workload is None:
        return 1
    if not check_speed(conf, workload):
        return 1

    say("")
    say("PASS  correctness exact, speed target met")
    return 0


if __name__ == "__main__":
    sys.exit(main())
