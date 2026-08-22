#!/usr/bin/env python3
"""Emit the Project Euler bench task set from the corpus answer key.

The generated artefacts are bench/corpus-euler.json (the manifest
scripts/conductor_bench.py loads with --manifest) and the seed and gauge trees
under bench/corpus/project-euler/ that the manifest's seedDir and hiddenDir
fields name. Both are committed, and both are reproducible from this script
plus the inputs below, so a review of the set is a review of this file rather
than of twenty near-identical JSON blocks.

Three inputs, all of them beside the output under bench/corpus/project-euler:

  expected-answers.json   copied from the source corpus. A null value there
                          means the answer was never verified, and the corpus
                          is explicit that guessing one silently corrupts every
                          run compared against it. No task is emitted for one.
  restatements.json       authored in this repository. It supplies the question
                          each task asks, in this repository's own words, and a
                          stated reason for every answerable problem that gets
                          no task.
  hard-subset.json        copied from the source corpus. It marks the problems
                          a direct loop cannot finish, and a task that is on it
                          says so in its own rationale.

What is deliberately NOT an input is project-euler/problems/. Project Euler
statement text, the images some problems embed and the data files a few of them
ship are copyright Project Euler; the source corpus fetches them and gitignores
them, and mirroring them into a committed bench manifest would redistribute
them. So the generator never opens a statement, produces byte-identical output
on a machine that has fetched none, and refuses any problem whose question this
repository has not written for itself. `--audit-statements` is the one mode
that reads them, it writes nothing, and it exists to catch a restatement that
reproduces the prose it was supposed to replace.

The output is deterministic: tasks in ascending problem order, file maps walked
in sorted order, two-space JSON indent, no timestamp and no host detail
anywhere. Running it twice over the same inputs writes the same bytes, which is
what `--check` verifies without writing.

Usage::

    /usr/bin/python3 scripts/generate_euler_tasks.py
    /usr/bin/python3 scripts/generate_euler_tasks.py --check
    /usr/bin/python3 scripts/generate_euler_tasks.py \
        --audit-statements ../llama-harness-test-results/project-euler/problems
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent

# The generator owns exactly these paths and rewrites them wholesale.
CORPUS_DIR = REPO_ROOT / "bench" / "corpus" / "project-euler"
MANIFEST_PATH = REPO_ROOT / "bench" / "corpus-euler.json"
SEED_DIRNAME = "seed"
HIDDEN_DIRNAME = "hidden"

ANSWERS_FILENAME = "expected-answers.json"
RESTATEMENTS_FILENAME = "restatements.json"
HARD_SUBSET_FILENAME = "hard-subset.json"

# The one model this repository serves.
MODEL = "llamacpp/qwen3.8-27b"

# Scope, not mathematics. A tier in this harness says how much a plan has to
# decompose into and how deep its dependency chain runs, and one Euler problem
# is one module plus one import line however hard the number theory is. Every
# generated task is therefore the same tier, and the manifest says so rather
# than spreading the set across tiers on a difficulty signal the tier ladder
# does not measure.
TIER = "T1"

# The two worked solvers every seed carries. Neither is a Project Euler
# problem, which is what lets the set cover problems 1 and 2 as well: no seeded
# work tree contains any Euler answer, for any task, ever.
EXAMPLE_ANSWERS = {"count_divisors": 24, "sum_of_squares": 385}

# Matches the corpus's own per-run budget. Declared in every prompt, so a run
# that blows it fails a requirement it was told about.
SOLVE_BUDGET_SEC = 60

# What a module under src/ may import. Everything that reaches outside the
# process for a value is absent, which is the enforceable half of "computes the
# answer rather than reading it from anywhere". The seeded command line needs
# sys and time, so both are here. The gauge holds modules to this list and the
# prompt states it, so no run is graded on a rule it was not told.
ALLOWED_IMPORT_MODULES = (
    "array", "bisect", "cmath", "collections", "decimal", "fractions",
    "functools", "heapq", "itertools", "math", "operator", "random", "re",
    "statistics", "string", "sys", "time",
)

# The longest run of consecutive words a restatement may share with the
# statement it replaces. A question of this length is fifteen or twenty words,
# so a verbatim copy scores its whole length; ten leaves room for the shared
# function words and the numeric bounds that any faithful restatement keeps.
MAX_SHARED_WORDS = 10

STATEMENT_PATTERN = "problem-%03d-challenge.md"


class GeneratorError(Exception):
    """A refusal that names what is wrong with the inputs."""


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


def _read_json(path: Path, what: str) -> Any:
    try:
        raw = path.read_text()
    except OSError as exc:
        raise GeneratorError("cannot read the %s at %s: %s" % (what, path, exc))
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise GeneratorError("%s is not valid JSON: %s" % (path, exc))


def load_answers(path: Path) -> Dict[int, int]:
    """The verified answers, keyed by problem number.

    A null entry is unverified and is dropped here rather than defaulted, and a
    value that is not a run of decimal digits is a refusal: the gauge compares
    against an int, and a string that silently failed to convert would fail
    every arm for a reason that has nothing to do with the arm.
    """
    document = _read_json(path, "answer key")
    if not isinstance(document, dict):
        raise GeneratorError("%s must hold a JSON object" % path)
    answers = document.get("answers")
    if not isinstance(answers, dict) or not answers:
        raise GeneratorError("%s: 'answers' must be a non-empty object" % path)
    out: Dict[int, int] = {}
    for key in sorted(answers):
        if not key.startswith("euler-"):
            raise GeneratorError(
                "%s: answer key %r is not of the form euler-NNN" % (path, key)
            )
        digits = key[len("euler-"):]
        if not digits.isdigit():
            raise GeneratorError(
                "%s: answer key %r does not end in a problem number" % (path, key)
            )
        value = answers[key]
        if value is None:
            continue
        if not isinstance(value, str) or not value.isdigit():
            raise GeneratorError(
                "%s: the answer for %s is %r, which is not a run of decimal digits"
                % (path, key, value)
            )
        out[int(digits)] = int(value)
    if not out:
        raise GeneratorError("%s holds no verified answer" % path)
    return out


def load_restatements(path: Path) -> Dict[int, Dict[str, str]]:
    """The authored question, or the stated reason there is none, per problem."""
    document = _read_json(path, "restatement side-car")
    if not isinstance(document, dict):
        raise GeneratorError("%s must hold a JSON object" % path)
    problems = document.get("problems")
    if not isinstance(problems, dict) or not problems:
        raise GeneratorError("%s: 'problems' must be a non-empty object" % path)
    out: Dict[int, Dict[str, str]] = {}
    for key in sorted(problems):
        if not key.isdigit():
            raise GeneratorError(
                "%s: entry key %r is not a problem number" % (path, key)
            )
        entry = problems[key]
        if not isinstance(entry, dict):
            raise GeneratorError("%s: entry %s is not an object" % (path, key))
        title = entry.get("title")
        if not isinstance(title, str) or not title.strip():
            raise GeneratorError("%s: entry %s has no title" % (path, key))
        has_question = "question" in entry
        has_omitted = "omitted" in entry
        if has_question == has_omitted:
            raise GeneratorError(
                "%s: entry %s must carry exactly one of 'question' and 'omitted'"
                % (path, key)
            )
        field = "question" if has_question else "omitted"
        text = entry[field]
        if not isinstance(text, str) or not text.strip():
            raise GeneratorError(
                "%s: entry %s has an empty %r" % (path, key, field)
            )
        out[int(key)] = {"title": title.strip(), field: text.strip()}
    return out


def load_hard_subset(path: Path) -> Dict[int, str]:
    """The corpus's brute-force-proof list, keyed by problem number."""
    document = _read_json(path, "hard subset")
    if not isinstance(document, dict):
        raise GeneratorError("%s must hold a JSON object" % path)
    problems = document.get("problems")
    if not isinstance(problems, list) or not problems:
        raise GeneratorError("%s: 'problems' must be a non-empty array" % path)
    out: Dict[int, str] = {}
    for entry in problems:
        if not isinstance(entry, dict):
            raise GeneratorError("%s: a 'problems' entry is not an object" % path)
        number = entry.get("number")
        insight = entry.get("insight")
        if not isinstance(number, int) or isinstance(number, bool):
            raise GeneratorError("%s: a 'problems' entry has no number" % path)
        if not isinstance(insight, str) or not insight.strip():
            raise GeneratorError(
                "%s: problem %s carries no insight" % (path, number)
            )
        out[number] = insight.strip()
    return out


def reconcile(
    answers: Dict[int, int], restatements: Dict[int, Dict[str, str]]
) -> Tuple[List[int], List[Tuple[int, str]]]:
    """Split the verified problems into emitted and deliberately-omitted.

    A verified answer with no side-car entry at all is the drift this function
    exists to catch: it means the answer key gained a problem and nobody
    decided what to do about it, which would otherwise show up as a task set
    that is quietly smaller than the key it was built from.
    """
    unstated = sorted(number for number in answers if number not in restatements)
    if unstated:
        raise GeneratorError(
            "the answer key verifies %s but the restatement side-car states "
            "neither a question nor an omission reason for %s"
            % (
                ", ".join("problem %d" % n for n in unstated),
                "it" if len(unstated) == 1 else "them",
            )
        )
    stray = sorted(number for number in restatements if number not in answers)
    if stray:
        raise GeneratorError(
            "the restatement side-car covers %s, which the answer key does not "
            "verify; a task cannot be scored against an unverified answer"
            % ", ".join("problem %d" % n for n in stray)
        )
    emitted = sorted(n for n in answers if "question" in restatements[n])
    omitted = [
        (n, restatements[n]["omitted"])
        for n in sorted(answers)
        if "omitted" in restatements[n]
    ]
    return emitted, omitted


# ---------------------------------------------------------------------------
# The seed tree
# ---------------------------------------------------------------------------

REGISTRY_PY = '''"""The solver registry: one common interface every solver is reached through."""

_SOLVERS = {}


def register(name, solve):
    if name in _SOLVERS:
        raise ValueError("solver %r is already registered" % name)
    _SOLVERS[name] = solve


def get(name):
    if name not in _SOLVERS:
        raise KeyError(name)
    return _SOLVERS[name]


def names():
    return sorted(_SOLVERS)
'''

CLI_PY = '''"""The command line over the solver registry."""

import sys
import time

import src.solvers  # noqa: F401
from src.registry import get, names


def main(argv):
    if not argv:
        sys.stdout.write("usage: list | run <name|all>\\n")
        return 2
    if argv[0] == "list":
        for name in names():
            sys.stdout.write("%s\\n" % name)
        return 0
    if argv[0] == "run" and len(argv) == 2:
        wanted = names() if argv[1] == "all" else [argv[1]]
        for name in wanted:
            try:
                solve = get(name)
            except KeyError:
                sys.stdout.write("no such solver: %s\\n" % name)
                return 2
            started = time.time()
            answer = solve()
            elapsed = int(round((time.time() - started) * 1000.0))
            sys.stdout.write("%s %s %dms\\n" % (name, answer, elapsed))
        return 0
    sys.stdout.write("usage: list | run <name|all>\\n")
    return 2
'''

RUN_TESTS_PY = '''#!/usr/bin/env python3
"""Run every check_*.py in one directory against the checkout at the cwd.

Loaded by path rather than by unittest discovery: discovery would require the
test directory to be an importable package, and a missing __init__.py there
would look exactly like a failing suite.
"""

import importlib.util
import os
import sys
import unittest

def main(directory):
    sys.path.insert(0, os.getcwd())
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    names = sorted(
        name
        for name in os.listdir(directory)
        if name.startswith("check_") and name.endswith(".py")
    )
    if not names:
        sys.stderr.write("no check_*.py under %s\\n" % directory)
        return 2
    for name in names:
        spec = importlib.util.spec_from_file_location(
            name[:-3], os.path.join(directory, name)
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        suite.addTests(loader.loadTestsFromModule(module))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.testsRun:
        return 2
    return 0 if result.wasSuccessful() else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
'''

SOLVERS_INIT_PY = "from src.solvers import count_divisors, sum_of_squares  # noqa: F401\n"

SUM_OF_SQUARES_PY = '''from src.registry import register


def solve():
    return sum(n * n for n in range(1, 11))


register("sum_of_squares", solve)
'''

COUNT_DIVISORS_PY = '''from src.registry import register


def solve():
    return sum(1 for n in range(1, 361) if 360 % n == 0)


register("count_divisors", solve)
'''

CHECK_VISIBLE_PY = '''import contextlib
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
'''

SEED_README_MD = """# euler

A collection solver: a registry, one module per problem under `src/solvers/`,
and a command line over both.

- `src/registry.py` holds the registry. `register(name, solve)` refuses a
  duplicate name, `get(name)` raises `KeyError` for a name it does not hold,
  and `names()` returns the registered names sorted.
- A solver module defines `solve()`, which takes no arguments and returns an
  int, and calls `register("<module name>", solve)` at import time under its
  own module name. `src/solvers/sum_of_squares.py` is the shape, in full.
- `src/solvers/__init__.py` imports every solver module, so importing the
  package is what registers the collection.
- `src/cli.py` is `list` and `run <name|all>` over the registry.

Run the suite with `python3 tools/run_tests.py tests`.
"""

SEED_GITIGNORE = "__pycache__/\n*.pyc\n"


def build_seed_files() -> Dict[str, str]:
    """The work tree every generated task starts from, identical for all of them.

    It is identical because the task's whole difference lives in the prompt and
    the gauge: the registry, the command line, the two worked solvers and the
    visible suite are the same repository whichever problem is being asked for.
    One seed tree on disk is therefore the honest representation, and every
    task's seedDir names it.
    """
    return {
        ".gitignore": SEED_GITIGNORE,
        "README.md": SEED_README_MD,
        "src/__init__.py": "",
        "src/cli.py": CLI_PY,
        "src/registry.py": REGISTRY_PY,
        "src/solvers/__init__.py": SOLVERS_INIT_PY,
        "src/solvers/count_divisors.py": COUNT_DIVISORS_PY,
        "src/solvers/sum_of_squares.py": SUM_OF_SQUARES_PY,
        "tests/check_visible.py": CHECK_VISIBLE_PY,
        "tools/run_tests.py": RUN_TESTS_PY,
    }


# ---------------------------------------------------------------------------
# The gauge tree
# ---------------------------------------------------------------------------

CHECK_SPEC_TEMPLATE = '''import ast
import contextlib
import io
import os
import time
import unittest

import src.solvers  # noqa: F401
from src.cli import main
from src.registry import get, names

TARGET = %(target)r
ANSWER = %(answer)d
WORKED = %(worked)s
BUDGET_SEC = %(budget)d

# The package the work happens in. Every module under it is read, not only the
# target: an answer parked in a module of its own and imported back is the
# answer written down with one extra file in front of it.
PACKAGE_DIR = "src"

# What a module under src may import. Everything that reaches outside this
# process for a value is absent, which is the other half of "computes the
# answer rather than reading it from anywhere". The seeded command line needs
# sys and time, so both are here.
ALLOWED_IMPORTS = %(imports_tuple)s

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
        ast.Mod: lambda a, b: a %% b,
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
                    found.append("import %%s" %% alias.name)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if node.level or (root != PACKAGE_DIR and root not in ALLOWED_IMPORTS):
                found.append("from %%s import ..." %% (node.module or "."))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FORBIDDEN_CALLS:
                found.append("%%s(...)" %% node.func.id)
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
        self.assertLess(elapsed, float(BUDGET_SEC), "%%s took %%.1fs" %% (TARGET, elapsed))

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
                    "%%s writes the answer down: %%s" %% (path, TARGET),
                )

    def test_the_answer_is_computed_rather_than_read_from_anywhere(self):
        for path in _package_modules():
            self.assertEqual(
                _outside_reads(path),
                [],
                "%%s reaches outside itself for a value" %% path,
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
            self.assertRegex(line, r"^%%s %%d \\d+ms$" %% (name, expected[name]))


if __name__ == "__main__":
    unittest.main()
'''


def _render_imports() -> str:
    """The allowlist as the gauge's own source, wrapped to stay readable."""
    lines: List[str] = ["("]
    row: List[str] = []
    for name in ALLOWED_IMPORT_MODULES:
        row.append('"%s",' % name)
        if len(" ".join(row)) > 60:
            lines.append("    " + " ".join(row))
            row = []
    if row:
        lines.append("    " + " ".join(row))
    lines.append(")")
    return "\n".join(lines)


def build_gauge_files(number: int, answer: int) -> Dict[str, str]:
    """The measurement for one problem. Never seeded, materialized after the run."""
    worked = "{%s}" % ", ".join(
        "%r: %d" % (name, EXAMPLE_ANSWERS[name]) for name in sorted(EXAMPLE_ANSWERS)
    )
    body = CHECK_SPEC_TEMPLATE % {
        "target": solver_name(number),
        "answer": answer,
        "worked": worked,
        "budget": SOLVE_BUDGET_SEC,
        "imports_tuple": _render_imports(),
    }
    return {"gauge/check_spec.py": body, "gauge/run.py": RUN_TESTS_PY}


# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------


def solver_name(number: int) -> str:
    return "p%03d" % number


def task_id(number: int) -> str:
    return "euler-%03d-py" % number


PROMPT_TEMPLATE = """This package solves Project Euler problems through a registry: one module per problem under src/solvers/, each exporting solve() and registering itself under its own module name. Two worked solvers are there already, sum_of_squares and count_divisors, and src/solvers/sum_of_squares.py is the shape to copy.

Add exactly one module, src/solvers/%(module)s.py, for Project Euler problem %(number)d (%(title)s):

%(question)s

Export solve() taking no arguments and returning an int, and call register("%(module)s", solve) at import time. Add %(module)s to the imports in src/solvers/__init__.py so importing the package registers it. Change nothing in src/registry.py, src/cli.py or the two worked solvers, and add no other module under src/solvers/. tests/check_visible.py must keep passing.

solve() must compute the answer. A module that writes the answer down, or reads it from anywhere, scores nothing even when the value is right, and this is checked by reading every module under src/ as well as by running them. Writing it down covers any expression whose own text decides it, however it is spelled: a literal, a sum of two literals, a string of digits handed to int(), or a constant parked in another module and imported back. Reading it from anywhere covers open(), input(), eval(), exec(), compile() and __import__(); no module under src/ may call one, and none may import anything outside src and these: %(imports)s. Do not call a library routine that answers the problem outright. solve() must return within %(budget)d seconds on one core, so choose the algorithm before you write the loop."""


def build_prompt(number: int, entry: Dict[str, str]) -> str:
    return PROMPT_TEMPLATE % {
        "module": solver_name(number),
        "number": number,
        "title": entry["title"],
        "question": entry["question"],
        "budget": SOLVE_BUDGET_SEC,
        "imports": ", ".join(ALLOWED_IMPORT_MODULES),
    }


def build_rationale(number: int, entry: Dict[str, str], insight: Optional[str]) -> str:
    """Why this problem is in the set, and what it is expected to cost."""
    base = (
        "Project Euler problem %d (%s), scored against the answer the source "
        "corpus verified. One new module plus one import line is the smallest "
        "shape that still crosses two files, and the answer is a single int, "
        "so the tier scores objectively with no rubric in the path."
        % (number, entry["title"])
    )
    if insight is None:
        return base
    return (
        base
        + " The source corpus marks this problem brute-force-proof: %s" % insight
    )


def build_task(
    number: int, answer: int, entry: Dict[str, str], insight: Optional[str]
) -> Dict[str, Any]:
    module = solver_name(number)
    return {
        "id": task_id(number),
        "tier": TIER,
        "mechanism": "none",
        "expectedTrajectory": (
            "the run classifies as work, decomposes to a single item scoping "
            "src/solvers/%s.py and src/solvers/__init__.py, writes a failing "
            "test first, implements, and publishes" % module
        ),
        "expectedStopKinds": ["done", "REPORTED"],
        "language": "python",
        "difficulty": "multi-file",
        "behavioral": True,
        "rationale": build_rationale(number, entry, insight),
        "prompt": build_prompt(number, entry),
        "seedDir": "bench/corpus/project-euler/seed",
        "hiddenDir": "bench/corpus/project-euler/hidden/%s" % task_id(number),
        "hiddenTestCommand": ["/usr/bin/python3", "gauge/run.py", "gauge"],
        "repoTestCommand": ["/usr/bin/python3", "tools/run_tests.py", "tests"],
        "behavioralPaths": ["src/**"],
    }


def build_selection_criteria(
    emitted: Sequence[int],
    omitted: Sequence[Tuple[int, str]],
    hard: Dict[int, str],
) -> Dict[str, str]:
    hard_hits = sorted(n for n in emitted if n in hard)
    return {
        "provenance": (
            "Generated by scripts/generate_euler_tasks.py from "
            "bench/corpus/project-euler/expected-answers.json, which is the "
            "source corpus's answer key copied unchanged, and from "
            "bench/corpus/project-euler/restatements.json, which this "
            "repository authored. Edit those and regenerate; editing this file "
            "by hand puts it out of step with the script that owns it."
        ),
        "whyTheseProblems": (
            "Every Project Euler problem the corpus answer key verifies and "
            "this repository can ask for in its own words: %d of the %d "
            "verified answers. The key leaves the other 174 problems null, and "
            "the corpus is explicit that a guessed reference answer silently "
            "corrupts every run compared against it, so an unverified problem "
            "gets no task." % (len(emitted), len(emitted) + len(omitted))
        ),
        "whatIsOmitted": (
            "%s. Each is answerable and each is left out for a stated reason "
            "recorded beside its answer in restatements.json: the material the "
            "problem operates on is Project Euler's, and this repository does "
            "not carry it."
            % ", ".join("problem %d" % number for number, _ in omitted)
        ),
        "noStatementIsCommitted": (
            "No Project Euler statement, image or data file is read to build "
            "this set or stored anywhere under it. Each prompt states its "
            "question in this repository's own words and is complete without "
            "the fetched statement, which is what makes the set reproducible "
            "on a clone that has fetched nothing."
        ),
        "scopeLadder": (
            "%s alone. A tier here is a statement about how far a plan has to "
            "decompose, and one Euler problem is one solver module plus one "
            "import line however hard the mathematics is. Spreading the set "
            "across tiers on problem number or on the corpus's hard subset "
            "would label difficulty as scope, so the ladder above and below "
            "%s is empty and the pin says so." % (TIER, TIER)
        ),
        "hardSubset": (
            "The source corpus curates a brute-force-proof subset. %d of the "
            "generated tasks %s in it (%s), and each says so in its own "
            "rationale. The rest are problems where a direct loop finishes, so "
            "this set is not a discriminator on algorithmic reasoning."
            % (
                len(hard_hits),
                "is" if len(hard_hits) == 1 else "are",
                ", ".join("problem %d" % number for number in hard_hits),
            )
        ),
        "whatThisMeasures": (
            "Registry plumbing, instruction-following across two files, and "
            "one computed integer. Every problem here is among the most "
            "reproduced in existence, so a model may recall the answer without "
            "deriving it. The gauge folds every constant expression in every "
            "module under src/ and refuses one that comes to the answer, so a "
            "literal, a sum of two literals, a string of digits handed to "
            "int() and a constant parked in a second module all read the same; "
            "and it refuses a module that opens a file, reads input or evals, "
            "or imports outside src and a stated list of computation modules. "
            "What it cannot see is a derivation the model recalled whole and "
            "then wrote out as working code. Read a high pass rate on this set "
            "as a statement about the harness, not about mathematics."
        ),
        "hiddenTests": (
            "The measurement lives in gauge/, one directory per task, "
            "materialized only after the model's process has exited. No seeded "
            "file contains any Project Euler answer: the two worked solvers in "
            "the seed are not Euler problems, which is what lets the set cover "
            "problems 1 and 2 as well."
        ),
        "seedIsGreen": (
            "The seeded repository passes its own visible suite untouched, so "
            "a run starts green and a red visible test is the arm's doing."
        ),
        "languageMix": (
            "python only. The registry contract, the command line and the "
            "visible runner are the corpus's existing euler bench shape, which "
            "is python and needs no build step."
        ),
    }


def build_manifest(
    emitted: Sequence[int],
    omitted: Sequence[Tuple[int, str]],
    answers: Dict[int, int],
    restatements: Dict[int, Dict[str, str]],
    hard: Dict[int, str],
) -> Dict[str, Any]:
    tasks = [
        build_task(number, answers[number], restatements[number], hard.get(number))
        for number in emitted
    ]
    counts = dict((tier, 0) for tier in ("T0", "T1", "T2", "T3", "T4"))
    counts[TIER] = len(tasks)
    return {
        "version": 1,
        "selectionCriteria": build_selection_criteria(emitted, omitted, hard),
        "defaults": {
            "model": MODEL,
            "tierTimeoutSec": {
                "T0": 1800,
                "T1": 2700,
                "T2": 3600,
                "T3": 7200,
                "T4": 3600,
            },
        },
        "expectedTaskCounts": counts,
        "sweep": {
            "rationale": (
                "One model, because one model is served. %d tasks across three "
                "arms is %d cells at a %d-second ceiling each, which is already "
                "the larger part of a week of wall clock; a second repetition "
                "would double it, so the declared design is one repetition per "
                "cell and any spread this set reports is a spread a single "
                "repetition cannot separate from noise. A variance claim needs "
                "a narrower selection run with more repetitions, which is what "
                "--task and --tier are for."
                % (len(tasks), len(tasks) * 3, 2700)
            ),
            "primaryModel": MODEL,
            "models": [MODEL],
            "sweptTiers": [TIER],
            "primaryOnlyTiers": [
                tier for tier in ("T0", "T1", "T2", "T3", "T4") if tier != TIER
            ],
            "capabilities": ["none"],
            "reps": 1,
        },
        "tasks": tasks,
    }


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def render_manifest(manifest: Dict[str, Any]) -> str:
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"


def plan_output(emitted: Sequence[int], answers: Dict[int, int]) -> Dict[str, str]:
    """Every file the run owns, keyed by path relative to the corpus directory.

    The whole output is decided before anything is written, so a refusal
    partway through cannot leave half a task set on disk.
    """
    out: Dict[str, str] = {}
    for relpath, body in build_seed_files().items():
        out["%s/%s" % (SEED_DIRNAME, relpath)] = body
    for number in emitted:
        for relpath, body in build_gauge_files(number, answers[number]).items():
            out["%s/%s/%s" % (HIDDEN_DIRNAME, task_id(number), relpath)] = body
    return out


def write_output(corpus_dir: Path, files: Dict[str, str]) -> List[str]:
    """Replace the generated trees wholesale, so a shrinking set leaves nothing behind."""
    for name in (SEED_DIRNAME, HIDDEN_DIRNAME):
        target = corpus_dir / name
        if target.exists():
            shutil.rmtree(str(target))
    written: List[str] = []
    for relpath in sorted(files):
        path = corpus_dir / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(files[relpath])
        written.append(relpath)
    return written


# What an interpreter and a file browser leave inside the generated trees. The
# seed's own .gitignore names the first two and the repository ignores all of
# them everywhere, so `git status` reports none - and reading one turned the
# gate's --check row into an unhandled decode error naming this function rather
# than the file, which points at no cause an operator can act on.
IGNORED_DIR_NAMES = ("__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache")
IGNORED_FILE_NAMES = (".DS_Store", "Thumbs.db")
IGNORED_FILE_SUFFIXES = (".pyc", ".pyo")


def _is_generated_source(relparts: Tuple[str, ...]) -> bool:
    """Whether one path under a generated tree is source this generator owns."""
    if relparts[-1] in IGNORED_FILE_NAMES:
        return False
    if relparts[-1].endswith(IGNORED_FILE_SUFFIXES):
        return False
    return not set(relparts[:-1]) & set(IGNORED_DIR_NAMES)


def read_output(corpus_dir: Path) -> Dict[str, str]:
    """What the generated trees hold on disk, in the same shape ``plan_output`` returns."""
    out: Dict[str, str] = {}
    for name in (SEED_DIRNAME, HIDDEN_DIRNAME):
        base = corpus_dir / name
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            relparts = path.relative_to(base).parts
            if not _is_generated_source(relparts):
                continue
            relpath = "/".join((name,) + relparts)
            try:
                out[relpath] = path.read_text()
            except UnicodeDecodeError as exc:
                raise GeneratorError(
                    "%s under %s is not UTF-8 text (byte %d): %s"
                    % (relpath, corpus_dir, exc.start, exc.reason)
                )
    return out


# ---------------------------------------------------------------------------
# The statement audit
# ---------------------------------------------------------------------------


def _words(text: str) -> List[str]:
    out: List[str] = []
    current: List[str] = []
    for char in text.lower():
        if char.isalnum():
            current.append(char)
        elif current:
            out.append("".join(current))
            current = []
    if current:
        out.append("".join(current))
    return out


def longest_shared_run(left: str, right: str) -> int:
    """The longest run of consecutive words the two texts share."""
    a = _words(left)
    b = _words(right)
    if not a or not b:
        return 0
    previous = [0] * (len(b) + 1)
    best = 0
    for i in range(1, len(a) + 1):
        current = [0] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                current[j] = previous[j - 1] + 1
                if current[j] > best:
                    best = current[j]
        previous = current
    return best


def audit_statements(
    emitted: Sequence[int],
    restatements: Dict[int, Dict[str, str]],
    statements_dir: Path,
    require: bool,
) -> Tuple[List[str], List[str]]:
    """Compare each restatement against the statement it replaces.

    Reads the fetched statements and writes nothing. Its whole point is that
    the committed prompts are this repository's own prose: a restatement that
    shares a long run of words with the statement is a copy that slipped
    through, and this is the check that says so before it is committed.

    An absent statement file is reported by name and is not by itself a
    failure: project-euler/problems/ is gitignored in the source corpus and a
    clone that has fetched nothing has none of them. ``require`` is for the
    machine that has fetched them and wants the audit to cover the whole set.
    """
    absent: List[str] = []
    copied: List[str] = []
    for number in emitted:
        path = statements_dir / (STATEMENT_PATTERN % number)
        if not path.is_file():
            absent.append(
                "problem %d: no statement at %s" % (number, path)
            )
            continue
        try:
            statement = path.read_text()
        except (OSError, UnicodeDecodeError) as exc:
            absent.append("problem %d: cannot read %s: %s" % (number, path, exc))
            continue
        run = longest_shared_run(restatements[number]["question"], statement)
        if run >= MAX_SHARED_WORDS:
            copied.append(
                "problem %d: the restatement shares a %d-word run with the "
                "statement, at or over the %d-word ceiling"
                % (number, run, MAX_SHARED_WORDS)
            )
    if require and absent:
        copied = copied + [
            "every statement is required and %d are absent" % len(absent)
        ]
    return absent, copied


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="generate_euler_tasks.py",
        description="Emit the Project Euler bench task set from the corpus answer key.",
    )
    parser.add_argument(
        "--corpus-dir",
        default=str(CORPUS_DIR),
        help="directory holding the answer key and the generated seed and gauge trees",
    )
    parser.add_argument(
        "--manifest",
        default=str(MANIFEST_PATH),
        help="path the generated bench manifest is written to",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="write nothing and report whether the committed output is what this "
        "run would produce",
    )
    parser.add_argument(
        "--audit-statements",
        metavar="DIR",
        help="compare each restatement against the fetched statement it replaces; "
        "reads that directory and writes nothing",
    )
    parser.add_argument(
        "--require-statements",
        action="store_true",
        help="with --audit-statements, treat an absent statement file as a failure",
    )
    return parser


def generate(corpus_dir: Path) -> Tuple[Dict[str, Any], Dict[str, str], List[int], List[Tuple[int, str]]]:
    """Everything the run would write, decided and returned without writing it."""
    answers = load_answers(corpus_dir / ANSWERS_FILENAME)
    restatements = load_restatements(corpus_dir / RESTATEMENTS_FILENAME)
    hard = load_hard_subset(corpus_dir / HARD_SUBSET_FILENAME)
    emitted, omitted = reconcile(answers, restatements)
    if not emitted:
        raise GeneratorError(
            "the restatement side-car states a question for no verified problem, "
            "so the set would be empty"
        )
    manifest = build_manifest(emitted, omitted, answers, restatements, hard)
    files = plan_output(emitted, answers)
    return manifest, files, emitted, omitted


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(list(sys.argv[1:] if argv is None else argv))
    corpus_dir = Path(args.corpus_dir)
    manifest_path = Path(args.manifest)
    if args.require_statements and not args.audit_statements:
        sys.stderr.write(
            "euler-tasks: --require-statements only means something with "
            "--audit-statements\n"
        )
        return 2
    try:
        manifest, files, emitted, omitted = generate(corpus_dir)
    except GeneratorError as exc:
        sys.stderr.write("euler-tasks: %s\n" % exc)
        return 2

    rendered = render_manifest(manifest)

    for number, reason in omitted:
        sys.stdout.write("skipped problem %d: %s\n" % (number, reason))

    if args.audit_statements:
        restatements = load_restatements(corpus_dir / RESTATEMENTS_FILENAME)
        absent, copied = audit_statements(
            emitted,
            restatements,
            Path(args.audit_statements),
            args.require_statements,
        )
        for line in absent:
            sys.stdout.write("statement absent - %s\n" % line)
        if copied:
            for line in copied:
                sys.stderr.write("euler-tasks: %s\n" % line)
            return 2
        sys.stdout.write(
            "statement audit: %d of %d compared, none shares a %d-word run\n"
            % (len(emitted) - len(absent), len(emitted), MAX_SHARED_WORDS)
        )
        # The audit reads. An operator reaches for it when they suspect a
        # generated file was hand-edited, and a run that falls through to
        # write_output rmtree's the trees and rewrites them from the inputs -
        # destroying the edit and the evidence that it existed, then reporting
        # a clean audit over what it just rewrote. --check is the mode that
        # compares, and the two compose; neither writes.
        if not args.check:
            return 0

    if args.check:
        problems: List[str] = []
        try:
            committed = manifest_path.read_text()
        except OSError as exc:
            problems.append("cannot read %s: %s" % (manifest_path, exc))
        else:
            if committed != rendered:
                problems.append("%s is not what this run would write" % manifest_path)
        on_disk = read_output(corpus_dir)
        for relpath in sorted(set(files) | set(on_disk)):
            if relpath not in on_disk:
                problems.append("%s is absent from %s" % (relpath, corpus_dir))
            elif relpath not in files:
                problems.append("%s under %s is not generated" % (relpath, corpus_dir))
            elif on_disk[relpath] != files[relpath]:
                problems.append("%s differs from what this run would write" % relpath)
        if problems:
            for line in problems:
                sys.stderr.write("euler-tasks: %s\n" % line)
            return 1
        sys.stdout.write(
            "check: %d task(s), %d generated file(s), all as committed\n"
            % (len(manifest["tasks"]), len(files))
        )
        return 0

    written = write_output(corpus_dir, files)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(rendered)
    sys.stdout.write(
        "wrote %s: %d task(s) over problems %s\n"
        % (
            manifest_path,
            len(manifest["tasks"]),
            ", ".join(str(number) for number in emitted),
        )
    )
    sys.stdout.write(
        "wrote %d file(s) under %s\n" % (len(written), corpus_dir)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
