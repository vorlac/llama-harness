"""The graded checks for the http-client-v2 migration.

Four checks, and three of them are the working tree's own completeness gate run
without its escape hatch. ``scripts/check_migration.sh`` only enters strict mode
once something imports ``modern_http``, so an idle tree passes it; here the
strict checks run unconditionally, which is what makes an untouched tree fail.

The frozen suite is graded from the copy under ``frozen/``, so a working tree
that edited or deleted anything under ``tests/`` is still measured by the suite
the task was set with, and the import poison is this module's own rather than
``scripts/poison_legacy.py``'s.

Nothing here is a proxy for judgement: the notes floor says a decision record
exists, not that its twelve decisions are good ones.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest

GAUGE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(GAUGE)

# The service's own trees, minus the vendored libraries and the tooling that
# talks about them on purpose. `check_migration.sh` draws the same boundary.
EXCLUDED_TREES = ("legacy_http", "modern_http", "wirenet", "scripts", ".git", "gauge")
DEPRECATED = "legacy_http"
NOTES = "MIGRATION-NOTES.md"
NOTES_MIN_BYTES = 500


class Poison(object):
    """A meta-path finder that refuses to import the deprecated library.

    Grep finds the imports written at the top of a module. This finds the rest:
    an import inside a function body, an ``importlib`` call, an alias.
    """

    @staticmethod
    def matches(fullname):
        return fullname == DEPRECATED or fullname.startswith(DEPRECATED + ".")

    def find_spec(self, fullname, path=None, target=None):
        if self.matches(fullname):
            raise ImportError(
                "%s is poisoned: %r was imported, so the migration is not complete"
                % (DEPRECATED, fullname)
            )
        return None

    def find_module(self, fullname, path=None):
        return self if self.matches(fullname) else None

    def load_module(self, fullname):
        raise ImportError("%s is poisoned: %r was imported" % (DEPRECATED, fullname))


def service_sources():
    """Every python file of the service, in a stable order."""
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        relative = os.path.relpath(dirpath, ROOT)
        head = relative.split(os.sep)[0]
        if head in EXCLUDED_TREES or "__pycache__" in dirpath:
            dirnames[:] = []
            continue
        dirnames[:] = sorted(name for name in dirnames if name != "__pycache__")
        for name in sorted(filenames):
            if name.endswith(".py"):
                out.append(os.path.join(dirpath, name))
    return out


def deprecated_references():
    """One entry per line of service source that still names the old library."""
    hits = []
    for path in service_sources():
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for number, line in enumerate(handle, 1):
                if DEPRECATED in line:
                    hits.append(
                        "%s:%d: %s"
                        % (os.path.relpath(path, ROOT), number, line.strip())
                    )
    return hits


def vendored_drift():
    """Vendored files whose bytes differ from the ones the task was set with."""
    with open(os.path.join(GAUGE, "vendored.json"), "r", encoding="utf-8") as handle:
        pinned = json.load(handle)
    drifted = []
    for relative in sorted(pinned):
        path = os.path.join(ROOT, relative)
        if not os.path.isfile(path):
            drifted.append("%s: missing" % relative)
            continue
        with open(path, "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
        if digest != pinned[relative]:
            drifted.append("%s: edited" % relative)
    return drifted


def notes_bytes():
    path = os.path.join(ROOT, NOTES)
    if not os.path.isfile(path):
        return None
    return os.path.getsize(path)


def run_frozen_suite():
    """The frozen suite, with the deprecated library unimportable."""
    for name in list(sys.modules):
        if Poison.matches(name):
            del sys.modules[name]
    sys.meta_path.insert(0, Poison())
    for entry in (ROOT, GAUGE):
        if entry not in sys.path:
            sys.path.insert(0, entry)
    suite = unittest.defaultTestLoader.discover(
        start_dir=os.path.join(GAUGE, "frozen"), top_level_dir=GAUGE
    )
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return result.wasSuccessful(), result.testsRun


def main():
    sys.dont_write_bytecode = True
    os.chdir(ROOT)
    failures = []

    drifted = vendored_drift()
    if drifted:
        failures.append("the vendored libraries are not the ones the task shipped")
        for line in drifted:
            print("    %s" % line)
    print("vendored libraries: %s" % ("edited" if drifted else "intact"))

    hits = deprecated_references()
    print("%s references outside the vendored library: %d" % (DEPRECATED, len(hits)))
    if hits:
        failures.append("%d reference(s) to %s remain" % (len(hits), DEPRECATED))
        for line in hits:
            print("    %s" % line)

    size = notes_bytes()
    if size is None:
        failures.append("%s is missing" % NOTES)
    elif size < NOTES_MIN_BYTES:
        failures.append("%s is %d bytes; that is not a decision record" % (NOTES, size))
    else:
        print("%s: %d bytes" % (NOTES, size))

    ok, count = run_frozen_suite()
    print("frozen suite with %s poisoned: %d test(s), %s"
          % (DEPRECATED, count, "ok" if ok else "FAILED"))
    if not ok:
        failures.append("the frozen suite does not pass with %s unimportable" % DEPRECATED)

    if failures:
        print("GAUGE FAIL")
        for line in failures:
            print("  %s" % line)
        return 1
    print("GAUGE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
