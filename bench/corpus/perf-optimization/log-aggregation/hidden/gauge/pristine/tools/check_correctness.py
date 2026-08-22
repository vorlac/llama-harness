#!/usr/bin/env python3
"""Correctness suite for the log-aggregation task.

Runs the reference aggregator and the candidate over the same inputs and
requires the two output files to be **byte for byte identical**. Nothing softer
is accepted: not "close enough", not "percentiles within 1%", not "same modulo
key order". Byte equality is the only check that makes an approximate
implementation impossible to pass off as an exact one.

The inputs are:

  * a set of hand-written fixtures that stress validity rules, endpoint
    normalisation, tie-breaking, percentile rank rounding, session ordering,
    and JSON shapes the workload generator never emits (see FORMAT.md s.3);
  * the committed sample log, and a copy of it under a different filename,
    which changes `meta.input` and so catches a hardcoded report;
  * several small generated workloads with different seeds, sizes and time
    windows.

Usage
-----
    python3 tools/check_correctness.py
    python3 tools/check_correctness.py --candidate ./run.sh
    python3 tools/check_correctness.py --salt 8123        # fresh seeds
    python3 tools/check_correctness.py --include-workload data/access.log

Exit status is 0 only if every case matched.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "reference" / "aggregate.py"
GENERATOR = ROOT / "tools" / "generate_workload.py"
SAMPLE = ROOT / "sample" / "sample.log"

VALID = ('{"ts":"%(ts)s","endpoint":"%(ep)s","method":"GET","status":%(st)d,'
         '"dur_ms":%(dur)d,"bytes":%(by)d,"session":"%(sess)s",'
         '"user":"%(user)s","region":"us-east-1"}')


def valid(ts, ep="/api/v2/orders", st=200, dur=10, by=100,
          sess="sess-000000000001", user="u-000001"):
    return VALID % {"ts": ts, "ep": ep, "st": st, "dur": dur, "by": by,
                    "sess": sess, "user": user}


# ------------------------------------------------------------------ fixtures

def fixture_empty():
    return ""


def fixture_only_malformed():
    return "\n".join([
        "",
        "not json at all",
        '{"ts":"2026-03-14T08:00:00.000Z"}',
        '["ts","endpoint"]',
        '{"ts":"2026-03-14T08:00:00.000Z","endpoint":"/a","method":"GET",'
        '"status":200,"dur_ms":1,"bytes":1,"session":"s","user":"u",'
        '"region":"r","extra":1}',
        "null",
    ]) + "\n"


def fixture_single():
    return valid("2026-03-14T08:00:00.000Z") + "\n"


def fixture_no_trailing_newline():
    return "\n".join([
        valid("2026-03-14T08:00:00.000Z", dur=5),
        valid("2026-03-14T08:00:30.000Z", dur=7),
        valid("2026-03-14T08:01:00.000Z", dur=9),
    ])


def fixture_ties():
    """Every tie-break rule in the report gets exercised here."""
    lines = []
    # identical duration and identical timestamp: slowest_requests must fall
    # back to input line order.
    for i in range(6):
        lines.append(valid("2026-03-14T08:00:00.000Z", ep="/api/v2/cart",
                           dur=900, by=10, sess="sess-tie", user="u-000001"))
    # two endpoints with exactly the same count: endpoint name breaks the tie.
    for _ in range(4):
        lines.append(valid("2026-03-14T08:02:00.000Z", ep="/zzz", dur=1, by=1))
        lines.append(valid("2026-03-14T08:02:00.000Z", ep="/aaa", dur=1, by=1))
    # two users with exactly the same byte total: user id breaks the tie.
    for user in ("u-000009", "u-000002"):
        lines.append(valid("2026-03-14T08:03:00.000Z", ep="/api/v2/cart",
                           dur=2, by=5000, user=user, sess="sess-" + user))
    # two sessions with exactly the same span: session id breaks the tie.
    for sess in ("sess-bbbb", "sess-aaaa"):
        lines.append(valid("2026-03-14T08:04:00.000Z", ep="/api/v2/cart",
                           dur=3, by=1, sess=sess))
        lines.append(valid("2026-03-14T08:09:00.000Z", ep="/api/v2/cart",
                           dur=3, by=1, sess=sess))
    return "\n".join(lines) + "\n"


def fixture_shapes():
    """Valid records that do not have the canonical byte shape."""
    return "\n".join([
        # canonical, for contrast
        valid("2026-03-14T08:00:00.000Z", ep="/api/v2/orders/7", dur=11),
        # keys in a different order
        '{"status":200,"ts":"2026-03-14T08:00:01.000Z","dur_ms":12,'
        '"endpoint":"/api/v2/orders/7","bytes":100,"method":"GET",'
        '"region":"us-east-1","session":"sess-000000000001",'
        '"user":"u-000001"}',
        # whitespace everywhere JSON permits it
        '{ "ts" : "2026-03-14T08:00:02.000Z" , "endpoint" : '
        '"/api/v2/orders/7" , "method" : "GET" , "status" : 200 , '
        '"dur_ms" : 13 , "bytes" : 100 , "session" : "sess-000000000001" , '
        '"user" : "u-000001" , "region" : "us-east-1" }',
        # escaped solidus in the endpoint
        '{"ts":"2026-03-14T08:00:03.000Z","endpoint":"\\/api\\/v2\\/orders\\/7",'
        '"method":"GET","status":200,"dur_ms":14,"bytes":100,'
        '"session":"sess-000000000001","user":"u-000001",'
        '"region":"us-east-1"}',
        # \u escapes that decode to plain ASCII
        '{"ts":"2026-03-14T08:00:04.000Z","endpoint":"/api/v2/orders/7",'
        '"method":"GET","status":200,"dur_ms":15,"bytes":100,'
        '"session":"sess-000000000001","user":"\\u0075-000001",'
        '"region":"us-east-1"}',
        # a negative zero exponent style integer is a float -> malformed
        '{"ts":"2026-03-14T08:00:05.000Z","endpoint":"/api/v2/orders/7",'
        '"method":"GET","status":200,"dur_ms":1e1,"bytes":100,'
        '"session":"sess-000000000001","user":"u-000001",'
        '"region":"us-east-1"}',
    ]) + "\n"


def fixture_boundaries():
    lines = [
        valid("2026-03-14T08:00:00.000Z", st=100),
        valid("2026-03-14T08:00:00.001Z", st=599),
        valid("2026-03-14T08:00:00.002Z", st=99),      # malformed
        valid("2026-03-14T08:00:00.003Z", st=600),     # malformed
        valid("2026-03-14T08:00:00.004Z", dur=0, by=0),
    ]
    lines += [
        # booleans are not integers
        '{"ts":"2026-03-14T08:00:00.005Z","endpoint":"/a","method":"GET",'
        '"status":true,"dur_ms":1,"bytes":1,"session":"s","user":"u",'
        '"region":"r"}',
        # integral float is still a float
        '{"ts":"2026-03-14T08:00:00.006Z","endpoint":"/a","method":"GET",'
        '"status":200,"dur_ms":1.0,"bytes":1,"session":"s","user":"u",'
        '"region":"r"}',
        # null value
        '{"ts":"2026-03-14T08:00:00.007Z","endpoint":"/a","method":"GET",'
        '"status":200,"dur_ms":1,"bytes":null,"session":"s","user":"u",'
        '"region":"r"}',
        # empty string field
        '{"ts":"2026-03-14T08:00:00.008Z","endpoint":"/a","method":"",'
        '"status":200,"dur_ms":1,"bytes":1,"session":"s","user":"u",'
        '"region":"r"}',
        # endpoint does not start with a slash
        '{"ts":"2026-03-14T08:00:00.009Z","endpoint":"api/v2","method":"GET",'
        '"status":200,"dur_ms":1,"bytes":1,"session":"s","user":"u",'
        '"region":"r"}',
        # nested object where a scalar belongs
        '{"ts":"2026-03-14T08:00:00.010Z","endpoint":{"p":"/a"},'
        '"method":"GET","status":200,"dur_ms":1,"bytes":1,"session":"s",'
        '"user":"u","region":"r"}',
        # timestamp with the wrong sub-second width
        '{"ts":"2026-03-14T08:00:00.0000Z","endpoint":"/a","method":"GET",'
        '"status":200,"dur_ms":1,"bytes":1,"session":"s","user":"u",'
        '"region":"r"}',
        # negative bytes
        valid("2026-03-14T08:00:00.011Z", by=-1),
        # very large integers, which must not be truncated
        '{"ts":"2026-03-14T08:00:00.012Z","endpoint":"/a","method":"GET",'
        '"status":200,"dur_ms":98765432101234567,"bytes":12345678901234567890,'
        '"session":"s","user":"u","region":"r"}',
    ]
    return "\n".join(lines) + "\n"


def fixture_endpoints():
    paths = [
        "/",
        "//",
        "/api/v2/cart",
        "/api/v2/cart/",
        "/api/v2/cart//",
        "/api/v2/orders/0",
        "/api/v2/orders/007",
        "/api/v2/orders/48213/items",
        "/api/v2/search?q=a&b=2",
        "/api/v2/search?",
        "/api/v2/users/3f0c1a9d2b4e5f60718293a4b5c6d7e8",
        "/api/v2/users/3F0C1A9D2B4E5F60718293A4B5C6D7E8",   # uppercase: not an id
        "/api/v2/users/3f0c1a9d2b4e5f60718293a4b5c6d7e",    # 31 chars: not an id
        "/api/v2/users/3f0c1a9d2b4e5f60718293a4b5c6d7e89",  # 33 chars: not an id
        "/api/v2/12ab/34cd",
        "/checkout?next=/api/v2/checkout",
        "/api/v2/checkout",
    ]
    lines = []
    for index, path in enumerate(paths):
        lines.append(valid("2026-03-14T08:%02d:00.000Z" % index, ep=path,
                           dur=index + 1, by=index * 10,
                           sess="sess-%04d" % (index % 3)))
    return "\n".join(lines) + "\n"


def fixture_percentiles():
    """Bucket sizes chosen to sit on nearest-rank boundaries."""
    lines = []
    minute = 0
    for size in (1, 2, 3, 4, 5, 9, 10, 19, 20, 21, 25, 33, 50, 99, 100, 101):
        for i in range(size):
            lines.append(valid("2026-03-14T09:%02d:%02d.000Z" % (minute, i % 60),
                               ep="/api/v2/products/%d" % size,
                               dur=i + 1, by=1, sess="sess-p%03d" % size))
        minute += 1
    return "\n".join(lines) + "\n"


def fixture_sessions():
    lines = [
        # out-of-order arrival within one session
        valid("2026-03-14T08:05:00.000Z", ep="/api/v2/cart", sess="sess-a"),
        valid("2026-03-14T08:01:00.000Z", ep="/api/v2/orders", sess="sess-a",
              user="u-000777"),
        valid("2026-03-14T08:03:00.000Z", ep="/api/v2/cart", sess="sess-a"),
        # identical timestamps: line order decides first-touch order
        valid("2026-03-14T08:02:00.000Z", ep="/bbb", sess="sess-b"),
        valid("2026-03-14T08:02:00.000Z", ep="/aaa", sess="sess-b"),
        # a converting session, and a near miss with the wrong status
        valid("2026-03-14T08:04:00.000Z", ep="/api/v2/checkout", st=200,
              sess="sess-c"),
        valid("2026-03-14T08:04:01.000Z", ep="/api/v2/checkout", st=500,
              sess="sess-d"),
        valid("2026-03-14T08:04:02.000Z", ep="/api/v2/checkout?ref=email",
              st=200, sess="sess-e"),
        # single-event session: span is zero
        valid("2026-03-14T08:06:00.000Z", ep="/health", sess="sess-f"),
        # a session whose events all share one endpoint
        valid("2026-03-14T08:07:00.000Z", ep="/metrics", sess="sess-g"),
        valid("2026-03-14T08:08:00.000Z", ep="/metrics", sess="sess-g"),
        # a malformed line inside an otherwise healthy session
        '{"ts":"2026-03-14T08:09:00.000Z","endpoint":"/metrics",'
        '"session":"sess-g"}',
        valid("2026-03-14T08:10:00.000Z", ep="/metrics", sess="sess-g"),
    ]
    return "\n".join(lines) + "\n"


FIXTURES = [
    ("empty", fixture_empty),
    ("only-malformed", fixture_only_malformed),
    ("single", fixture_single),
    ("no-trailing-newline", fixture_no_trailing_newline),
    ("ties", fixture_ties),
    ("shapes", fixture_shapes),
    ("boundaries", fixture_boundaries),
    ("endpoints", fixture_endpoints),
    ("percentiles", fixture_percentiles),
    ("sessions", fixture_sessions),
]

# (lines, seed_offset, minutes)
GENERATED = [
    (1, 1, 1),
    (37, 2, 3),
    (999, 3, 5),
    (1000, 4, 1),
    (5000, 5, 60),
    (20000, 6, 240),
]


# ------------------------------------------------------------------- running

def run(cmd, cwd):
    return subprocess.run(cmd, cwd=str(cwd), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE)


def first_difference(a: bytes, b: bytes) -> str:
    limit = min(len(a), len(b))
    index = 0
    while index < limit and a[index] == b[index]:
        index += 1
    line = a[:index].count(b"\n") + 1
    lo = max(0, index - 60)
    return ("first difference at byte %d (output line %d)\n"
            "    reference: %r\n"
            "    candidate: %r"
            % (index, line, a[lo:index + 60], b[lo:index + 60]))


def compare_case(name, log_path, candidate, workdir, keep):
    ref_out = workdir / ("%s.reference.json" % name)
    cand_out = workdir / ("%s.candidate.json" % name)

    ref = run([sys.executable, str(REFERENCE), str(log_path), str(ref_out)], ROOT)
    if ref.returncode != 0:
        return False, "reference exited %d: %s" % (
            ref.returncode, ref.stderr.decode("utf-8", "replace")[-400:])

    cand = run(candidate + [str(log_path), str(cand_out)], ROOT)
    if cand.returncode != 0:
        return False, "candidate exited %d: %s" % (
            cand.returncode, cand.stderr.decode("utf-8", "replace")[-400:])
    if not cand_out.exists():
        return False, "candidate wrote no output file at %s" % cand_out

    expected = ref_out.read_bytes()
    actual = cand_out.read_bytes()
    if expected == actual:
        if not keep:
            ref_out.unlink()
            cand_out.unlink()
        return True, "%d bytes" % len(expected)
    return False, ("output differs (%d reference bytes, %d candidate bytes)\n  %s"
                   % (len(expected), len(actual), first_difference(expected, actual)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--candidate", default="./run.sh",
                    help="candidate command, invoked as <cmd> <input> <output> "
                         "with the workspace root as the working directory "
                         "(default: ./run.sh)")
    ap.add_argument("--salt", type=int, default=0,
                    help="added to every generated-workload seed, so a grader "
                         "can re-run the suite on data the candidate has never "
                         "seen (default: 0)")
    ap.add_argument("--include-workload", default=None,
                    help="also compare on this existing log file, typically the "
                         "full benchmark workload")
    ap.add_argument("--keep", action="store_true",
                    help="keep the temporary logs and reports for inspection")
    ap.add_argument("--json", action="store_true",
                    help="print a machine-readable summary line")
    args = ap.parse_args(argv)

    if not REFERENCE.exists():
        sys.stderr.write("reference not found at %s\n" % REFERENCE)
        return 2

    # Same interpreter on both sides; run.sh honours this variable.
    os.environ["LOGAGG_PYTHON"] = sys.executable

    candidate = args.candidate.split()
    if candidate[0].startswith("./") or candidate[0].startswith("/"):
        target = Path(candidate[0])
        if not target.is_absolute():
            target = ROOT / candidate[0]
        if not target.exists():
            sys.stderr.write("candidate command not found: %s\n" % target)
            return 2

    tmp = Path(tempfile.mkdtemp(prefix="logagg-check-"))
    cases = []
    failures = []

    try:
        for name, builder in FIXTURES:
            log_path = tmp / ("%s.log" % name)
            with open(str(log_path), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(builder())
            cases.append((name, log_path))

        if SAMPLE.exists():
            cases.append(("sample", SAMPLE))
            renamed = tmp / "renamed-sample.log"
            shutil.copyfile(str(SAMPLE), str(renamed))
            cases.append(("sample-renamed", renamed))
        else:
            sys.stderr.write("warning: %s is missing, skipping the sample cases\n"
                             % SAMPLE)

        for lines, offset, minutes in GENERATED:
            seed = 900000 + args.salt * 1000 + offset
            name = "gen-%d-s%d-m%d" % (lines, seed, minutes)
            log_path = tmp / ("%s.log" % name)
            gen = run([sys.executable, str(GENERATOR),
                       "--lines", str(lines), "--seed", str(seed),
                       "--minutes", str(minutes), "--out", str(log_path),
                       "--quiet"], ROOT)
            if gen.returncode != 0:
                sys.stderr.write("generator failed for %s: %s\n"
                                 % (name, gen.stderr.decode("utf-8", "replace")))
                return 2
            cases.append((name, log_path))

        if args.include_workload:
            cases.append(("workload", Path(args.include_workload)))

        width = max(len(name) for name, _ in cases)
        for name, log_path in cases:
            ok, detail = compare_case(name, log_path, candidate, tmp, args.keep)
            status = "ok  " if ok else "FAIL"
            sys.stdout.write("  %s  %-*s  %s\n" % (status, width, name, detail))
            sys.stdout.flush()
            if not ok:
                failures.append(name)

        passed = len(cases) - len(failures)
        sys.stdout.write("\n%d/%d cases byte-identical to the reference\n"
                         % (passed, len(cases)))
        if args.json:
            sys.stdout.write("CORRECTNESS_JSON " + json.dumps({
                "cases": len(cases),
                "passed": passed,
                "failed": failures,
                "salt": args.salt,
                "ok": not failures,
            }) + "\n")
        return 0 if not failures else 1
    finally:
        if args.keep:
            sys.stderr.write("kept working directory: %s\n" % tmp)
        else:
            shutil.rmtree(str(tmp), ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
