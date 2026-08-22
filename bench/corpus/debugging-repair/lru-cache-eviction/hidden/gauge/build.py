"""Compile and run the graded suite for the lru cache.

The suite lives beside this file and carries its own harness, so a working tree
that has edited or deleted anything under ``tests/`` is still measured by the
instrument the task was set with. Only ``include/`` and ``src/`` are taken from
the working tree, which is where the repair belongs.

The build is driven from here rather than from the working tree's Makefile for
the same reason, and everything it produces goes to a temporary directory so a
graded run never disturbs ``build/``.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GAUGE = Path(__file__).resolve().parent
ROOT = GAUGE.parent

WARNINGS = ["-Wall", "-Wextra", "-Wpedantic", "-Wshadow", "-Wnon-virtual-dtor"]
SOURCES = [
    GAUGE / "harness.cpp",
    GAUGE / "run_tests.cpp",
    GAUGE / "test_basics.cpp",
    GAUGE / "test_eviction.cpp",
    GAUGE / "test_table.cpp",
    ROOT / "src" / "clock.cpp",
    ROOT / "src" / "stats.cpp",
]


def compiler():
    """The C++ driver to build with, named the way the workspace names it."""
    for candidate in (os.environ.get("CXX"), "c++", "clang++", "g++"):
        if not candidate:
            continue
        found = shutil.which(candidate)
        if found is not None:
            return found
    return None


def main():
    driver = compiler()
    if driver is None:
        print("gauge: no C++ compiler on PATH", file=sys.stderr)
        return 2
    missing = [str(path.relative_to(ROOT)) for path in SOURCES if not path.is_file()]
    if missing:
        print("gauge: missing source(s): %s" % ", ".join(missing), file=sys.stderr)
        return 2

    scratch = tempfile.mkdtemp(prefix="lru-gauge-")
    try:
        binary = Path(scratch) / "lru_gauge"
        argv = [driver, "-std=c++17", "-O2"] + WARNINGS + [
            "-I%s" % (ROOT / "include"),
            "-I%s" % GAUGE,
            "-o",
            str(binary),
        ] + [str(path) for path in SOURCES]
        compiled = subprocess.run(argv, cwd=str(ROOT))
        if compiled.returncode != 0:
            print("gauge: the graded suite does not compile", file=sys.stderr)
            return compiled.returncode
        return subprocess.run([str(binary)], cwd=str(ROOT)).returncode
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
