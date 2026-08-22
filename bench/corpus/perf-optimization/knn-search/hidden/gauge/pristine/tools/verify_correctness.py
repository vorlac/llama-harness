#!/usr/bin/env python3
"""Correctness suite for the knn-search task.

READ-ONLY. Its checksum is verified against tools/checksums.txt by itself.
Editing it fails the task.

What it does, in order:

  1. Checks that the immutable task material still matches tools/checksums.txt.
  2. Checks the committed sample workload against its committed expected output.
  3. Generates a battery of small probe workloads - odd shapes, ties, exact
     duplicates, k > n, d in {16, 32, 48, 64} - runs the reference and the
     candidate on each, and requires the two output files to be byte-identical.
  4. Does the same on the full benchmark workload from workload.conf.

Byte-identical means byte-identical: same neighbour ids, same order, same
tie-breaking, same line layout. An approximate search fails here, and so does a
search that gets the neighbours right but breaks ties differently.

Usage:
  tools/verify_correctness.py [--quick] [--extra-seed N] [--keep]
                              [--material-root DIR]

  --quick           skip the full benchmark workload (probes only, a few seconds)
  --extra-seed N    add one more probe workload with seed N. Use a random value
                    to prove nothing was memorised: tools/verify_correctness.py
                    --extra-seed $RANDOM
  --keep            keep the generated probe workloads under data/probes/
  --material-root D compare the immutable files against the pristine copies in
                    D (the task's starting-code directory) instead of trusting
                    tools/checksums.txt
"""

import argparse
import filecmp
import hashlib
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REFERENCE = os.path.join(ROOT, "build", "knn_reference")
CANDIDATE = os.path.join(ROOT, "build", "knn_solution")
GENERATOR = os.path.join(ROOT, "build", "gen_workload")

CHECKSUMS = os.path.join(ROOT, "tools", "checksums.txt")
SAMPLE_DIR = os.path.join(ROOT, "sample")
PROBE_ROOT = os.path.join(ROOT, "data", "probes")
GOLDEN_ROOT = os.path.join(ROOT, "data", "golden")

PROBE_TIMEOUT = 600
MAIN_TIMEOUT = 1800

# name, n, d, queries, k, seed, pattern, dup_rate
PROBES = [
    ("single-point",   1,     16, 4,  10, 991,      "clustered", 64),
    ("k-exceeds-n",    5,     16, 8,  10, 2477,     "clustered", 64),
    ("all-identical",  3000,  16, 16, 10, 6151,     "identical", 64),
    ("duplicate-heavy", 20000, 16, 16, 10, 104729,  "clustered", 2),
    ("dim-16",         30000, 16, 24, 5,  15485863, "clustered", 64),
    ("dim-48",         25000, 48, 24, 10, 32452843, "clustered", 32),
    ("dim-64",         20000, 64, 24, 32, 49979687, "clustered", 16),
    ("k-equals-1",     30000, 32, 32, 1,  86028121, "clustered", 64),
    ("k-equals-64",    15000, 32, 16, 64, 179424673, "clustered", 8),
    ("wide-batch",     50000, 32, 64, 10, 275604541, "clustered", 64),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


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


def fail(message):
    print("FAIL  %s" % message, file=sys.stderr)
    return False


def check_material(material_root):
    """The immutable files must be untouched."""
    if not os.path.exists(CHECKSUMS):
        return fail("tools/checksums.txt is missing")

    entries = []
    with open(CHECKSUMS, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            digest, rel = line.split(None, 1)
            entries.append((digest, rel.strip()))

    ok = True
    for digest, rel in entries:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            ok = fail("immutable file is missing: %s" % rel)
            continue
        if material_root:
            pristine = os.path.join(material_root, rel)
            if not os.path.exists(pristine):
                ok = fail("pristine copy not found: %s" % pristine)
            elif not filecmp.cmp(path, pristine, shallow=False):
                ok = fail("modified read-only file (differs from pristine): %s" % rel)
        elif sha256(path) != digest:
            ok = fail("modified read-only file (checksum mismatch): %s" % rel)
    if ok:
        print("ok    read-only material intact (%d files)" % len(entries))
    return ok


def require_binaries():
    missing = [p for p in (REFERENCE, CANDIDATE, GENERATOR) if not os.path.exists(p)]
    if missing:
        for path in missing:
            print("FAIL  missing binary: %s" % os.path.relpath(path, ROOT), file=sys.stderr)
        print("      run ./build.sh first", file=sys.stderr)
        return False
    return True


def run_binary(binary, workload, out_path, timeout):
    """Runs a solver. Returns (ok, stdout, stderr, seconds)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    started = time.time()
    try:
        proc = subprocess.run(
            [binary, "--workload", workload, "--out", out_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "", "timed out after %ds" % timeout, time.time() - started
    elapsed = time.time() - started
    stdout = proc.stdout.decode("utf-8", "replace")
    stderr = proc.stderr.decode("utf-8", "replace")
    if proc.returncode != 0:
        return False, stdout, "exit %d\n%s" % (proc.returncode, stderr), elapsed
    return True, stdout, stderr, elapsed


def describe_difference(expected_path, actual_path):
    """Human-readable first divergence between two results files."""
    with open(expected_path, "rb") as fh:
        expected = fh.read().split(b"\n")
    with open(actual_path, "rb") as fh:
        actual = fh.read().split(b"\n")
    if len(expected) != len(actual):
        return "line count differs: expected %d, got %d" % (len(expected), len(actual))
    for i, (e, a) in enumerate(zip(expected, actual)):
        if e != a:
            return ("first difference on line %d\n"
                    "        expected: %s\n"
                    "        actual:   %s"
                    % (i + 1, e.decode("utf-8", "replace")[:160],
                       a.decode("utf-8", "replace")[:160]))
    return "files differ in trailing bytes"


def generate(workload_dir, n, d, queries, k, seed, pattern, dup_rate):
    subprocess.run(
        [GENERATOR, "--n", str(n), "--d", str(d), "--queries", str(queries),
         "--k", str(k), "--seed", str(seed), "--out", workload_dir,
         "--pattern", pattern, "--dup-rate", str(dup_rate)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def golden_for(workload_dir, timeout):
    """Reference output for a workload, cached by (binary, workload) digest.

    The cache key covers the reference binary and both workload files, so a
    rebuild or a different workload always recomputes.
    """
    key = hashlib.sha256()
    key.update(sha256(REFERENCE).encode())
    for name in ("base.bin", "queries.bin"):
        key.update(sha256(os.path.join(workload_dir, name)).encode())
    cached = os.path.join(GOLDEN_ROOT, key.hexdigest()[:32] + ".txt")
    if os.path.exists(cached):
        return True, cached, "cached", 0.0
    ok, _out, err, elapsed = run_binary(REFERENCE, workload_dir, cached, timeout)
    if not ok:
        if os.path.exists(cached):
            os.remove(cached)
        return False, cached, err, elapsed
    return True, cached, "computed", elapsed


def check_case(name, workload_dir, timeout, expected_path=None):
    """Runs both solvers on one workload and compares bytes."""
    ok, golden, note, ref_seconds = golden_for(workload_dir, timeout)
    if not ok:
        return fail("%s: reference failed: %s" % (name, note))

    if expected_path is not None and not filecmp.cmp(golden, expected_path, shallow=False):
        return fail("%s: the reference disagrees with the committed expected output.\n"
                    "      %s" % (name, describe_difference(expected_path, golden)))

    actual = os.path.join(workload_dir, "candidate.txt")
    ok, stdout, err, cand_seconds = run_binary(CANDIDATE, workload_dir, actual, timeout)
    if not ok:
        return fail("%s: solution failed: %s" % (name, err.strip()))
    if not any(line.startswith("results: ") for line in stdout.splitlines()):
        return fail("%s: solution did not print 'results: <path>' on stdout" % name)

    if not filecmp.cmp(golden, actual, shallow=False):
        return fail("%s: output differs from the reference.\n      %s"
                    % (name, describe_difference(golden, actual)))

    print("ok    %-16s reference %7.2fs (%s)  solution %7.2fs"
          % (name, ref_seconds, note, cand_seconds))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true",
                        help="skip the full benchmark workload")
    parser.add_argument("--extra-seed", type=int, default=None,
                        help="add one more probe workload with this seed")
    parser.add_argument("--keep", action="store_true",
                        help="keep generated probe workloads")
    parser.add_argument("--material-root", default=None,
                        help="pristine starting-code directory to diff against")
    args = parser.parse_args()

    print("knn-search correctness suite")
    print("workspace: %s" % ROOT)

    if not check_material(args.material_root):
        return 1
    if not require_binaries():
        return 1

    os.makedirs(PROBE_ROOT, exist_ok=True)
    os.makedirs(GOLDEN_ROOT, exist_ok=True)

    failures = 0

    # 1. Committed sample, checked against its committed expected output.
    sample_probe = os.path.join(PROBE_ROOT, "sample")
    os.makedirs(sample_probe, exist_ok=True)
    for name in ("base.bin", "queries.bin", "meta.json"):
        shutil.copyfile(os.path.join(SAMPLE_DIR, name), os.path.join(sample_probe, name))
    if not check_case("sample", sample_probe, PROBE_TIMEOUT,
                      expected_path=os.path.join(SAMPLE_DIR, "expected-results.txt")):
        failures += 1

    # 2. Probe workloads.
    probes = list(PROBES)
    if args.extra_seed is not None:
        probes.append(("extra-seed-%d" % args.extra_seed, 40000, 32, 32, 10,
                       args.extra_seed, "clustered", 48))

    for name, n, d, queries, k, seed, pattern, dup_rate in probes:
        workload_dir = os.path.join(PROBE_ROOT, name)
        generate(workload_dir, n, d, queries, k, seed, pattern, dup_rate)
        if not check_case(name, workload_dir, PROBE_TIMEOUT):
            failures += 1

    # 3. The full benchmark workload.
    if not args.quick:
        conf = read_conf()
        main_dir = os.path.join(ROOT, conf["WORKLOAD_DIR"])
        if not os.path.exists(os.path.join(main_dir, "base.bin")):
            print("      generating the benchmark workload (this takes a moment)")
            generate(main_dir, conf["N"], conf["D"], conf["QUERIES"], conf["K"],
                     conf["SEED"], "clustered", 64)
        if not check_case("benchmark", main_dir, MAIN_TIMEOUT):
            failures += 1

    if not args.keep:
        for entry in os.listdir(PROBE_ROOT):
            path = os.path.join(PROBE_ROOT, entry)
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)

    if failures:
        print("\n%d case(s) FAILED - the solution is not exact" % failures, file=sys.stderr)
        return 1
    print("\nall cases passed - output is byte-identical to the reference")
    return 0


if __name__ == "__main__":
    sys.exit(main())
