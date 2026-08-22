# The two shared value routines: the integer parser of SPEC.md section 5 and
# the glob matcher of section 9.
#
# Both are byte-oriented and total. `STRICT_INT64` is the only integer parser in
# the server, at every call site, which is what makes `01`, `-0`, `+1` and a
# trailing newline behave identically wherever they appear.

INT64_MIN = -(2 ** 63)
INT64_MAX = 2 ** 63 - 1

ZERO = 0x30
NINE = 0x39
MINUS = 0x2D


def strict_int64(text: bytes):
    """The int the argument denotes, or None. Section 5, transcribed."""
    if not text:
        return None
    index = 0
    negative = False
    if text[0] == MINUS:
        negative = True
        index = 1
        if len(text) == 1:
            return None
    if text[index] == ZERO:
        if index + 1 != len(text) or negative:
            return None
        return 0
    if not ZERO < text[index] <= NINE:
        return None
    value = 0
    while index < len(text):
        digit = text[index]
        if not ZERO <= digit <= NINE:
            return None
        value = value * 10 + (digit - ZERO)
        if value > 2 ** 64 - 1:
            return None
        index += 1
    if negative:
        if value > 2 ** 63:
            return None
        return -value
    if value > INT64_MAX:
        return None
    return value


def render_int(value: int) -> bytes:
    """The canonical decimal rendering a stored integer takes."""
    return str(value).encode("ascii")


def glob_match(pattern: bytes, subject: bytes) -> bool:
    """Section 9, on raw bytes, with no anchoring: the whole subject is consumed."""
    return _match(pattern, 0, subject, 0)


def _match(pattern: bytes, p: int, subject: bytes, s: int) -> bool:
    while p < len(pattern):
        byte = pattern[p]
        if byte == 0x2A:  # '*'
            while p + 1 < len(pattern) and pattern[p + 1] == 0x2A:
                p += 1
            if p + 1 == len(pattern):
                return True
            for skip in range(s, len(subject) + 1):
                if _match(pattern, p + 1, subject, skip):
                    return True
            return False
        if byte == 0x3F:  # '?'
            if s >= len(subject):
                return False
            p += 1
            s += 1
            continue
        if byte == 0x5B:  # '['
            if s >= len(subject):
                return False
            p += 1
            negate = p < len(pattern) and pattern[p] == 0x5E
            if negate:
                p += 1
            hit = False
            while True:
                if p >= len(pattern):
                    # A class with no closing bracket extends to the end.
                    break
                if pattern[p] == 0x5C and p + 1 < len(pattern):
                    if pattern[p + 1] == subject[s]:
                        hit = True
                    p += 2
                    continue
                if pattern[p] == 0x5D:  # ']'
                    p += 1
                    break
                if (
                    p + 2 < len(pattern)
                    and pattern[p + 1] == 0x2D
                    and pattern[p + 2] != 0x5D
                ):
                    low, high = pattern[p], pattern[p + 2]
                    if low > high:
                        low, high = high, low
                    if low <= subject[s] <= high:
                        hit = True
                    p += 3
                    continue
                if pattern[p] == subject[s]:
                    hit = True
                p += 1
            if hit == negate:
                return False
            s += 1
            continue
        if byte == 0x5C and p + 1 < len(pattern):
            p += 1
            byte = pattern[p]
        if s >= len(subject) or subject[s] != byte:
            return False
        p += 1
        s += 1
    return s == len(subject)
