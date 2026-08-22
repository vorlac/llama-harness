#!/usr/bin/env python3
"""The visible check: the eight smoke cases of `reference-io/smoke.json`.

    python3 reference-io/smoke.py --run-sh run.sh

It starts the server on a free port, drives real client sockets against it, and
compares real bytes, in the same case format `SPEC.md` section 12.6 defines. It
is not the grader: eight cases over the harness contract end to end say that the
plumbing works, and nothing about the 869-case suite that grades the workspace.

Case strings are Latin-1, so every JSON code point in U+0000..U+00FF denotes
exactly that byte.
"""

import argparse
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST = "127.0.0.1"
READY_TIMEOUT = 20.0
READ_TIMEOUT = 5.0


class Closed(Exception):
    """The server closed the connection."""


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def encode_command(parts):
    out = [b"*%d\r\n" % len(parts)]
    for part in parts:
        payload = part.encode("latin-1")
        out.append(b"$%d\r\n" % len(payload))
        out.append(payload + b"\r\n")
    return b"".join(out)


class Client:
    def __init__(self, port):
        self.sock = socket.create_connection((HOST, port), timeout=READ_TIMEOUT)
        self.buffer = bytearray()

    def send(self, payload: bytes) -> None:
        self.sock.sendall(payload)

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def _fill(self) -> None:
        chunk = self.sock.recv(65536)
        if not chunk:
            raise Closed("connection closed")
        self.buffer += chunk

    def _line(self) -> bytes:
        while True:
            end = self.buffer.find(b"\r\n")
            if end >= 0:
                line = bytes(self.buffer[:end])
                del self.buffer[: end + 2]
                return line
            self._fill()

    def _exact(self, count: int) -> bytes:
        while len(self.buffer) < count:
            self._fill()
        payload = bytes(self.buffer[:count])
        del self.buffer[:count]
        return payload

    def reply(self):
        """One reply, as `(tag, payload)`."""
        line = self._line()
        tag = chr(line[0])
        body = line[1:]
        if tag in "+-":
            return tag, body.decode("latin-1")
        if tag == ":":
            return tag, int(body)
        if tag == "$":
            length = int(body)
            if length < 0:
                return tag, None
            payload = self._exact(length + 2)[:-2]
            return tag, payload.decode("latin-1")
        if tag == "*":
            count = int(body)
            if count < 0:
                return tag, None
            return tag, [self.reply() for _ in range(count)]
        raise AssertionError("unknown reply tag %r" % tag)

    def at_eof(self) -> bool:
        try:
            while True:
                self._fill()
        except Closed:
            return True
        except socket.timeout:
            return False


def matches(expectation, reply) -> bool:
    tag, want = expectation
    got_tag, got = reply
    if tag == "*":
        if want is None:
            return got_tag == "*" and got is None
        if got_tag != "*" or got is None or len(got) != len(want):
            return False
        for item, actual in zip(want, got):
            if isinstance(item, list):
                if not matches(item, actual):
                    return False
            elif item is None:
                if actual != ("$", None):
                    return False
            elif isinstance(item, int):
                if actual != (":", item):
                    return False
            elif actual != ("$", item):
                return False
        return True
    return (got_tag, got) == (tag, want)


def run_case(case, port, problems) -> None:
    clients = {}
    try:
        for step in case["steps"]:
            name = step.get("client", "c1")
            if name not in clients:
                clients[name] = Client(port)
            client = clients[name]
            if "cmd" in step:
                client.send(encode_command(step["cmd"]))
            elif "send" in step:
                client.send(step["send"].encode("latin-1"))
            if step.get("expect_closed"):
                if not client.at_eof():
                    problems.append("%s: expected the server to close" % case["name"])
                continue
            if "expect" in step:
                try:
                    reply = client.reply()
                except (Closed, socket.timeout) as exc:
                    problems.append("%s: %s" % (case["name"], exc or "no reply"))
                    return
                if not matches(step["expect"], reply):
                    problems.append(
                        "%s: want %r, got %r" % (case["name"], step["expect"], reply)
                    )
    finally:
        for client in clients.values():
            client.close()


def wait_ready(port, process) -> bool:
    deadline = time.time() + READY_TIMEOUT
    while time.time() < deadline:
        if process.poll() is not None:
            return False
        try:
            probe = socket.create_connection((HOST, port), timeout=0.5)
        except OSError:
            time.sleep(0.05)
            continue
        try:
            probe.sendall(b"PING\r\n")
            probe.settimeout(1.0)
            if probe.recv(64).startswith(b"+PONG"):
                return True
        except OSError:
            pass
        finally:
            probe.close()
        time.sleep(0.05)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-sh", default="run.sh")
    parser.add_argument("--cases", default=str(HERE / "smoke.json"))
    args = parser.parse_args()

    document = json.loads(Path(args.cases).read_text(encoding="utf-8"))
    port = free_port()
    workspace = Path(args.run_sh).resolve().parent
    process = subprocess.Popen(
        ["bash", str(Path(args.run_sh).resolve()), "--port", str(port)],
        cwd=str(workspace),
        stdout=subprocess.PIPE,
        stderr=None,
    )
    problems = []
    try:
        if not wait_ready(port, process):
            print("server never became ready on port %d" % port, file=sys.stderr)
            return 1
        for case in document["cases"]:
            run_case(case, port, problems)
            print("%-30s %s" % (case["name"], "ok" if not problems else "see below"))
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        print("FAIL %d problem(s)" % len(problems))
        return 1
    print("PASS %d case(s)" % len(document["cases"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
