import contextlib
import io
import unittest

import src.solvers  # noqa: F401
from src.cli import main
from src.registry import get, names


class VisibleTests(unittest.TestCase):
    def test_the_worked_solvers_answer(self):
        self.assertEqual(get("sum_of_squares")(), 385)
        self.assertEqual(get("count_divisors")(), 24)

    def test_the_cli_lists_what_is_registered(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = main(["list"])
        self.assertEqual(code, 0)
        self.assertEqual(buffer.getvalue().split(), names())


if __name__ == "__main__":
    unittest.main()
