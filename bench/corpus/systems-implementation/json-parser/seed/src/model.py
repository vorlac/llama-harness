# The in-memory value a parsed document becomes.
#
# A JSON number is carried as an exact decimal - a sign, a digit string and a
# decimal exponent - and never as a binary float. SPEC.md section 6.3 requires
# it: 1e400 has no double, 9007199254740993 has no double distinct from its
# neighbour, and a forty-digit integer loses digits the moment it becomes one.

class Null:
    """The JSON null. A singleton, because Python's None is also 'absent'."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self):
        return "null"


NULL = Null()


class Number:
    """An exact decimal: value = (-1 if neg) * int(digits) * 10 ** exp.

    `digits` is a non-empty run of decimal digits with no sign. Zero keeps its
    sign, because SPEC.md section 6.4 emits -0 for a negative zero.
    """

    __slots__ = ("neg", "digits", "exp")

    def __init__(self, neg, digits, exp):
        self.neg = neg
        self.digits = digits
        self.exp = exp

    def __repr__(self):
        return "Number(%s%s e%s)" % ("-" if self.neg else "", self.digits, self.exp)
