# The error codes and exit statuses of SPEC.md section 10.
#
# One exception type carries both, so every failure path writes the same
# `error: <CODE>` line and exits with the status the table gives that code.

EXIT_STATUS = {
    "E_USAGE": 1,
    "E_ASM": 2,
    "E_BAD_CODE": 3,
    "E_TYPE": 4,
    "E_DIV_ZERO": 4,
    "E_RANGE": 4,
    "E_VALUE": 4,
    "E_UNDEF_GLOBAL": 4,
    "E_ARITY": 4,
    "E_UNDERFLOW": 4,
    "E_ASSERT": 4,
    "E_STACK_OVERFLOW": 5,
    "E_OOM": 6,
}


class SvmError(Exception):
    """Any failure the harness reports as one `error:` line."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(code if not detail else "%s: %s" % (code, detail))
        self.code = code
        self.detail = detail

    @property
    def status(self) -> int:
        return EXIT_STATUS[self.code]

    def line(self) -> str:
        if self.detail:
            return "error: %s: %s" % (self.code, self.detail)
        return "error: %s" % self.code
