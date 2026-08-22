# The rejection vocabulary and the one exception the parse path raises.
#
# SPEC.md section 9 fixes fourteen codes, and a code outside that set is a
# defect rather than a new kind of rejection, so the set is closed here and
# every raise is checked against it.

CODES = (
    "E_INVALID_UTF8",
    "E_BOM",
    "E_EMPTY",
    "E_TRAILING",
    "E_UNEXPECTED_BYTE",
    "E_UNEXPECTED_EOF",
    "E_BAD_NUMBER",
    "E_BAD_LITERAL",
    "E_BAD_STRING_ESCAPE",
    "E_BAD_UNICODE_ESCAPE",
    "E_LONE_SURROGATE",
    "E_CONTROL_CHAR",
    "E_DEPTH_LIMIT",
    "E_RESOURCE",
)


class JsonError(Exception):
    """One rejection, carrying the position SPEC.md section 9.3 defines.

    The offset is a byte offset into the whole input; the line and column are
    derived from it by `locate`, so a caller cannot report a position that
    disagrees with the offset it also reports.
    """

    def __init__(self, code, offset, message):
        if code not in CODES:
            raise AssertionError("code %r is outside the closed set" % code)
        Exception.__init__(self, message)
        self.code = code
        self.offset = offset
        self.message = message


def locate(data, offset):
    """The one-based (line, column) of a byte offset.

    Lines are separated by LF alone - a CR does not begin one - and columns
    count bytes from the start of the line, not characters, so a multi-byte
    scalar advances the column by its encoded length.
    """
    line = data.count(b"\n", 0, offset) + 1
    start = data.rfind(b"\n", 0, offset) + 1
    return line, offset - start + 1
