# The pattern dialect of SPEC.md section 4, parsed in one left-to-right pass.
#
# One pass is not an optimisation: section 7 defines the reported error as the
# one a single left-to-right parse reaches first, so `[z-a` is an out-of-order
# range and not an unterminated class. Anything that looked ahead, or that
# collected several diagnostics and ranked them, would report the wrong one.
#
# A node is a tuple whose first element names its shape:
#
#   ("empty",)                      matches the empty string
#   ("char", cp)                    one code point
#   ("any",)                        any code point except U+000A
#   ("class", negated, ranges)      membership is `in ranges` XOR negated
#   ("assert", kind)                bol, eol, wordb or nwordb
#   ("group", gid_or_None, body)    gid is None for a non-capturing group
#   ("cat", [node, ...])
#   ("alt", [node, ...])
#   ("rep", body, m, n_or_None, greedy)

from errors import RegexError

MAX_REPEAT = 1000

METACHARS = set("\\.[](){}*+?|^$")

# Section 4.3: the escapes that stand for one literal code point.
_LITERAL_ESCAPES = set("\\.[](){}*+?|^$-/")
_CONTROL_ESCAPES = {"n": 0x0A, "t": 0x09, "r": 0x0D, "f": 0x0C, "v": 0x0B, "0": 0x00}
_HEXDIGITS = set("0123456789abcdefABCDEF")

MAX_CODE_POINT = 0x10FFFF

# Section 6.2. Each set is stated as sorted, disjoint, non-adjacent ranges, so
# the shorthands themselves need no further work to be dumpable.
DIGIT_RANGES = [(0x30, 0x39)]
WORD_RANGES = [(0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A)]
SPACE_RANGES = [(0x09, 0x0D), (0x20, 0x20)]

_SHORTHAND = {
    "d": (DIGIT_RANGES, False),
    "D": (DIGIT_RANGES, True),
    "w": (WORD_RANGES, False),
    "W": (WORD_RANGES, True),
    "s": (SPACE_RANGES, False),
    "S": (SPACE_RANGES, True),
}


def merge_ranges(ranges):
    """Sorted, disjoint, non-adjacent ranges covering the same code points."""
    if not ranges:
        return []
    out = []
    for lo, hi in sorted(ranges):
        if out and lo <= out[-1][1] + 1:
            if hi > out[-1][1]:
                out[-1] = (out[-1][0], hi)
        else:
            out.append((lo, hi))
    return [tuple(item) for item in out]


def complement_ranges(ranges):
    """Every code point the argument does not cover, as merged ranges."""
    out = []
    cursor = 0
    for lo, hi in merge_ranges(ranges):
        if lo > cursor:
            out.append((cursor, lo - 1))
        cursor = max(cursor, hi + 1)
    if cursor <= MAX_CODE_POINT:
        out.append((cursor, MAX_CODE_POINT))
    return out


class Parser:
    """One pattern, parsed to the node tree above."""

    def __init__(self, pattern: str):
        self.p = pattern
        self.i = 0
        self.groups = 0

    def parse(self):
        node = self._alternation()
        if self.i < len(self.p):
            # `_concat` stops only at `|` or `)`, and `_alternation` consumes
            # every `|`, so the one character that can be left is a `)` with no
            # opening partner.
            raise RegexError("unbalanced-paren", self.i)
        return node, self.groups

    # -- grammar --------------------------------------------------------

    def _alternation(self):
        branches = [self._concat()]
        while self.i < len(self.p) and self.p[self.i] == "|":
            self.i += 1
            branches.append(self._concat())
        if len(branches) == 1:
            return branches[0]
        return ("alt", branches)

    def _concat(self):
        terms = []
        # Index in `terms` of the atom a quantifier would bind to, or None
        # when there is none: at the start, after `|`, after `(`, after an
        # assertion, and directly after a quantifier.
        target = None
        while self.i < len(self.p):
            ch = self.p[self.i]
            if ch == "|" or ch == ")":
                break
            start = self.i
            if ch in "*+?{":
                bound = self._quantifier()
                if bound is None:
                    # A `{` that does not begin a well-formed bound is a
                    # literal-free error, not a quantifier.
                    raise RegexError("bad-repeat", start)
                low, high, greedy = bound
                if target is None:
                    raise RegexError("nothing-to-repeat", start)
                terms[target] = ("rep", terms[target], low, high, greedy)
                target = None
                continue
            if ch == "}":
                raise RegexError("bad-repeat", start)
            if ch == "]":
                raise RegexError("unexpected-bracket", start)
            node, quantifiable = self._atom()
            terms.append(node)
            target = len(terms) - 1 if quantifiable else None
        if not terms:
            return ("empty",)
        if len(terms) == 1:
            return terms[0]
        return ("cat", terms)

    def _quantifier(self):
        """The quantifier at the cursor, or None when `{` opens no bound."""
        ch = self.p[self.i]
        if ch == "*":
            self.i += 1
            low, high = 0, None
        elif ch == "+":
            self.i += 1
            low, high = 1, None
        elif ch == "?":
            self.i += 1
            low, high = 0, 1
        else:
            bound = self._bound()
            if bound is None:
                return None
            low, high = bound
        greedy = True
        if self.i < len(self.p) and self.p[self.i] == "?":
            self.i += 1
            greedy = False
        return low, high, greedy

    def _bound(self):
        """`{m}`, `{m,}` or `{m,n}` at the cursor, consumed, or None."""
        start = self.i
        i = self.i + 1
        digits = ""
        while i < len(self.p) and self.p[i].isdigit() and self.p[i].isascii():
            digits += self.p[i]
            i += 1
        if not digits:
            return None
        if i < len(self.p) and self.p[i] == "}":
            low = high = int(digits)
            i += 1
        elif i < len(self.p) and self.p[i] == ",":
            i += 1
            tail = ""
            while i < len(self.p) and self.p[i].isdigit() and self.p[i].isascii():
                tail += self.p[i]
                i += 1
            if i >= len(self.p) or self.p[i] != "}":
                return None
            i += 1
            low = int(digits)
            high = int(tail) if tail else None
        else:
            return None
        if low > MAX_REPEAT or (high is not None and high > MAX_REPEAT):
            raise RegexError("repeat-too-large", start)
        if high is not None and high < low:
            raise RegexError("bad-repeat", start)
        self.i = i
        return low, high

    def _atom(self):
        """One atom, and whether a quantifier may bind to it."""
        start = self.i
        ch = self.p[self.i]
        if ch == "(":
            return self._group(), True
        if ch == "[":
            return self._class(), True
        if ch == ".":
            self.i += 1
            return ("any",), True
        if ch == "^":
            self.i += 1
            return ("assert", "bol"), False
        if ch == "$":
            self.i += 1
            return ("assert", "eol"), False
        if ch == "\\":
            return self._escape_atom()
        self.i += 1
        return ("char", ord(ch)), True

    def _group(self):
        start = self.i
        self.i += 1
        gid = None
        if self.i < len(self.p) and self.p[self.i] == "?":
            if self.i + 1 < len(self.p) and self.p[self.i + 1] == ":":
                self.i += 2
            else:
                raise RegexError("unsupported-group", start)
        else:
            self.groups += 1
            gid = self.groups
        body = self._alternation()
        if self.i >= len(self.p) or self.p[self.i] != ")":
            raise RegexError("unbalanced-paren", start)
        self.i += 1
        return ("group", gid, body)

    def _escape_atom(self):
        start = self.i
        if start + 1 >= len(self.p):
            raise RegexError("trailing-backslash", start)
        nxt = self.p[start + 1]
        if nxt == "b":
            self.i += 2
            return ("assert", "wordb"), False
        if nxt == "B":
            self.i += 2
            return ("assert", "nwordb"), False
        kind, payload = self._escape_body(start)
        if kind == "single":
            return ("char", payload), True
        ranges, negated = payload
        return ("class", negated, list(ranges)), True

    def _escape_body(self, start):
        """The escape at `start`, consumed.

        Returns ``("single", cp)`` for the escapes that stand for one code
        point and ``("set", (ranges, negated))`` for the six shorthand classes.
        `\\b` and `\\B` are assertions and never reach here.
        """
        if start + 1 >= len(self.p):
            raise RegexError("trailing-backslash", start)
        nxt = self.p[start + 1]
        if nxt in _LITERAL_ESCAPES:
            self.i = start + 2
            return "single", ord(nxt)
        if nxt in _CONTROL_ESCAPES:
            self.i = start + 2
            return "single", _CONTROL_ESCAPES[nxt]
        if nxt == "x":
            if (
                start + 3 >= len(self.p)
                or self.p[start + 2] not in _HEXDIGITS
                or self.p[start + 3] not in _HEXDIGITS
            ):
                raise RegexError("bad-escape", start)
            self.i = start + 4
            return "single", int(self.p[start + 2 : start + 4], 16)
        if nxt in _SHORTHAND:
            self.i = start + 2
            return "set", _SHORTHAND[nxt]
        raise RegexError("bad-escape", start)

    # -- character classes ----------------------------------------------

    def _class(self):
        start = self.i
        i = start + 1
        negated = False
        if i < len(self.p) and self.p[i] == "^":
            negated = True
            i += 1
        if i >= len(self.p):
            raise RegexError("unterminated-class", start)
        if self.p[i] == "]":
            raise RegexError("empty-class", start)
        self.i = i
        # Every item's ranges, in the order the class states them; section 9.2
        # asks for one sorted, disjoint, merged list, which `merge_ranges`
        # produces at the end.
        collected = []
        # Where in `collected` the single code point sits that a following `-`
        # would turn into a range, or None when the previous item cannot be a
        # range endpoint.
        pending = None
        while True:
            if self.i >= len(self.p):
                raise RegexError("unterminated-class", start)
            ch = self.p[self.i]
            if ch == "]":
                self.i += 1
                break
            if (
                ch == "-"
                and pending is not None
                and self.i + 1 < len(self.p)
                and self.p[self.i + 1] != "]"
            ):
                dash = self.i
                self.i += 1
                kind, payload, where = self._class_item()
                if kind != "single":
                    # A shorthand class is an item but never a range endpoint.
                    raise RegexError("bad-escape", where)
                low = collected[pending][0]
                if payload < low:
                    raise RegexError("class-range-out-of-order", dash)
                # The range replaces the single item that opened it.
                collected[pending] = (low, payload)
                pending = None
                continue
            kind, payload, where = self._class_item()
            if kind == "single":
                pending = len(collected)
                collected.append((payload, payload))
            else:
                ranges, item_negated = payload
                collected.extend(
                    complement_ranges(ranges) if item_negated else list(ranges)
                )
                pending = None
        return ("class", negated, merge_ranges(collected))

    def _class_item(self):
        """One class item, as ``(kind, payload, position)``.

        `kind` is `"single"` with a code point payload, or `"set"` with a
        ``(ranges, negated)`` payload for one of the six shorthand classes.
        The position is where the item starts, which is what the caller needs
        to raise `bad-escape` at the backslash when a shorthand turns out to
        be a range endpoint.
        """
        start = self.i
        ch = self.p[start]
        if ch == "\\":
            if start + 1 >= len(self.p):
                raise RegexError("trailing-backslash", start)
            if self.p[start + 1] in ("b", "B"):
                # Inside a class these are not assertions and not a backspace.
                raise RegexError("bad-escape", start)
            kind, payload = self._escape_body(start)
            return kind, payload, start
        self.i += 1
        return "single", ord(ch), start
