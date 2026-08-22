#!/usr/bin/env python3
"""Run the test suite with ``legacy_http`` made unimportable.

    python3 scripts/poison_legacy.py

A finished migration must not import the deprecated library at all, from any
code path the suite exercises. Grepping for the name catches the obvious cases;
this catches the rest - a lazy import inside a function, an importlib call, an
alias.

Exit code 0 means the suite passed with the library poisoned.
"""

from __future__ import annotations

import os
import sys
import unittest

POISONED = ("legacy_http",)


class _Poison(object):
    def find_module(self, fullname, path=None):
        return self if self._matches(fullname) else None

    def find_spec(self, fullname, path=None, target=None):
        if self._matches(fullname):
            raise ImportError(
                "legacy_http is poisoned: %r was imported, so the migration is "
                "not complete" % (fullname,))
        return None

    @staticmethod
    def _matches(fullname):
        return any(fullname == name or fullname.startswith(name + ".")
                   for name in POISONED)

    def load_module(self, fullname):
        raise ImportError("legacy_http is poisoned: %r was imported" % (fullname,))


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    if root not in sys.path:
        sys.path.insert(0, root)
    for name in list(sys.modules):
        if _Poison._matches(name):
            del sys.modules[name]
    sys.meta_path.insert(0, _Poison())

    suite = unittest.defaultTestLoader.discover(start_dir="tests", top_level_dir=".")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
