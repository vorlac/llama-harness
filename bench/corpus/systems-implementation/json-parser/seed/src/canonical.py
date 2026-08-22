# The canonical form: printable ASCII, no whitespace, one spelling per value.
#
# SPEC.md sections 6.4, 7.3 and 8.4 define it, and the property that makes it
# usable as an expected value is idempotence - canonicalising a canonical form
# returns the identical bytes - so nothing here may depend on how the input was
# spelled, only on the value.

from model import NULL, Number

ESCAPES = {
    0x22: '\\"',
    0x5C: "\\\\",
    0x08: "\\b",
    0x0C: "\\f",
    0x0A: "\\n",
    0x0D: "\\r",
    0x09: "\\t",
}


def canonical(value):
    """The canonical text of a parsed value. Always printable ASCII."""
    out = []
    _emit(value, out)
    return "".join(out)


def _emit(value, out):
    if value is NULL:
        out.append("null")
    elif value is True:
        out.append("true")
    elif value is False:
        out.append("false")
    elif isinstance(value, Number):
        out.append(number_text(value))
    elif isinstance(value, str):
        out.append(string_text(value))
    elif isinstance(value, list):
        out.append("[")
        for index, item in enumerate(value):
            if index:
                out.append(",")
            _emit(item, out)
        out.append("]")
    else:
        out.append("{")
        # Sorted by code point, which for Python strings is what sorted() does:
        # it compares scalar values, not encoded bytes and not UTF-16 units.
        for index, key in enumerate(sorted(value)):
            if index:
                out.append(",")
            out.append(string_text(key))
            out.append(":")
            _emit(value[key], out)
        out.append("}")


def string_text(text):
    """One string, escaped down to printable ASCII with lowercase hex."""
    out = ['"']
    for char in text:
        code = ord(char)
        escape = ESCAPES.get(code)
        if escape is not None:
            out.append(escape)
        elif 0x20 <= code <= 0x7E:
            out.append(char)
        elif code <= 0xFFFF:
            out.append("\\u%04x" % code)
        else:
            offset = code - 0x10000
            out.append("\\u%04x\\u%04x" % (0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF)))
    out.append('"')
    return "".join(out)


def number_text(number):
    """SPEC.md section 6.4, step for step, on the exact decimal."""
    digits = number.digits.lstrip("0")
    if not digits:
        return "-0" if number.neg else "0"
    # Leading zeros carry no weight, so dropping them leaves the exponent
    # alone. Trailing zeros do, so dropping one raises the exponent by one.
    exponent = number.exp
    stripped = digits.rstrip("0")
    exponent += len(digits) - len(stripped)
    digits = stripped
    count = len(digits)
    adjusted = exponent + count - 1
    sign = "-" if number.neg else ""

    if exponent >= 0 and adjusted <= 20:
        return sign + digits + "0" * exponent
    if exponent < 0 and adjusted >= -7:
        if adjusted >= 0:
            return sign + digits[: adjusted + 1] + "." + digits[adjusted + 1 :]
        return sign + "0." + "0" * (-adjusted - 1) + digits
    body = digits[0] + ("." + digits[1:] if count > 1 else "")
    return sign + body + "e" + str(adjusted)
