# The six value types of SPEC.md section 7 and the display form of section 7.5.
#
# `nil` is None, a bool is a Python bool and an int is a Python int held to
# sixty-four bits by `wrap`. The three reference types are objects, because
# section 7.3 makes array and closure equality identity and section 9 counts
# them, so a value of one of those types has to be a thing and not a copy.

from errors import SvmError

MASK64 = (1 << 64) - 1
INT_MIN = -(1 << 63)
INT_MAX = (1 << 63) - 1


def wrap(value: int) -> int:
    """A Python int reduced to the signed 64-bit value it denotes."""
    value &= MASK64
    return value - (1 << 64) if value > INT_MAX else value


class Obj:
    """A reference value. `permanent` objects are outside the heap budget."""

    permanent = False


class Str(Obj):
    __slots__ = ("data", "permanent")

    def __init__(self, data: bytes, permanent: bool = False):
        self.data = data
        self.permanent = permanent


class Arr(Obj):
    __slots__ = ("items", "permanent")

    def __init__(self, items=None):
        self.items = [] if items is None else items
        self.permanent = False


class Closure(Obj):
    __slots__ = ("function", "upvalues", "permanent")

    def __init__(self, function: int, upvalues, permanent: bool = False):
        self.function = function
        self.upvalues = upvalues
        self.permanent = permanent


def type_name(value) -> str:
    if value is None:
        return "nil"
    if value is True or value is False:
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, Str):
        return "str"
    if isinstance(value, Arr):
        return "array"
    return "fn"


def truthy(value) -> bool:
    """Section 7.2: only nil and false are falsey."""
    return value is not None and value is not False


def equal(left, right) -> bool:
    """Section 7.3. Never raises, and never coerces across types."""
    kind = type_name(left)
    if kind != type_name(right):
        return False
    if kind == "nil":
        return True
    if kind == "str":
        return left.data == right.data
    if kind in ("array", "fn"):
        return left is right
    return left == right


def compare(left, right, op: str) -> bool:
    """Section 7.4: ordering exists for two integers and for two strings."""
    kind = type_name(left)
    if kind != type_name(right) or kind not in ("int", "str"):
        raise SvmError("E_TYPE", "cannot order %s and %s" % (kind, type_name(right)))
    if kind == "str":
        left, right = left.data, right.data
    if op == "LT":
        return left < right
    if op == "LE":
        return left <= right
    if op == "GT":
        return left > right
    return left >= right


def display(value, names) -> bytes:
    """The display form of section 7.5. `names` maps a function index to a name."""
    return _render(value, names, [])


ESCAPES = {0x5C: b"\\\\", 0x22: b'\\"', 0x0A: b"\\n", 0x0D: b"\\r", 0x09: b"\\t"}


def quote(data: bytes) -> bytes:
    """A string literal in the canonical escaping of sections 7.5 and 11."""
    out = bytearray(b'"')
    for byte in data:
        escaped = ESCAPES.get(byte)
        if escaped is not None:
            out += escaped
        elif byte < 0x20 or byte > 0x7E:
            out += b"\\x%02x" % byte
        else:
            out.append(byte)
    out += b'"'
    return bytes(out)


def _render(value, names, path) -> bytes:
    if value is None:
        return b"nil"
    if value is True:
        return b"true"
    if value is False:
        return b"false"
    if isinstance(value, int):
        return str(value).encode("ascii")
    if isinstance(value, Str):
        return value.data
    if isinstance(value, Closure):
        return b"<fn " + names[value.function] + b">"
    for seen in path:
        if seen is value:
            return b"[...]"
    path.append(value)
    parts = [_render(item, names, path) for item in value.items]
    path.pop()
    return b"[" + b", ".join(parts) + b"]"
