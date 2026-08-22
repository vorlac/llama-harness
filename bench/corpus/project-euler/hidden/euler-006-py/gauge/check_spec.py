import ast
import contextlib
import io
import os
import time
import unittest

import src.solvers  # noqa: F401
from src.cli import main
from src.registry import get, names

TARGET = 'p006'
ANSWER = 25164150
WORKED = {'count_divisors': 24, 'sum_of_squares': 385}
BUDGET_SEC = 60

# The package the work happens in. Every module under it is read, not only the
# target: an answer parked in a module of its own and imported back is the
# answer written down with one extra file in front of it.
PACKAGE_DIR = "src"

# What a module under src may import. Everything that reaches outside this
# process for a value is absent, which is the other half of "computes the
# answer rather than reading it from anywhere". The seeded command line needs
# sys and time, so both are here.
ALLOWED_IMPORTS = (
    "array", "bisect", "cmath", "collections", "decimal", "fractions",
    "functools", "heapq", "itertools", "math", "operator", "random",
    "re", "statistics", "string", "sys", "time",
)

# Builtins that fetch a value from outside the module's own text.
FORBIDDEN_CALLS = ("open", "input", "eval", "exec", "compile", "__import__")

# A folded value longer than this is not an answer to any problem in this set,
# and folding on past it is how a check spends a minute on `10 ** 10 ** 9`.
MAX_FOLD_DIGITS = 64


def _apply(op, left, right):
    """One binary operator over two folded operands, or None."""
    if isinstance(left, str) or isinstance(right, str):
        if isinstance(op, ast.Add) and isinstance(left, str) and isinstance(right, str):
            return left + right
        return None
    if isinstance(op, (ast.Pow, ast.LShift)) and (
        abs(right) > 1024 or len(str(abs(left))) > 32
    ):
        return None
    table = {
        ast.Add: lambda a, b: a + b,
        ast.Sub: lambda a, b: a - b,
        ast.Mult: lambda a, b: a * b,
        ast.FloorDiv: lambda a, b: a // b,
        ast.Mod: lambda a, b: a % b,
        ast.Pow: lambda a, b: a ** b,
        ast.LShift: lambda a, b: a << b,
        ast.RShift: lambda a, b: a >> b,
        ast.BitOr: lambda a, b: a | b,
        ast.BitAnd: lambda a, b: a & b,
        ast.BitXor: lambda a, b: a ^ b,
    }
    for kind in table:
        if isinstance(op, kind):
            try:
                return table[kind](left, right)
            except (ArithmeticError, TypeError, ValueError):
                return None
    return None


def _fold(node, env):
    """What one expression comes to, when its whole text decides it.

    `233168` and `233000 + 168` and `int("2331" + "68")` are the same claim
    written three ways, and a check that reads only the first fails a solver
    that is doing the work while scoring one that recalled the number.
    """
    if isinstance(node, ast.Constant):
        value = node.value
        if isinstance(value, bool):
            return None
        return value if isinstance(value, (int, str)) else None
    if isinstance(node, ast.Name):
        return env.get(node.id)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _fold(node.operand, env)
        if not isinstance(value, int):
            return None
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp):
        left = _fold(node.left, env)
        right = _fold(node.right, env)
        if left is None or right is None:
            return None
        return _cap(_apply(node.op, left, right))
    if isinstance(node, ast.Call):
        return _fold_call(node, env)
    if isinstance(node, ast.JoinedStr):
        parts = []
        for piece in node.values:
            if isinstance(piece, ast.Constant) and isinstance(piece.value, str):
                parts.append(piece.value)
            elif isinstance(piece, ast.FormattedValue) and piece.format_spec is None:
                inner = _fold(piece.value, env)
                if inner is None:
                    return None
                parts.append(str(inner))
            else:
                return None
        return _cap("".join(parts))
    return None


def _fold_call(node, env):
    """`int(...)`, `str(...)`, `abs(...)` and `sum(...)` over folded arguments."""
    if not isinstance(node.func, ast.Name) or node.keywords:
        return None
    name = node.func.id
    if name in ("int", "str", "abs") and len(node.args) == 1:
        value = _fold(node.args[0], env)
        if value is None:
            return None
        try:
            return _cap({"int": int, "str": str, "abs": abs}[name](value))
        except (TypeError, ValueError):
            return None
    if name == "sum" and len(node.args) == 1:
        items = node.args[0]
        if not isinstance(items, (ast.List, ast.Tuple)):
            return None
        total = 0
        for item in items.elts:
            value = _fold(item, env)
            if not isinstance(value, int):
                return None
            total += value
        return _cap(total)
    return None


def _cap(value):
    """A folded value, or None when it has grown past anything this compares."""
    if value is None:
        return None
    return value if len(str(value)) <= MAX_FOLD_DIGITS else None


def _bindings(tree):
    """Module and function names bound once to something that folds.

    A name assigned twice is dropped rather than guessed at, so `high + low`
    folds only when both halves are written down exactly once.
    """
    env = {}
    dropped = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if node.value is None:
            continue
        value = _fold(node.value, env)
        for target in targets:
            if not isinstance(target, ast.Name):
                continue
            if target.id in env or target.id in dropped:
                env.pop(target.id, None)
                dropped.add(target.id)
            elif value is not None:
                env[target.id] = value
    return env


def _written_values(path):
    """Every value one module's own text comes to, as text."""
    with open(path, "rb") as handle:
        tree = ast.parse(handle.read())
    env = _bindings(tree)
    out = [str(value) for value in env.values()]
    for node in ast.walk(tree):
        if isinstance(node, (ast.Constant, ast.BinOp, ast.UnaryOp, ast.Call, ast.JoinedStr)):
            value = _fold(node, env)
            if value is not None:
                out.append(str(value))
    return out


def _outside_reads(path):
    """Every way one module reaches outside its own text for a value."""
    with open(path, "rb") as handle:
        tree = ast.parse(handle.read())
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root != PACKAGE_DIR and root not in ALLOWED_IMPORTS:
                    found.append("import %s" % alias.name)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if node.level or (root != PACKAGE_DIR and root not in ALLOWED_IMPORTS):
                found.append("from %s import ..." % (node.module or "."))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FORBIDDEN_CALLS:
                found.append("%s(...)" % node.func.id)
    return found


def _package_modules():
    """Every module under src, in a stable order."""
    out = []
    for base, _, files in os.walk(PACKAGE_DIR):
        for name in files:
            if name.endswith(".py"):
                out.append(os.path.join(base, name))
    return sorted(out)


class SpecTests(unittest.TestCase):
    def test_the_collection_is_the_worked_solvers_plus_the_target(self):
        self.assertEqual(names(), sorted(list(WORKED) + [TARGET]))

    def test_the_target_solver_answers_inside_the_budget(self):
        started = time.time()
        answer = get(TARGET)()
        elapsed = time.time() - started
        self.assertEqual(answer, ANSWER, TARGET)
        self.assertLess(elapsed, float(BUDGET_SEC), "%s took %.1fs" % (TARGET, elapsed))

    def test_the_worked_solvers_still_answer(self):
        for name in sorted(WORKED):
            self.assertEqual(get(name)(), WORKED[name], name)

    def test_the_target_module_registers_itself_under_its_own_name(self):
        module = __import__("src.solvers." + TARGET, fromlist=["solve"])
        self.assertTrue(hasattr(module, "solve"), TARGET)
        self.assertIs(get(TARGET), module.solve, TARGET)

    def test_the_answer_is_computed_rather_than_written_down(self):
        written = str(ANSWER)
        modules = _package_modules()
        self.assertTrue(modules, PACKAGE_DIR)
        for path in modules:
            for value in _written_values(path):
                self.assertNotEqual(
                    value,
                    written,
                    "%s writes the answer down: %s" % (path, TARGET),
                )

    def test_the_answer_is_computed_rather_than_read_from_anywhere(self):
        for path in _package_modules():
            self.assertEqual(
                _outside_reads(path),
                [],
                "%s reaches outside itself for a value" % path,
            )

    def test_run_all_covers_the_collection(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = main(["run", "all"])
        self.assertEqual(code, 0)
        lines = buffer.getvalue().strip().splitlines()
        expected = dict(WORKED)
        expected[TARGET] = ANSWER
        self.assertEqual(len(lines), len(expected))
        for line, name in zip(lines, sorted(expected)):
            self.assertRegex(line, r"^%s %d \d+ms$" % (name, expected[name]))


if __name__ == "__main__":
    unittest.main()
