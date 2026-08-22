# The parser: bytes in, a value from src/model.py out, one JsonError on the
# first fault.
#
# The five stages of SPEC.md section 5 run in the order that document fixes,
# because the order is what decides which fault a document with several of them
# reports. Nesting is bounded by a counter checked before descending, so a
# hundred thousand opening brackets cost a hundred thousand loop iterations and
# not a hundred thousand stack frames.

from errors import JsonError
from model import NULL, Number
import utf8

WHITESPACE = b" \t\n\r"
DIGITS = b"0123456789"
DEPTH_LIMIT = 512
BOM = b"\xef\xbb\xbf"

SIMPLE_ESCAPES = {
    0x22: '"',
    0x5C: "\\",
    0x2F: "/",
    0x62: "\b",
    0x66: "\f",
    0x6E: "\n",
    0x72: "\r",
    0x74: "\t",
}
HEX = {}
for _d in range(10):
    HEX[0x30 + _d] = _d
for _d in range(6):
    HEX[0x41 + _d] = 10 + _d
    HEX[0x61 + _d] = 10 + _d


def parse(data):
    """One document. Raises JsonError; never returns a partial value."""
    bad = utf8.first_ill_formed(data)
    if bad is not None:
        raise JsonError("E_INVALID_UTF8", bad, "ill-formed UTF-8 sequence")
    if data.startswith(BOM):
        raise JsonError("E_BOM", 0, "a byte order mark is not a JSON document")
    reader = _Reader(data)
    reader.skip_whitespace()
    if reader.at_end():
        raise JsonError("E_EMPTY", len(data), "the document is empty")
    value = reader.read_value(0)
    reader.skip_whitespace()
    if not reader.at_end():
        raise JsonError(
            "E_TRAILING", reader.pos, "content follows the top-level value"
        )
    return value


class _Reader:
    """A cursor over the input bytes. One left-to-right pass, no backtracking."""

    def __init__(self, data):
        self.data = data
        self.n = len(data)
        self.pos = 0

    def at_end(self):
        return self.pos >= self.n

    def eof(self):
        return JsonError(
            "E_UNEXPECTED_EOF", self.n, "the document ends inside a value"
        )

    def skip_whitespace(self):
        data = self.data
        pos = self.pos
        n = self.n
        while pos < n and data[pos] in WHITESPACE:
            pos += 1
        self.pos = pos

    def read_value(self, depth):
        if self.at_end():
            raise self.eof()
        byte = self.data[self.pos]
        if byte == 0x7B:
            return self.read_object(depth)
        if byte == 0x5B:
            return self.read_array(depth)
        if byte == 0x22:
            return self.read_string()
        if byte == 0x74:
            return self.read_literal(b"true", True)
        if byte == 0x66:
            return self.read_literal(b"false", False)
        if byte == 0x6E:
            return self.read_literal(b"null", NULL)
        if byte == 0x2D or byte in DIGITS:
            return self.read_number()
        raise JsonError(
            "E_UNEXPECTED_BYTE", self.pos, "no value can start with this byte"
        )

    def read_literal(self, word, value):
        start = self.pos
        for offset in range(len(word)):
            at = start + offset
            if at >= self.n:
                raise self.eof()
            if self.data[at] != word[offset]:
                raise JsonError("E_BAD_LITERAL", at, "not the literal it began as")
        self.pos = start + len(word)
        return value

    def read_number(self):
        data = self.data
        n = self.n
        pos = self.pos
        neg = data[pos] == 0x2D
        if neg:
            pos += 1
        if pos >= n:
            raise self.eof()
        int_start = pos
        if data[pos] == 0x30:
            pos += 1
            if pos < n and data[pos] in DIGITS:
                raise JsonError("E_BAD_NUMBER", pos, "an integer part has a leading zero")
        elif data[pos] in DIGITS:
            while pos < n and data[pos] in DIGITS:
                pos += 1
        else:
            raise JsonError("E_BAD_NUMBER", pos, "a number needs a digit here")
        int_part = data[int_start:pos].decode("ascii")

        frac_part = ""
        if pos < n and data[pos] == 0x2E:
            pos += 1
            if pos >= n:
                raise self.eof()
            if data[pos] not in DIGITS:
                raise JsonError("E_BAD_NUMBER", pos, "a fraction needs a digit here")
            frac_start = pos
            while pos < n and data[pos] in DIGITS:
                pos += 1
            frac_part = data[frac_start:pos].decode("ascii")

        exp = 0
        if pos < n and data[pos] in (0x65, 0x45):
            pos += 1
            if pos >= n:
                raise self.eof()
            exp_neg = False
            if data[pos] in (0x2B, 0x2D):
                exp_neg = data[pos] == 0x2D
                pos += 1
                if pos >= n:
                    raise self.eof()
            if data[pos] not in DIGITS:
                raise JsonError("E_BAD_NUMBER", pos, "an exponent needs a digit here")
            exp_start = pos
            while pos < n and data[pos] in DIGITS:
                pos += 1
            exp = int(data[exp_start:pos].decode("ascii"))
            if exp_neg:
                exp = -exp

        self.pos = pos
        return Number(neg, int_part + frac_part, exp - len(frac_part))

    def read_string(self):
        data = self.data
        n = self.n
        pos = self.pos + 1
        out = []
        while True:
            if pos >= n:
                raise self.eof()
            byte = data[pos]
            if byte == 0x22:
                self.pos = pos + 1
                return "".join(out)
            if byte < 0x20:
                raise JsonError(
                    "E_CONTROL_CHAR", pos, "a raw control character is not allowed"
                )
            if byte == 0x5C:
                text, pos = self.read_escape(pos)
                out.append(text)
                continue
            scalar, pos = utf8.scalar_at(data, pos)
            out.append(chr(scalar))

    def read_escape(self, pos):
        data = self.data
        n = self.n
        if pos + 1 >= n:
            raise self.eof()
        kind = data[pos + 1]
        simple = SIMPLE_ESCAPES.get(kind)
        if simple is not None:
            return simple, pos + 2
        if kind != 0x75:
            raise JsonError(
                "E_BAD_STRING_ESCAPE", pos + 1, "not an escape this grammar has"
            )
        first, after = self.read_hex4(pos)
        if 0xDC00 <= first <= 0xDFFF:
            raise JsonError(
                "E_LONE_SURROGATE", pos, "a low surrogate with no high surrogate"
            )
        if not 0xD800 <= first <= 0xDBFF:
            return chr(first), after
        if after >= n:
            raise self.eof()
        if data[after] != 0x5C:
            raise JsonError(
                "E_LONE_SURROGATE", pos, "a high surrogate with no low surrogate"
            )
        if after + 1 >= n:
            raise self.eof()
        if data[after + 1] != 0x75:
            raise JsonError(
                "E_LONE_SURROGATE", pos, "a high surrogate with no low surrogate"
            )
        second, after = self.read_hex4(after)
        if not 0xDC00 <= second <= 0xDFFF:
            raise JsonError(
                "E_LONE_SURROGATE", pos, "a high surrogate with no low surrogate"
            )
        return chr(0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)), after

    def read_hex4(self, pos):
        """The four hex digits of a \\uXXXX escape whose backslash is at pos."""
        data = self.data
        value = 0
        for offset in range(2, 6):
            at = pos + offset
            if at >= self.n:
                raise self.eof()
            digit = HEX.get(data[at])
            if digit is None:
                raise JsonError(
                    "E_BAD_UNICODE_ESCAPE", at, "a unicode escape needs four hex digits"
                )
            value = value * 16 + digit
        return value, pos + 6

    def read_array(self, depth):
        if depth + 1 > DEPTH_LIMIT:
            raise JsonError("E_DEPTH_LIMIT", self.pos, "nesting is too deep")
        self.pos += 1
        out = []
        self.skip_whitespace()
        if self.at_end():
            raise self.eof()
        if self.data[self.pos] == 0x5D:
            self.pos += 1
            return out
        while True:
            self.skip_whitespace()
            out.append(self.read_value(depth + 1))
            self.skip_whitespace()
            if self.at_end():
                raise self.eof()
            byte = self.data[self.pos]
            if byte == 0x2C:
                self.pos += 1
                continue
            if byte == 0x5D:
                self.pos += 1
                return out
            raise JsonError(
                "E_UNEXPECTED_BYTE", self.pos, "an array element needs , or ] after it"
            )

    def read_object(self, depth):
        if depth + 1 > DEPTH_LIMIT:
            raise JsonError("E_DEPTH_LIMIT", self.pos, "nesting is too deep")
        self.pos += 1
        out = {}
        self.skip_whitespace()
        if self.at_end():
            raise self.eof()
        if self.data[self.pos] == 0x7D:
            self.pos += 1
            return out
        while True:
            self.skip_whitespace()
            if self.at_end():
                raise self.eof()
            if self.data[self.pos] != 0x22:
                raise JsonError(
                    "E_UNEXPECTED_BYTE", self.pos, "an object key must be a string"
                )
            key = self.read_string()
            self.skip_whitespace()
            if self.at_end():
                raise self.eof()
            if self.data[self.pos] != 0x3A:
                raise JsonError(
                    "E_UNEXPECTED_BYTE", self.pos, "an object key needs a : after it"
                )
            self.pos += 1
            self.skip_whitespace()
            # A duplicate key keeps the last occurrence: assigning again is the
            # whole of SPEC.md section 8.2.
            out[key] = self.read_value(depth + 1)
            self.skip_whitespace()
            if self.at_end():
                raise self.eof()
            byte = self.data[self.pos]
            if byte == 0x2C:
                self.pos += 1
                continue
            if byte == 0x7D:
                self.pos += 1
                return out
            raise JsonError(
                "E_UNEXPECTED_BYTE", self.pos, "an object member needs , or } after it"
            )
