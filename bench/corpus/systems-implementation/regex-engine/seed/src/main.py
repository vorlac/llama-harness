# The harness of SPEC.md section 3: one request line in, one reply out.
#
# The process runs until stdin reaches end of file. A compile error is a reply,
# never a reason to terminate, and stdout carries replies and nothing else -
# every diagnostic goes to stderr, which the runner echoes with a prefix.

import sys

from compile import compile_pattern, format_instruction
from errors import BadRequest, RegexError
from matcher import find_all, search
from wire import decode_token

ARITY = {"PING": 0, "MATCH": 2, "FIND": 2, "COMPILE": 1, "PROGRAM": 1}


def handle(line: str):
    """The reply lines for one request line."""
    if line == "":
        return ["ERROR bad-request -1"]
    fields = line.split(" ")
    verb = fields[0]
    if verb not in ARITY:
        return ["ERROR unknown-command -1"]
    if len(fields) - 1 != ARITY[verb]:
        return ["ERROR bad-request -1"]
    if verb == "PING":
        return ["PONG"]
    try:
        arguments = [decode_token(field) for field in fields[1:]]
    except BadRequest:
        return ["ERROR bad-request -1"]
    try:
        prog, groups = compile_pattern(arguments[0])
    except RegexError as exc:
        return ["ERROR %s %d" % (exc.code, exc.pos)]
    if verb == "COMPILE":
        return ["COMPILED %d" % len(prog)]
    if verb == "PROGRAM":
        lines = ["PROGRAM %d" % len(prog)]
        for counter, ins in enumerate(prog):
            lines.append("%d %s" % (counter, format_instruction(ins)))
        return lines
    codes = [ord(ch) for ch in arguments[1]]
    if verb == "MATCH":
        caps = search(prog, groups, codes)
        if caps is None:
            return ["NOMATCH"]
        spans = " ".join(str(value) for value in caps[: 2 * groups + 2])
        return ["MATCH %d %s" % (groups + 1, spans)]
    spans = find_all(prog, groups, codes)
    parts = [str(len(spans))]
    for begin, end in spans:
        parts.append(str(begin))
        parts.append(str(end))
    return ["FIND %s" % " ".join(parts)]


def serve(stream, out) -> int:
    for raw in stream:
        if raw.endswith(b"\n"):
            raw = raw[:-1]
        # Request lines are ASCII; latin-1 keeps every byte addressable so the
        # wire decoder is the one place that decides what is writable.
        for reply in handle(raw.decode("latin-1")):
            out.write(reply)
            out.write("\n")
        out.flush()
    return 0


def main() -> int:
    return serve(sys.stdin.buffer, sys.stdout)


if __name__ == "__main__":
    sys.exit(main())
