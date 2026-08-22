#!/usr/bin/env python3
"""Plumbing check for the `json-parser` harness protocol.

    python3 check_io.py [options] [-- HARNESS_CMD [ARG ...]]

    python3 reference-io/check_io.py -- bash run.sh --harness
    python3 reference-io/check_io.py --session reference-io/session-01.request

Each `session-NN.request` file holds a complete, byte-exact request stream for
the protocol in SPEC.md section 3, and a `session-NN.request.b64` file holds
one base64-encoded. This script feeds one to the harness on stdin, renders the
responses as a normalised transcript, and diffs that against
`session-NN.transcript`.

The transcript deliberately omits the two things SPEC.md leaves free: the
message length and the message text. Everything else -- verdict, echoed case
id, canonical bytes, error code, byte offset, line, column, response count and
process exit status -- is compared exactly.

Run this before the full conformance suite. If the transcripts do not match,
the fault is in the protocol plumbing or in one of the seven error classes the
sessions cover, and the 600-plus case suite will only bury that in noise.

Exit codes: 0 every session matched, 1 a session differed, 2 usage error.
"""

from __future__ import annotations

import argparse
import base64
import glob
import os
import re
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CMD = ["./run.sh", "--harness"]
INT = re.compile(r"^(0|[1-9][0-9]*)$")


class BadResponse(Exception):
    pass


def frames(data):
    """Split a raw response stream into transcript lines."""
    lines = []
    pos = 0
    while pos < len(data):
        nl = data.find(b"\n", pos)
        if nl < 0:
            raise BadResponse("header at byte %d is not terminated by LF: %r"
                              % (pos, data[pos:pos + 60]))
        try:
            head = data[pos:nl].decode("ascii")
        except UnicodeDecodeError:
            raise BadResponse("header at byte %d is not ASCII: %r" % (pos, data[pos:nl][:60]))
        pos = nl + 1
        parts = head.split(" ")
        if parts[0] == "OK" and len(parts) == 3:
            cid, size = parts[1], parts[2]
            if not INT.match(size):
                raise BadResponse("bad length in %r" % head)
            body, pos = take(data, pos, int(size), head)
            try:
                text = body.decode("ascii")
            except UnicodeDecodeError:
                raise BadResponse("canonical output for %s is not ASCII" % cid)
            lines.append("OK %s %s" % (cid, text))
        elif parts[0] == "ERR" and len(parts) == 7:
            cid, code = parts[1], parts[2]
            for field in parts[3:]:
                if not INT.match(field):
                    raise BadResponse("bad numeric field in %r" % head)
            off, line, col, mlen = (int(parts[3]), int(parts[4]), int(parts[5]), int(parts[6]))
            msg, pos = take(data, pos, mlen, head)
            if not msg:
                raise BadResponse("error message for %s is empty" % cid)
            if b"\n" in msg:
                raise BadResponse("error message for %s contains a line feed" % cid)
            lines.append("ERR %s %s %d %d %d msg=nonempty" % (cid, code, off, line, col))
        else:
            raise BadResponse("response header must be OK or ERR with the right "
                              "field count: %r" % head)
    return lines


def take(data, pos, size, head):
    end = pos + size
    if end + 1 > len(data):
        raise BadResponse("payload for %r is short: wanted %d bytes plus LF, "
                          "have %d" % (head, size, len(data) - pos))
    if data[end:end + 1] != b"\n":
        raise BadResponse("payload for %r is not followed by LF" % head)
    return data[pos:end], end + 1


def session_bytes(path):
    """The byte-exact request stream a session file stands for.

    A `.request` file is those bytes. A `.request.b64` file is base64 of them,
    which is how a session carrying raw bytes - invalid UTF-8, a NUL inside a
    string payload - travels through a text-only channel and arrives byte for
    byte.
    """
    with open(path, "rb") as fh:
        raw = fh.read()
    if path.endswith(".b64"):
        return base64.b64decode(raw, validate=False)
    return raw


def run_session(cmd, cwd, path, timeout):
    request = session_bytes(path)
    try:
        proc = subprocess.run(cmd, cwd=cwd, input=request, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout)
    except OSError as exc:
        # Missing run.sh, a run.sh without the execute bit, a bad shebang: all
        # of these are "the harness would not start", not a crash of this script.
        return None, "could not start harness: %s" % exc, b""
    except subprocess.TimeoutExpired:
        return None, "harness did not finish within %.1fs" % timeout, b""
    try:
        lines = frames(proc.stdout)
    except BadResponse as exc:
        return None, "protocol error: %s" % exc, proc.stderr
    lines.append("END responses=%d exit=%d" % (len(lines), proc.returncode))
    return lines, None, proc.stderr


def main(argv):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--session", action="append", default=[], metavar="PATH",
                    help="a session request file; repeatable (default: all of them)")
    ap.add_argument("--cwd", default=".", metavar="DIR",
                    help="working directory for the harness (default: %(default)s)")
    ap.add_argument("--timeout", type=float, default=60.0, metavar="SEC")
    ap.add_argument("--print", dest="show", action="store_true",
                    help="print the transcript even when it matches")
    ap.add_argument("cmd", nargs=argparse.REMAINDER,
                    help="harness command, after --; default: ./run.sh --harness")
    opts = ap.parse_args(argv)

    cmd = opts.cmd[1:] if (opts.cmd and opts.cmd[0] == "--") else opts.cmd
    cmd = cmd or list(DEFAULT_CMD)

    sessions = opts.session or sorted(
        glob.glob(os.path.join(HERE, "session-*.request"))
        + glob.glob(os.path.join(HERE, "session-*.request.b64"))
    )
    if not sessions:
        print("error: no session files found in %s" % HERE, file=sys.stderr)
        return 2

    print("harness: %s   (cwd %s)" % (" ".join(shlex.quote(a) for a in cmd),
                                      os.path.abspath(opts.cwd)))
    bad = 0
    for path in sessions:
        name = os.path.basename(path)
        stem = path[:-len(".b64")] if path.endswith(".b64") else path
        expect_path = stem[:-len(".request")] + ".transcript"
        if not os.path.exists(expect_path):
            print("error: no transcript beside %s" % path, file=sys.stderr)
            return 2
        with open(expect_path, encoding="ascii") as fh:
            expected = fh.read().splitlines()

        got, error, stderr = run_session(cmd, opts.cwd, path, opts.timeout)
        if error:
            print("%-24s FAIL  %s" % (name, error))
            bad += 1
        elif got == expected:
            print("%-24s ok    %d responses" % (name, len(expected) - 1))
            if opts.show:
                for ln in got:
                    print("    " + ln)
        else:
            bad += 1
            print("%-24s FAIL  transcript differs" % name)
            for i in range(max(len(expected), len(got))):
                want = expected[i] if i < len(expected) else "<missing>"
                have = got[i] if i < len(got) else "<missing>"
                if want != have:
                    print("    line %d" % (i + 1))
                    print("      want: %s" % want)
                    print("      got : %s" % have)
        if stderr.strip():
            tail = stderr[-1024:].decode("utf-8", "replace").rstrip()
            print("    harness stderr (tail): %s" % tail.replace("\n", "\n      "))

    print("%d session(s), %d failed" % (len(sessions), bad))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
