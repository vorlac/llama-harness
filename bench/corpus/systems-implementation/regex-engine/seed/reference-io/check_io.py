#!/usr/bin/env python3
"""The visible check: the six worked sessions of `reference-io/`.

    python3 reference-io/check_io.py --cwd . -- bash run.sh

Each `NN-name.in` is a script of request lines and each `NN-name.out` is the
reply stream the harness must produce for it, exactly, byte for byte. The one
exception is `05-program.out`, which `reference-io/README.md` marks as
illustrative: any well-formed compilation of those patterns is correct, so this
checks the shape of the dump - the header count, ascending program counters,
known opcodes - and not its text. It deliberately does not check the range
normalisation of `SPEC.md` section 9.2, which is a property of the compiler
rather than of the plumbing and which the graded run checks.

This is not the grader. It is protocol plumbing plus one worked example of each
reply shape, and passing it says only that the harness speaks the protocol.
"""

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

OPCODES = {"char", "any", "class", "split", "jmp", "save", "assert", "match"}
ILLUSTRATIVE = "05-program"


def run_session(argv, cwd, requests, timeout):
    proc = subprocess.run(
        argv,
        cwd=cwd,
        input=requests,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "harness exited %d\n%s"
            % (proc.returncode, proc.stderr.decode("utf-8", "replace"))
        )
    return proc.stdout.decode("utf-8", "replace")


def check_exact(name, expected, actual):
    want = expected.splitlines()
    got = actual.splitlines()
    if want == got:
        return []
    problems = []
    for index in range(max(len(want), len(got))):
        left = want[index] if index < len(want) else "<no line>"
        right = got[index] if index < len(got) else "<no line>"
        if left != right:
            problems.append("%s line %d: want %r, got %r" % (name, index + 1, left, right))
    return problems


def check_program_shape(name, requests, actual):
    """The dump shape of SPEC.md section 9.4, without pinning its text."""
    problems = []
    lines = actual.splitlines()
    index = 0
    for request in requests.splitlines():
        if index >= len(lines):
            problems.append("%s: no reply for %r" % (name, request))
            break
        head = lines[index]
        index += 1
        if head.startswith("ERROR "):
            continue
        if not head.startswith("PROGRAM "):
            problems.append("%s: %r replied %r" % (name, request, head))
            continue
        try:
            count = int(head.split(" ")[1])
        except (IndexError, ValueError):
            problems.append("%s: unreadable header %r" % (name, head))
            continue
        body = lines[index : index + count]
        if len(body) != count:
            problems.append(
                "%s: %r announced %d instructions and produced %d"
                % (name, request, count, len(body))
            )
            index = len(lines)
            continue
        index += count
        for counter, text in enumerate(body):
            parts = text.split(" ")
            if parts[0] != str(counter):
                problems.append(
                    "%s: %r instruction %d begins %r" % (name, request, counter, parts[0])
                )
            elif len(parts) < 2 or parts[1] not in OPCODES:
                problems.append("%s: %r has unknown opcode in %r" % (name, request, text))
        if body and body[0].split(" ")[1:] != ["save", "0"]:
            problems.append("%s: %r does not begin with `save 0`" % (name, request))
    if index != len(lines):
        problems.append("%s: %d unread reply line(s)" % (name, len(lines) - index))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", default=".")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    argv = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not argv:
        print("usage: check_io.py --cwd . -- bash run.sh", file=sys.stderr)
        return 2

    sessions = sorted(HERE.glob("*.in"))
    if not sessions:
        print("no session found beside %s" % HERE, file=sys.stderr)
        return 2

    problems = []
    for session in sessions:
        name = session.stem
        requests = session.read_bytes()
        expected = session.with_suffix(".out").read_text(encoding="utf-8")
        try:
            actual = run_session(argv, args.cwd, requests, args.timeout)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            problems.append("%s: %s" % (name, exc))
            continue
        if name == ILLUSTRATIVE:
            problems.extend(
                check_program_shape(name, requests.decode("utf-8"), actual)
            )
        else:
            problems.extend(check_exact(name, expected, actual))
        print("%-14s %s" % (name, "ok" if not problems else "see below"))
    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        print("FAIL %d problem(s)" % len(problems))
        return 1
    print("PASS %d session(s)" % len(sessions))
    return 0


if __name__ == "__main__":
    sys.exit(main())
