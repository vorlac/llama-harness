# The RESP2 wire format of SPEC.md section 3: replies out, requests in.
#
# Replies are built straight into bytes, so an array is the concatenation of
# already-encoded elements and nests without a second representation.
#
# The request parser is incremental and re-reads the buffer from the start on
# every attempt. That walk is proportional to the number of elements and not to
# the number of bytes, because a bulk payload is skipped by its declared length,
# so a value arriving in many segments costs one short walk per segment.

CRLF = b"\r\n"

MAX_MULTIBULK = 1024 * 1024
MAX_BULK = 512 * 1024 * 1024
MAX_INLINE = 65536

INLINE_SEPARATORS = b" \t\n\r\x0b\x0c"
HEXDIGITS = b"0123456789abcdefABCDEF"


class ProtocolError(Exception):
    """A framing fault: the reply is written and the connection then closes."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def simple(text) -> bytes:
    return b"+" + _as_bytes(text) + CRLF


def error(text) -> bytes:
    return b"-" + _as_bytes(text) + CRLF


def integer(value: int) -> bytes:
    return b":" + str(value).encode("ascii") + CRLF


def bulk(value) -> bytes:
    if value is None:
        return b"$-1" + CRLF
    payload = _as_bytes(value)
    return b"$" + str(len(payload)).encode("ascii") + CRLF + payload + CRLF


def array(items) -> bytes:
    if items is None:
        return b"*-1" + CRLF
    return b"*" + str(len(items)).encode("ascii") + CRLF + b"".join(items)


def bulk_array(values) -> bytes:
    return array([bulk(value) for value in values])


def _as_bytes(value) -> bytes:
    return value if isinstance(value, bytes) else value.encode("utf-8")


def parse_signed(text: bytes):
    """A signed 64-bit protocol integer, or None. Not `STRICT_INT64`."""
    if not text:
        return None
    signed = text[:1] in (b"-", b"+")
    body = text[1:] if signed else text
    if not body or not body.isdigit():
        return None
    value = int(body.decode("ascii"))
    if text[:1] == b"-":
        value = -value
    if value < -(2 ** 63) or value > 2 ** 63 - 1:
        return None
    return value


def describe_byte(value: int) -> str:
    """The offending byte of `expected '$', got '<c>'`, per section 3.2."""
    if 0x20 <= value <= 0x7E:
        return chr(value)
    return "\\x%02x" % value


def next_request(buffer: bytes):
    """`(arguments, consumed)` for the first complete request in `buffer`.

    `arguments` is None when the request produced no command - an ignored
    `*0` header, an empty inline line - and `consumed` is 0 when the buffer
    does not yet hold a whole request. A framing fault raises ProtocolError.
    """
    if not buffer:
        return None, 0
    if buffer[:1] == b"*":
        return _next_multibulk(buffer)
    return _next_inline(buffer)


def _next_multibulk(buffer: bytes):
    end = buffer.find(b"\n")
    if end < 0:
        return None, 0
    header = buffer[1:end]
    if header.endswith(b"\r"):
        header = header[:-1]
    count = parse_signed(header)
    if count is None or count > MAX_MULTIBULK:
        raise ProtocolError("ERR Protocol error: invalid multibulk length")
    cursor = end + 1
    if count <= 0:
        return None, cursor
    arguments = []
    for _ in range(count):
        if cursor >= len(buffer):
            return None, 0
        if buffer[cursor : cursor + 1] != b"$":
            raise ProtocolError(
                "ERR Protocol error: expected '$', got '%s'"
                % describe_byte(buffer[cursor])
            )
        line_end = buffer.find(b"\n", cursor)
        if line_end < 0:
            return None, 0
        length_text = buffer[cursor + 1 : line_end]
        if length_text.endswith(b"\r"):
            length_text = length_text[:-1]
        length = parse_signed(length_text)
        if length is None or length < 0 or length > MAX_BULK:
            raise ProtocolError("ERR Protocol error: invalid bulk length")
        start = line_end + 1
        if len(buffer) < start + length + 2:
            return None, 0
        if buffer[start + length : start + length + 2] != CRLF:
            raise ProtocolError("ERR Protocol error: invalid bulk length")
        arguments.append(bytes(buffer[start : start + length]))
        cursor = start + length + 2
    return arguments, cursor


def _next_inline(buffer: bytes):
    end = buffer.find(b"\n")
    if end < 0:
        if len(buffer) > MAX_INLINE:
            raise ProtocolError("ERR Protocol error: too big inline request")
        return None, 0
    line = buffer[:end]
    if line.endswith(b"\r"):
        line = line[:-1]
    arguments = split_inline(line)
    if arguments is None:
        raise ProtocolError("ERR Protocol error: unbalanced quotes in request")
    if not arguments:
        return None, end + 1
    return arguments, end + 1


def split_inline(line: bytes):
    """One inline line's arguments, or None when the quoting is unbalanced.

    The rules are real Redis's `sdssplitargs`, which section 3.3 names: runs of
    six whitespace bytes separate arguments, a double-quoted section carries the
    `\\xHH` and control escapes, a single-quoted section carries only `\\'`, and
    a closing quote must be followed by a separator or the end of the line.
    """
    arguments = []
    index = 0
    size = len(line)
    while True:
        while index < size and line[index] in INLINE_SEPARATORS:
            index += 1
        if index >= size:
            return arguments
        current = bytearray()
        quote = None
        while True:
            if quote is None:
                if index >= size:
                    break
                byte = line[index]
                if byte in INLINE_SEPARATORS:
                    break
                if byte == 0x22 or byte == 0x27:
                    quote = byte
                    index += 1
                    continue
                current.append(byte)
                index += 1
                continue
            if index >= size:
                return None
            byte = line[index]
            if quote == 0x22:
                if (
                    byte == 0x5C
                    and index + 3 < size
                    and line[index + 1] == 0x78
                    and line[index + 2] in HEXDIGITS
                    and line[index + 3] in HEXDIGITS
                ):
                    current.append(int(line[index + 2 : index + 4], 16))
                    index += 4
                    continue
                if byte == 0x5C and index + 1 < size:
                    escaped = line[index + 1]
                    current.append(_DOUBLE_ESCAPES.get(escaped, escaped))
                    index += 2
                    continue
            elif byte == 0x5C and index + 1 < size and line[index + 1] == 0x27:
                current.append(0x27)
                index += 2
                continue
            if byte == quote:
                if index + 1 < size and line[index + 1] not in INLINE_SEPARATORS:
                    return None
                index += 1
                quote = None
                break
            current.append(byte)
            index += 1
        if quote is not None:
            return None
        arguments.append(bytes(current))


_DOUBLE_ESCAPES = {
    ord("n"): 0x0A,
    ord("r"): 0x0D,
    ord("t"): 0x09,
    ord("b"): 0x08,
    ord("a"): 0x07,
}
