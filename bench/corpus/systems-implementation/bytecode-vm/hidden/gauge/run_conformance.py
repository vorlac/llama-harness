#!/usr/bin/env python3
"""Conformance runner for the bytecode-vm task.

The suite is language-neutral: the cases are data files under cases/, and this
runner drives whatever implementation you point it at through the harness
contract defined in SPEC.md section 3. Python 3.8+, standard library only.

    python3 run_conformance.py --vm ./vm.sh
    python3 run_conformance.py --vm ./vm.sh --group gc --group trace
    python3 run_conformance.py --vm ./vm.sh --case arith-001-add -v
    python3 run_conformance.py --list

Exit status is 0 when every selected case passes and 1 otherwise. A summary
line is always printed last:

    SUMMARY passed=<n> failed=<n> total=<n> pass_rate=<pct>

Nothing here knows anything about the implementation language. If a case fails
the reason is printed on the same line; -v adds the expected and actual values.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CASES_DIR = os.path.join(HERE, "cases")
ERROR_LINE = re.compile(r"^error: (E_[A-Z_]+)\b")
TRACE_LINE = re.compile(r"^trace: ")
MODES = ("exec", "run", "asm", "dis", "roundtrip", "trace")


# --------------------------------------------------------------- loading

def load_manifest(cases_dir):
    path = os.path.join(cases_dir, "manifest.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_group(cases_dir, name):
    path = os.path.join(cases_dir, name, "cases.json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    for case in data["cases"]:
        case["_group"] = name
        case["_dir"] = os.path.join(cases_dir, name)
    return data


# --------------------------------------------------------------- running

class Failure(Exception):
    """A case did not meet its expectations. The message is the reason."""

    def __init__(self, reason, expected=None, actual=None):
        super().__init__(reason)
        self.reason = reason
        self.expected = expected
        self.actual = actual


def invoke(vm, args, timeout):
    """Run the implementation. Returns (exit_code, stdout_bytes, stderr_text)."""
    try:
        proc = subprocess.run([vm] + [str(a) for a in args],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Failure("timed out after %gs" % timeout)
    except OSError as exc:
        raise Failure("could not execute %s: %s" % (vm, exc))
    return (proc.returncode, proc.stdout,
            proc.stderr.decode("utf-8", "replace"))


def short(value, limit=220):
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    text = repr(value)
    return text if len(text) <= limit else text[:limit] + "...(truncated)"


def error_code(stderr):
    for line in stderr.splitlines():
        m = ERROR_LINE.match(line)
        if m:
            return m.group(1)
    return None


def check_exit(case, code, stderr):
    want = case.get("expect_exit", 0)
    if code != want:
        raise Failure("exit status %d, expected %d" % (code, want),
                      want, "%d (stderr: %s)" % (code, short(stderr, 400)))


def check_error(case, stderr):
    want = case.get("expect_error")
    got = error_code(stderr)
    if want is None:
        if case.get("expect_exit", 0) == 0 and got is not None:
            raise Failure("unexpected error line %r on a successful run" % got)
        return
    if got != want:
        raise Failure("error code %s, expected %s" % (got, want), want,
                      short(stderr, 400))


def check_stdout(case, stdout):
    if "expect_stdout" not in case:
        return
    want = case["expect_stdout"].encode("utf-8")
    if stdout != want:
        raise Failure("stdout mismatch", short(want), short(stdout))


def read_produced(path, what):
    """Read a file the implementation was supposed to write."""
    if not os.path.isfile(path):
        raise Failure("%s exited 0 but wrote no output file" % what)
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError as exc:
        raise Failure("cannot read the %s output: %s" % (what, exc))


def resolve_source(case):
    path = os.path.join(case["_dir"], case["source"])
    if not os.path.isfile(path):
        raise Failure("missing case source %s" % path)
    return path


def write_binary(case, workdir):
    blob = bytes.fromhex(case["input_hex"])
    path = os.path.join(workdir, "input.svm")
    with open(path, "wb") as fh:
        fh.write(blob)
    return path


def module_for(case, vm, workdir, timeout):
    """Produce the .svm file a run/dis case operates on."""
    if "input_hex" in case:
        return write_binary(case, workdir)
    src = resolve_source(case)
    out = os.path.join(workdir, "a.svm")
    code, _, stderr = invoke(vm, ["asm", src, out], timeout)
    if code != 0:
        raise Failure("asm of the case source failed with exit %d" % code,
                      0, short(stderr, 400))
    if not os.path.isfile(out):
        raise Failure("asm exited 0 but wrote no output file")
    return out


def run_case(case, vm, timeout):
    mode = case.get("mode")
    if mode not in MODES:
        raise Failure("unknown mode %r in case data" % mode)
    args = list(case.get("args") or [])
    workdir = tempfile.mkdtemp(prefix="svmconf-")
    try:
        if mode == "exec":
            src = resolve_source(case)
            code, out, err = invoke(vm, ["exec"] + args + [src], timeout)
            check_exit(case, code, err)
            check_error(case, err)
            check_stdout(case, out)

        elif mode == "trace":
            src = resolve_source(case)
            code, out, err = invoke(vm, ["exec", "--trace"] + args + [src],
                                    timeout)
            check_exit(case, code, err)
            check_error(case, err)
            check_stdout(case, out)
            got = [ln for ln in err.splitlines() if TRACE_LINE.match(ln)]
            want = case.get("expect_stderr") or []
            if got != want:
                first = next((i for i, (a, b) in enumerate(zip(got, want))
                              if a != b), min(len(got), len(want)))
                raise Failure(
                    "trace mismatch at line %d (%d lines, expected %d)"
                    % (first + 1, len(got), len(want)),
                    "\n".join(want[max(0, first - 1):first + 2]),
                    "\n".join(got[max(0, first - 1):first + 2]))

        elif mode == "run":
            module = module_for(case, vm, workdir, timeout)
            code, out, err = invoke(vm, ["run"] + args + [module], timeout)
            check_exit(case, code, err)
            check_error(case, err)
            check_stdout(case, out)

        elif mode == "asm":
            src = resolve_source(case)
            out_path = os.path.join(workdir, "out.svm")
            code, _, err = invoke(vm, ["asm"] + args + [src, out_path], timeout)
            check_exit(case, code, err)
            check_error(case, err)
            if "expect_bytes_hex" in case:
                produced = read_produced(out_path, "asm")
                want = bytes.fromhex(case["expect_bytes_hex"])
                if produced != want:
                    raise Failure(
                        "module bytes differ (%d bytes, expected %d)"
                        % (len(produced), len(want)),
                        want.hex(), produced.hex())

        elif mode == "dis":
            module = module_for(case, vm, workdir, timeout)
            code, out, err = invoke(vm, ["dis"] + args + [module], timeout)
            check_exit(case, code, err)
            check_error(case, err)
            check_stdout(case, out)

        elif mode == "roundtrip":
            src = resolve_source(case)
            first = os.path.join(workdir, "a.svm")
            code, _, err = invoke(vm, ["asm", src, first], timeout)
            if code != 0:
                raise Failure("first asm failed with exit %d" % code, 0,
                              short(err, 400))
            read_produced(first, "first asm")
            code, text, err = invoke(vm, ["dis", first], timeout)
            if code != 0:
                raise Failure("dis failed with exit %d" % code, 0,
                              short(err, 400))
            listing = os.path.join(workdir, "b.asm")
            with open(listing, "wb") as fh:
                fh.write(text)
            second = os.path.join(workdir, "b.svm")
            code, _, err = invoke(vm, ["asm", listing, second], timeout)
            if code != 0:
                raise Failure("re-asm of the disassembly failed with exit %d"
                              % code, 0, short(err, 400))
            a = read_produced(first, "first asm")
            b = read_produced(second, "second asm")
            if a != b:
                raise Failure("round-trip changed the module (%d vs %d bytes)"
                              % (len(a), len(b)), a.hex(), b.hex())
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ------------------------------------------------------------------ main

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Run the bytecode-vm conformance suite against an "
                    "implementation.")
    ap.add_argument("--vm", default="./vm.sh",
                    help="harness entry point (default: ./vm.sh)")
    ap.add_argument("--group", action="append", default=[],
                    help="run only this group; repeatable")
    ap.add_argument("--case", action="append", default=[],
                    help="run only this case id; repeatable")
    ap.add_argument("--cases-dir", default=CASES_DIR)
    ap.add_argument("--timeout", type=float, default=60.0,
                    help="per-case timeout in seconds (default: 60)")
    ap.add_argument("--stop-after", type=int, default=0, metavar="N",
                    help="stop once N cases have failed (0 = never)")
    ap.add_argument("--list", action="store_true",
                    help="list the groups and their case counts, then exit")
    ap.add_argument("--jsonl", metavar="FILE",
                    help="also write one JSON object per case to FILE")
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="print expected and actual values for failures")
    ap.add_argument("-q", "--quiet", action="store_true",
                    help="print only failures and the summary")
    args = ap.parse_args(argv)

    try:
        manifest = load_manifest(args.cases_dir)
    except OSError as exc:
        print("cannot read the case manifest: %s" % exc, file=sys.stderr)
        return 2

    groups = manifest["groups"]
    if args.list:
        total = 0
        for name in groups:
            data = load_group(args.cases_dir, name)
            total += len(data["cases"])
            print("%-14s %4d  %s" % (name, len(data["cases"]),
                                     data.get("description", "")))
        print("%-14s %4d" % ("TOTAL", total))
        return 0

    selected = args.group or groups
    unknown = [g for g in selected if g not in groups]
    if unknown:
        print("unknown group(s): %s" % ", ".join(unknown), file=sys.stderr)
        print("available: %s" % ", ".join(groups), file=sys.stderr)
        return 2

    vm = args.vm
    if os.path.sep in vm or vm.startswith("."):
        vm = os.path.abspath(vm)
        if not os.path.isfile(vm):
            print("no such harness entry point: %s" % vm, file=sys.stderr)
            return 2
        if not os.access(vm, os.X_OK):
            print("harness entry point is not executable: %s" % vm,
                  file=sys.stderr)
            return 2

    wanted_cases = set(args.case)
    jsonl = open(args.jsonl, "w", encoding="utf-8") if args.jsonl else None
    passed = failed = 0
    stopped = False

    for name in selected:
        try:
            data = load_group(args.cases_dir, name)
        except (OSError, ValueError) as exc:
            print("cannot read group %s: %s" % (name, exc), file=sys.stderr)
            return 2
        gpass = gfail = 0
        for case in data["cases"]:
            if wanted_cases and case["id"] not in wanted_cases:
                continue
            try:
                run_case(case, vm, args.timeout)
            except Failure as exc:
                failure = exc
            except Exception as exc:                  # never abort the run
                failure = Failure("runner error: %r" % (exc,))
            else:
                failure = None

            if failure is None:
                passed += 1
                gpass += 1
                if not args.quiet:
                    print("PASS  %s" % case["id"])
            else:
                failed += 1
                gfail += 1
                print("FAIL  %s  %s" % (case["id"], failure.reason))
                if args.verbose:
                    if failure.expected is not None:
                        print("        expected: %s" % failure.expected)
                    if failure.actual is not None:
                        print("        actual:   %s" % failure.actual)
                    if case.get("note"):
                        print("        note:     %s" % case["note"])
            if jsonl:
                jsonl.write(json.dumps({
                    "id": case["id"], "group": name, "mode": case.get("mode"),
                    "status": "pass" if failure is None else "fail",
                    "reason": None if failure is None else failure.reason,
                }) + "\n")
            if args.stop_after and failed >= args.stop_after:
                stopped = True
                break
        # The per-group line is part of the required report, so it survives
        # --quiet; a group with nothing selected (a --case filter) prints
        # nothing.
        if gpass or gfail:
            print("GROUP %-14s passed=%d failed=%d" % (name, gpass, gfail))
        if stopped:
            print("stopping after %d failure(s)" % failed)
            break

    if jsonl:
        jsonl.close()
    total = passed + failed
    rate = (100.0 * passed / total) if total else 0.0
    print("SUMMARY passed=%d failed=%d total=%d pass_rate=%.1f%%"
          % (passed, failed, total, rate))
    return 0 if (failed == 0 and total > 0) else 1


if __name__ == "__main__":
    sys.exit(main())
