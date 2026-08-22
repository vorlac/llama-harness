# The compile-error vocabulary of SPEC.md section 7.
#
# A compile error is a reply, never a reason to terminate: `RegexError` carries
# the machine-readable code and the 0-based code point index into the pattern
# that the reply needs, and the harness turns it into one `ERROR` line.

CODES = (
    "trailing-backslash",
    "bad-escape",
    "unbalanced-paren",
    "unexpected-bracket",
    "unterminated-class",
    "empty-class",
    "class-range-out-of-order",
    "nothing-to-repeat",
    "bad-repeat",
    "repeat-too-large",
    "unsupported-group",
    "program-too-large",
)


class RegexError(Exception):
    """A pattern that does not compile, with the code and position of section 7."""

    def __init__(self, code: str, pos: int):
        if code not in CODES:
            raise AssertionError("unknown compile-error code %r" % code)
        super().__init__("%s at %d" % (code, pos))
        self.code = code
        self.pos = pos


class BadRequest(Exception):
    """A request line that is not well formed, per SPEC.md section 3.3 and 3.6."""
