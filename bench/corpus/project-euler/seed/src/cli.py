"""The command line over the solver registry."""

import sys
import time

import src.solvers  # noqa: F401
from src.registry import get, names


def main(argv):
    if not argv:
        sys.stdout.write("usage: list | run <name|all>\n")
        return 2
    if argv[0] == "list":
        for name in names():
            sys.stdout.write("%s\n" % name)
        return 0
    if argv[0] == "run" and len(argv) == 2:
        wanted = names() if argv[1] == "all" else [argv[1]]
        for name in wanted:
            try:
                solve = get(name)
            except KeyError:
                sys.stdout.write("no such solver: %s\n" % name)
                return 2
            started = time.time()
            answer = solve()
            elapsed = int(round((time.time() - started) * 1000.0))
            sys.stdout.write("%s %s %dms\n" % (name, answer, elapsed))
        return 0
    sys.stdout.write("usage: list | run <name|all>\n")
    return 2
