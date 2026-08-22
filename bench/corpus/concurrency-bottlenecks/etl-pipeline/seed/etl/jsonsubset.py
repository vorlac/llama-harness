"""A parser for the strict JSON subset of SPEC.md section 1.1.1.

The subset is narrower than JSON in ways that matter to the reject file: the
only escapes a string may carry are `\\"` and `\\\\`, numbers are integers with
no sign, fraction or exponent, and the only whitespace between tokens is SPACE.
A general-purpose JSON reader accepts inputs this specification rejects, so the
grammar is spelled out here instead.

Duplicate keys are legal and the last occurrence wins.  Unknown keys are legal
and ignored by the caller.
"""


class JsonError(Exception):
    """Any violation of the subset grammar.  The position is not reported:
    section 4.3 requires `bad_json` to carry no detail, so that two parsers
    that stop at different bytes still produce the same output."""


def json_type(value):
    """The type name section 3 uses in a `bad_type` detail."""
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    return "null"


class _Reader:
    """Recursive-descent reader over one record line."""

    def __init__(self, text):
        self.text = text
        self.pos = 0
        self.end = len(text)

    def skip_spaces(self):
        text, pos, end = self.text, self.pos, self.end
        while pos < end and text[pos] == " ":
            pos += 1
        self.pos = pos

    def document(self):
        self.skip_spaces()
        value = self.value()
        self.skip_spaces()
        if self.pos != self.end:
            raise JsonError("trailing content")
        return value

    def value(self):
        if self.pos >= self.end:
            raise JsonError("end of input")
        char = self.text[self.pos]
        if char == "{":
            return self.obj()
        if char == "[":
            return self.array()
        if char == '"':
            return self.string()
        if char == "-" or "0" <= char <= "9":
            return self.number()
        if self.text.startswith("null", self.pos):
            self.pos += 4
            return None
        if self.text.startswith("true", self.pos):
            self.pos += 4
            return True
        if self.text.startswith("false", self.pos):
            self.pos += 5
            return False
        raise JsonError("unexpected character")

    def obj(self):
        self.pos += 1
        members = {}
        self.skip_spaces()
        if self.pos < self.end and self.text[self.pos] == "}":
            self.pos += 1
            return members
        while True:
            self.skip_spaces()
            if self.pos >= self.end or self.text[self.pos] != '"':
                raise JsonError("object key")
            key = self.string()
            self.skip_spaces()
            if self.pos >= self.end or self.text[self.pos] != ":":
                raise JsonError("missing colon")
            self.pos += 1
            self.skip_spaces()
            members[key] = self.value()
            self.skip_spaces()
            if self.pos >= self.end:
                raise JsonError("end of input inside object")
            char = self.text[self.pos]
            if char == ",":
                self.pos += 1
                continue
            if char == "}":
                self.pos += 1
                return members
            raise JsonError("object separator")

    def array(self):
        self.pos += 1
        items = []
        self.skip_spaces()
        if self.pos < self.end and self.text[self.pos] == "]":
            self.pos += 1
            return items
        while True:
            self.skip_spaces()
            items.append(self.value())
            self.skip_spaces()
            if self.pos >= self.end:
                raise JsonError("end of input inside array")
            char = self.text[self.pos]
            if char == ",":
                self.pos += 1
                continue
            if char == "]":
                self.pos += 1
                return items
            raise JsonError("array separator")

    def string(self):
        text, end = self.text, self.end
        pos = self.pos + 1
        start = pos
        chunks = None
        while True:
            if pos >= end:
                raise JsonError("unterminated string")
            char = text[pos]
            if char == '"':
                if chunks is None:
                    self.pos = pos + 1
                    return text[start:pos]
                chunks.append(text[start:pos])
                self.pos = pos + 1
                return "".join(chunks)
            if char == "\\":
                if pos + 1 >= end:
                    raise JsonError("unterminated escape")
                escaped = text[pos + 1]
                if escaped != '"' and escaped != "\\":
                    raise JsonError("illegal escape")
                if chunks is None:
                    chunks = []
                chunks.append(text[start:pos])
                chunks.append(escaped)
                pos += 2
                start = pos
                continue
            pos += 1

    def number(self):
        text, end = self.text, self.end
        pos = self.pos
        start = pos
        if text[pos] == "-":
            pos += 1
        if pos >= end or not "0" <= text[pos] <= "9":
            raise JsonError("number")
        if text[pos] == "0":
            pos += 1
        else:
            while pos < end and "0" <= text[pos] <= "9":
                pos += 1
        if pos < end and (text[pos] == "." or text[pos] == "e"
                          or text[pos] == "E" or "0" <= text[pos] <= "9"):
            raise JsonError("number is not an integer")
        self.pos = pos
        return int(text[start:pos])


def parse_record(text):
    """Parse one line.  Raises JsonError on any violation of the subset."""
    return _Reader(text).document()
