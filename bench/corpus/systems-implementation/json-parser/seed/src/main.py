# The command line and the harness protocol.
#
# The three modes of SPEC.md section 4 and the protocol of section 3 all reach
# the same parse and the same serialiser, so no mode can disagree with another
# about what a document means. stdout carries protocol bytes only and is
# flushed after every response: the runner writes one request and blocks for
# its answer, so a buffered harness deadlocks rather than scoring badly.

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from canonical import canonical  # noqa: E402
from errors import JsonError, locate  # noqa: E402
import parser  # noqa: E402

# A 512-deep document costs about two Python frames per level, which is past
# the interpreter's default ceiling. The parser's own depth limit is what
# bounds the work; this only stops the interpreter refusing first.
sys.setrecursionlimit(20000)

USAGE = "usage: run.sh [--harness | <path>]\n"
DEFAULT_INPUT = "sample.json"


def main(argv):
    if len(argv) > 1:
        sys.stderr.write(USAGE)
        return 2
    if argv and argv[0] == "--harness":
        return serve(sys.stdin.buffer, sys.stdout.buffer)
    if argv and argv[0].startswith("--"):
        sys.stderr.write(USAGE)
        return 2
    return parse_file(argv[0] if argv else DEFAULT_INPUT)


def parse_file(path):
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError as exc:
        sys.stderr.write("error: cannot read %s: %s\n" % (path, exc))
        return 2
    try:
        value = parser.parse(data)
    except JsonError as exc:
        line, column = locate(data, exc.offset)
        sys.stderr.write(
            "error: %s at byte %d, line %d, column %d: %s\n"
            % (exc.code, exc.offset, line, column, exc.message)
        )
        return 1
    sys.stdout.write(canonical(value) + "\n")
    return 0


def serve(source, sink):
    """Answer framed requests until stdin ends. Exit 2 on a malformed frame."""
    while True:
        header = source.readline()
        if not header:
            return 0
        if not header.endswith(b"\n"):
            sys.stderr.write("harness: request header is not terminated by LF\n")
            return 2
        fields = header[:-1].split(b" ")
        if len(fields) != 3 or fields[0] != b"CASE":
            sys.stderr.write("harness: request header is not a CASE frame\n")
            return 2
        try:
            length = parse_length(fields[2])
        except ValueError:
            sys.stderr.write("harness: request header has a bad length\n")
            return 2
        payload = source.read(length)
        if len(payload) != length:
            sys.stderr.write("harness: request payload is short\n")
            return 2
        if source.read(1) != b"\n":
            sys.stderr.write("harness: request payload is not followed by LF\n")
            return 2
        sink.write(respond(fields[1], payload))
        sink.flush()


def parse_length(field):
    """Decimal, no sign, and no leading zero unless the whole field is 0."""
    text = field.decode("ascii")
    if not text.isdigit() or (text[0] == "0" and text != "0"):
        raise ValueError(text)
    return int(text)


def respond(case_id, payload):
    try:
        body = canonical(parser.parse(payload)).encode("ascii")
    except JsonError as exc:
        line, column = locate(payload, exc.offset)
        message = exc.message.encode("utf-8")
        return b"ERR %s %s %d %d %d %d\n%s\n" % (
            case_id,
            exc.code.encode("ascii"),
            exc.offset,
            line,
            column,
            len(message),
            message,
        )
    return b"OK %s %d\n%s\n" % (case_id, len(body), body)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
