#!/usr/bin/env python3
"""Conformance runner for the `json-parser` task.

    python3 runner.py [options] [-- HARNESS_CMD [ARG ...]]

    python3 runner.py                                  # ./run.sh --harness, all groups
    python3 runner.py --group numbers-reject --verbose
    python3 runner.py --case depth-013 -- ./target/release/jp --harness
    python3 runner.py --json report.json

The runner is deliberately language-neutral: it knows nothing about the
implementation beyond the request/response protocol in
`systems-implementation/tasks/json-parser/SPEC.md` section 3. It starts the
harness once, drives every selected case through it, and compares the answers
against the data files in `cases/`.

Nothing here is a JSON parser. Case files are read with the Python standard
library; the expectations they hold were authored, not computed at run time.

Exit codes
  0  every scored case passed
  1  at least one scored case failed
  2  usage error, unreadable case data, or a harness that could not be started
  3  the harness crashed, hung, or broke the protocol

Indeterminate cases (SPEC.md section 11) are executed and reported but can
never fail the run.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import queue
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CASES = os.path.join(HERE, "cases")
DEFAULT_CMD = ["./run.sh", "--harness"]

ID_RE = re.compile(r"^[A-Za-z0-9._:~-]+$")
CODES = {
    "E_EMPTY", "E_TRAILING", "E_UNEXPECTED_BYTE", "E_UNEXPECTED_EOF",
    "E_BAD_NUMBER", "E_BAD_LITERAL", "E_BAD_STRING_ESCAPE",
    "E_BAD_UNICODE_ESCAPE", "E_LONE_SURROGATE", "E_CONTROL_CHAR",
    "E_INVALID_UTF8", "E_BOM", "E_DEPTH_LIMIT", "E_RESOURCE",
}


# --------------------------------------------------------------- case loading

class CaseError(Exception):
    pass


def case_input(case):
    """The exact bytes to hand to the harness for this case."""
    forms = [k for k in ("input", "input_b64", "input_repeat") if k in case]
    if len(forms) != 1:
        raise CaseError("case %s must have exactly one of input / input_b64 / "
                        "input_repeat (found %s)" % (case.get("id"), forms or "none"))
    if "input" in case:
        return case["input"].encode("utf-8")
    if "input_b64" in case:
        return base64.b64decode(case["input_b64"], validate=True)
    r = case["input_repeat"]
    for key in ("prefix", "unit", "suffix"):
        if not isinstance(r.get(key), str):
            raise CaseError("case %s: input_repeat.%s must be a string" % (case["id"], key))
    if not isinstance(r.get("count"), int) or r["count"] < 0:
        raise CaseError("case %s: input_repeat.count must be a non-negative integer"
                        % case["id"])
    return (r["prefix"] + r["unit"] * r["count"] + r["suffix"]).encode("utf-8")


def load_cases(cases_dir, groups, ids):
    if not os.path.isdir(cases_dir):
        raise CaseError("case directory not found: %s" % cases_dir)
    files = sorted(f for f in os.listdir(cases_dir) if f.endswith(".json"))
    if not files:
        raise CaseError("no case files in %s" % cases_dir)
    known = [f[:-5] for f in files]
    for g in groups:
        if g not in known:
            raise CaseError("unknown group %r (have: %s)" % (g, ", ".join(known)))

    selected = []
    for name in files:
        group = name[:-5]
        if groups and group not in groups:
            continue
        path = os.path.join(cases_dir, name)
        with open(path, encoding="utf-8") as fh:
            try:
                doc = json.load(fh)
            except ValueError as exc:
                raise CaseError("%s: %s" % (path, exc))
        if doc.get("group") != group:
            raise CaseError("%s: 'group' is %r but the file is named %s.json"
                            % (path, doc.get("group"), group))
        for case in doc.get("cases", []):
            cid = case.get("id")
            if not cid or not ID_RE.match(cid):
                raise CaseError("%s: bad or missing case id %r" % (path, cid))
            if ids and cid not in ids:
                continue
            if case.get("expect") not in ("accept", "reject", "indeterminate"):
                raise CaseError("%s: case %s has expect=%r"
                                % (path, cid, case.get("expect")))
            if case["expect"] == "reject":
                if case.get("code") not in CODES:
                    raise CaseError("%s: case %s has unknown code %r"
                                    % (path, cid, case.get("code")))
                for key in ("offset", "line", "column"):
                    if not isinstance(case.get(key), int):
                        raise CaseError("%s: case %s is missing integer %s"
                                        % (path, cid, key))
            case["group"] = group
            case["bytes"] = case_input(case)
            selected.append(case)
    if ids:
        found = {c["id"] for c in selected}
        missing = [i for i in ids if i not in found]
        if missing:
            raise CaseError("no such case id: %s" % ", ".join(missing))
    return selected


# ------------------------------------------------------------------- harness

class ProtocolError(Exception):
    pass


class Harness:
    """One long-lived harness process, spoken to one request at a time."""

    def __init__(self, cmd, cwd, timeout):
        self.cmd = cmd
        self.timeout = timeout
        self.errfile = tempfile.TemporaryFile()
        try:
            self.proc = subprocess.Popen(
                cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=self.errfile, start_new_session=True)
        except OSError as exc:
            raise CaseError("could not start harness %s: %s" % (" ".join(cmd), exc))
        self.q = queue.Queue()
        self.thread = threading.Thread(target=self._read_loop, daemon=True)
        self.thread.start()

    # -- reader thread ----------------------------------------------------

    def _read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.proc.stdout.read(n - len(buf))
            if not chunk:
                raise ProtocolError("stdout ended after %d of %d payload bytes"
                                    % (len(buf), n))
            buf += chunk
        return buf

    def _read_loop(self):
        try:
            while True:
                line = self.proc.stdout.readline()
                if not line:
                    self.q.put(("eof", None))
                    return
                self.q.put(("resp", self._frame(line)))
        except ProtocolError as exc:
            self.q.put(("protocol", str(exc)))
        except Exception as exc:                      # pragma: no cover
            self.q.put(("protocol", "reader failed: %r" % (exc,)))

    def _frame(self, line):
        if not line.endswith(b"\n"):
            raise ProtocolError("response header not terminated by LF: %r" % line[:80])
        try:
            head = line[:-1].decode("ascii")
        except UnicodeDecodeError:
            raise ProtocolError("response header is not ASCII: %r" % line[:80])
        parts = head.split(" ")
        if parts and parts[0] == "OK":
            if len(parts) != 3:
                raise ProtocolError("OK header must have 3 fields: %r" % head)
            cid, n = parts[1], self._int(parts[2], "length", head)
            payload = self._read_exact(n)
            self._expect_lf()
            try:
                text = payload.decode("ascii")
            except UnicodeDecodeError:
                raise ProtocolError("canonical output for %s is not ASCII" % cid)
            return {"kind": "OK", "id": cid, "canonical": text}
        if parts and parts[0] == "ERR":
            if len(parts) != 7:
                raise ProtocolError("ERR header must have 7 fields: %r" % head)
            cid, code = parts[1], parts[2]
            off = self._int(parts[3], "offset", head)
            line_no = self._int(parts[4], "line", head)
            col = self._int(parts[5], "column", head)
            mlen = self._int(parts[6], "message length", head)
            msg = self._read_exact(mlen)
            self._expect_lf()
            return {"kind": "ERR", "id": cid, "code": code, "offset": off,
                    "line": line_no, "column": col, "message": msg}
        raise ProtocolError("response must start with OK or ERR: %r" % head)

    @staticmethod
    def _int(text, what, head):
        if not re.match(r"^(0|[1-9][0-9]*)$", text):
            raise ProtocolError("%s %r is not a decimal integer in %r" % (what, text, head))
        return int(text)

    def _expect_lf(self):
        b = self._read_exact(1)
        if b != b"\n":
            raise ProtocolError("payload not followed by LF (saw %r)" % b)

    # -- main thread ------------------------------------------------------

    def ask(self, cid, payload):
        """Send one request; return ('resp', frame) / ('eof', None) /
        ('protocol', text) / ('timeout', None)."""
        header = ("CASE %s %d\n" % (cid, len(payload))).encode("ascii")
        try:
            self.proc.stdin.write(header)
            self.proc.stdin.write(payload)
            self.proc.stdin.write(b"\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, ValueError, OSError):
            return ("eof", None)
        try:
            return self.q.get(timeout=self.timeout)
        except queue.Empty:
            return ("timeout", None)

    def stderr_tail(self, limit=2048):
        try:
            self.errfile.seek(0)
            data = self.errfile.read()
        except (OSError, ValueError):
            return ""
        return data[-limit:].decode("utf-8", "replace")

    def close(self):
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.kill()
        return self.proc.returncode

    def kill(self):
        try:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                self.proc.kill()
            except OSError:
                pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:              # pragma: no cover
            pass


# ------------------------------------------------------------------ checking

def describe_expected(case):
    if case["expect"] == "accept":
        canon = case.get("canonical")
        return "accept" + ("" if canon is None else " " + short(canon))
    if case["expect"] == "reject":
        return "reject %s @%d:%d:%d" % (case["code"], case["offset"],
                                        case["line"], case["column"])
    return "indeterminate"


def describe_got(frame):
    if frame["kind"] == "OK":
        return "accept " + short(frame["canonical"])
    return "reject %s @%d:%d:%d" % (frame["code"], frame["offset"],
                                    frame["line"], frame["column"])


def short(text, limit=60):
    return text if len(text) <= limit else text[:limit - 3] + "..."


def check(case, frame, opts):
    """Return (ok, kind, detail). kind is '' when ok."""
    if frame["id"] != case["id"]:
        return False, "protocol", ("response id %r does not match request id %r"
                                   % (frame["id"], case["id"]))
    if frame["kind"] == "ERR":
        if frame["code"] not in CODES:
            return False, "protocol", "unknown error code %r" % frame["code"]
        if frame["line"] < 1 or frame["column"] < 1:
            return False, "protocol", "line and column are 1-based"
        if not frame["message"]:
            return False, "protocol", "error message is empty"
        if b"\n" in frame["message"]:
            return False, "protocol", "error message contains a line feed"

    if case["expect"] == "indeterminate":
        return True, "", ""

    if case["expect"] == "accept":
        if frame["kind"] != "OK":
            return False, "verdict", describe_got(frame)
        want = case.get("canonical")
        if want is not None and frame["canonical"] != want:
            return False, "canonical", ""
        return True, "", ""

    if frame["kind"] != "ERR":
        return False, "verdict", describe_got(frame)
    if not opts.ignore_codes and frame["code"] != case["code"]:
        return False, "code", describe_got(frame)
    if not opts.ignore_positions:
        if (frame["offset"], frame["line"], frame["column"]) != (
                case["offset"], case["line"], case["column"]):
            return False, "position", describe_got(frame)
    return True, "", ""


# ---------------------------------------------------------------------- main

def parse_args(argv):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cases", default=DEFAULT_CASES, metavar="DIR",
                    help="directory of case files (default: %(default)s)")
    ap.add_argument("--group", action="append", default=[], metavar="NAME",
                    help="run only this group; repeatable")
    ap.add_argument("--case", action="append", default=[], metavar="ID",
                    help="run only this case id; repeatable")
    ap.add_argument("--all", action="store_true",
                    help="run every group (the default when no --group/--case is given)")
    ap.add_argument("--list-groups", action="store_true",
                    help="print the group names and case counts, then exit")
    ap.add_argument("--timeout", type=float, default=20.0, metavar="SEC",
                    help="per-request timeout in seconds (default: %(default)s)")
    ap.add_argument("--cwd", default=".", metavar="DIR",
                    help="working directory for the harness (default: %(default)s)")
    ap.add_argument("--json", metavar="PATH", help="write a machine-readable report")
    ap.add_argument("--no-idempotence", action="store_true",
                    help="skip re-feeding canonical output back through the harness")
    ap.add_argument("--ignore-codes", action="store_true",
                    help="diagnostic only: do not compare error codes (NOT the graded mode)")
    ap.add_argument("--ignore-positions", action="store_true",
                    help="diagnostic only: do not compare offset/line/column "
                         "(NOT the graded mode)")
    ap.add_argument("-v", "--verbose", action="store_true", help="print every case")
    ap.add_argument("-q", "--quiet", action="store_true",
                    help="print only the summary lines")
    ap.add_argument("cmd", nargs=argparse.REMAINDER,
                    help="harness command, after --; default: ./run.sh --harness")
    opts = ap.parse_args(argv)
    cmd = opts.cmd
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    opts.harness = cmd or list(DEFAULT_CMD)
    return opts


def main(argv):
    opts = parse_args(argv)

    try:
        cases = load_cases(opts.cases, opts.group, opts.case)
    except CaseError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    if opts.list_groups:
        counts = {}
        for c in cases:
            counts[c["group"]] = counts.get(c["group"], 0) + 1
        for g in sorted(counts):
            print("%-20s %4d" % (g, counts[g]))
        print("%-20s %4d" % ("TOTAL", len(cases)))
        return 0

    if not cases:
        print("error: no cases selected", file=sys.stderr)
        return 2

    print("harness: %s   (cwd %s)" % (" ".join(shlex.quote(a) for a in opts.harness),
                                      os.path.abspath(opts.cwd)))
    print("cases:   %d from %s" % (len(cases), os.path.abspath(opts.cases)))

    try:
        harness = Harness(opts.harness, opts.cwd, opts.timeout)
    except CaseError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    results = []
    mismatch = {"verdict": 0, "code": 0, "position": 0, "canonical": 0, "protocol": 0}
    fatal = None
    started = time.monotonic()

    for index, case in enumerate(cases):
        if fatal:
            results.append({"id": case["id"], "group": case["group"],
                            "expect": case["expect"], "status": "not_run", "detail": fatal})
            continue

        kind, frame = harness.ask(case["id"], case["bytes"])
        if kind == "timeout":
            fatal = "harness did not answer %s within %.1fs" % (case["id"], opts.timeout)
            harness.kill()
            results.append({"id": case["id"], "group": case["group"],
                            "expect": case["expect"], "status": "timeout", "detail": fatal})
            continue
        if kind == "eof":
            fatal = "harness stdout closed at %s (exit code %s)" % (
                case["id"], harness.proc.poll())
            results.append({"id": case["id"], "group": case["group"],
                            "expect": case["expect"], "status": "crash", "detail": fatal})
            continue
        if kind == "protocol":
            fatal = "protocol error at %s: %s" % (case["id"], frame)
            harness.kill()
            results.append({"id": case["id"], "group": case["group"],
                            "expect": case["expect"], "status": "protocol",
                            "detail": str(frame)})
            mismatch["protocol"] += 1
            continue

        ok, why, detail = check(case, frame, opts)
        observed = describe_got(frame)

        if ok and not opts.no_idempotence and case["expect"] == "accept" \
                and case.get("canonical") is not None:
            rid = case["id"] + "~rt"
            k2, f2 = harness.ask(rid, case["canonical"].encode("ascii"))
            if k2 != "resp":
                fatal = "harness failed the idempotence request for %s (%s)" % (case["id"], k2)
                harness.kill()
                results.append({"id": case["id"], "group": case["group"],
                                "expect": case["expect"], "status": "crash", "detail": fatal})
                continue
            if f2["id"] != rid:
                ok, why, detail = False, "protocol", (
                    "idempotence response id %r does not match %r" % (f2["id"], rid))
            elif f2["kind"] != "OK":
                ok, why, detail = False, "canonical", (
                    "canonical output was rejected when fed back: %s" % describe_got(f2))
            elif f2["canonical"] != case["canonical"]:
                ok, why, detail = False, "canonical", (
                    "canonicalisation is not idempotent: %s" % short(f2["canonical"]))

        if case["expect"] == "indeterminate":
            status = "indeterminate"
        elif ok:
            status = "pass"
        else:
            status = "fail"
            mismatch[why] = mismatch.get(why, 0) + 1

        results.append({"id": case["id"], "group": case["group"],
                        "expect": case["expect"], "status": status,
                        "expected": describe_expected(case), "observed": observed,
                        "why": why, "detail": detail})

        if not opts.quiet:
            if status == "fail":
                extra = ""
                if why in ("canonical", "protocol") and detail:
                    extra = "  (%s)" % detail
                print("FAIL %-26s expected %s | got %s%s%s"
                      % (case["id"], describe_expected(case), observed,
                         ("  [%s]" % why) if why else "", extra))
                if why == "canonical" and case.get("canonical") is not None:
                    print("       want: %s" % short(case["canonical"], 160))
                    print("       got : %s" % short(frame.get("canonical", ""), 160))
            elif opts.verbose:
                label = {"pass": "PASS", "indeterminate": "INDET"}[status]
                print("%-5s %-26s %s" % (label, case["id"], observed))

    exit_code_harness = None
    if not fatal:
        exit_code_harness = harness.close()
        if exit_code_harness != 0:
            fatal = "harness exited %s after the last request (expected 0)" % exit_code_harness
    else:
        harness.kill()

    elapsed = time.monotonic() - started

    scored = [r for r in results if r["expect"] != "indeterminate"]
    passed = sum(1 for r in scored if r["status"] == "pass")
    failed = sum(1 for r in scored if r["status"] == "fail")
    indet = sum(1 for r in results if r["expect"] == "indeterminate")
    crashed = sum(1 for r in results if r["status"] in ("crash", "protocol", "not_run"))
    timeouts = sum(1 for r in results if r["status"] == "timeout")
    rate = (100.0 * passed / len(scored)) if scored else 0.0

    if not opts.quiet:
        print("")
        groups = []
        for r in results:
            if r["group"] not in groups:
                groups.append(r["group"])
        for g in groups:
            rows = [r for r in results if r["group"] == g]
            gs = [r for r in rows if r["expect"] != "indeterminate"]
            gp = sum(1 for r in gs if r["status"] == "pass")
            print("GROUP %-20s %4d cases  %4d passed  %4d failed  %4d indeterminate"
                  % (g, len(rows), gp, len(gs) - gp,
                     sum(1 for r in rows if r["expect"] == "indeterminate")))
        print("")

    if indet:
        seen = {}
        for r in results:
            if r["expect"] == "indeterminate":
                label = r["observed"].split(" ")[0] if "observed" in r else r["status"]
                seen[label] = seen.get(label, 0) + 1
        print("INDETERMINATE %d case(s): %s (reported, never scored)"
              % (indet, ", ".join("%s=%d" % kv for kv in sorted(seen.items()))))

    print("MISMATCH verdict=%d code=%d position=%d canonical=%d protocol=%d"
          % (mismatch["verdict"], mismatch["code"], mismatch["position"],
             mismatch["canonical"], mismatch["protocol"]))
    print("SUMMARY total=%d scored=%d passed=%d failed=%d indeterminate=%d "
          "crashed=%d timeouts=%d pass_rate=%.2f%% seconds=%.1f"
          % (len(results), len(scored), passed, failed, indet, crashed, timeouts,
             rate, elapsed))

    if fatal:
        print("FATAL %s" % fatal)
        tail = harness.stderr_tail()
        if tail.strip():
            print("--- harness stderr (tail) ---")
            print(tail.rstrip())
            print("--- end harness stderr ---")

    if opts.json:
        report = {
            "harness": opts.harness,
            "cases_dir": os.path.abspath(opts.cases),
            "total": len(results), "scored": len(scored), "passed": passed,
            "failed": failed, "indeterminate": indet, "crashed": crashed,
            "timeouts": timeouts, "pass_rate": round(rate, 4),
            "seconds": round(elapsed, 3), "mismatch": mismatch,
            "harness_exit_code": exit_code_harness, "fatal": fatal,
            "cases": results,
        }
        with open(opts.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
            fh.write("\n")

    if fatal or crashed or timeouts:
        return 3
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except KeyboardInterrupt:                          # pragma: no cover
        print("interrupted", file=sys.stderr)
        raise SystemExit(130)
