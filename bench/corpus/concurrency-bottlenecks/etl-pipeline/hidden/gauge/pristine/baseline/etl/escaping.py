"""Byte escaping for the reject file (SPEC.md section 2.2.1).

Input lines are held as latin-1 text, so one character is one byte and the
escape table can be applied with `str.translate`.
"""

from .config import DETAIL_VALUE_BYTES, RAW_PREFIX_BYTES

_ESCAPE_TABLE = {}
for _code in range(256):
    if _code == 0x5C:
        _ESCAPE_TABLE[_code] = "\\\\"
    elif _code == 0x09:
        _ESCAPE_TABLE[_code] = "\\t"
    elif _code == 0x0A:
        _ESCAPE_TABLE[_code] = "\\n"
    elif _code == 0x0D:
        _ESCAPE_TABLE[_code] = "\\r"
    elif _code < 0x20 or _code > 0x7E:
        _ESCAPE_TABLE[_code] = "\\x%02x" % _code


def escape(text):
    """Escape every byte of `text` that the reject file may not carry raw."""
    return text.translate(_ESCAPE_TABLE)


def raw_prefix(line):
    """The `raw_prefix` column: first 80 bytes of the line, then escaped."""
    return escape(line[:RAW_PREFIX_BYTES])


def detail_value(text):
    """A `<esc>` placeholder in a reject detail: 32 bytes, then escaped."""
    return escape(text[:DETAIL_VALUE_BYTES])
