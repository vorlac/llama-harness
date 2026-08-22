"""The three output files (SPEC.md section 2).

Every file is LF-terminated, carries a header line, and never quotes or escapes
a field beyond the byte escaping of section 2.2.1.  The column order of each
file is written down exactly once, here and in `aggregate.WindowStore.rows`.
"""

import os

from .config import (REJECTS_FILE, REJECTS_HEADER, SUMMARY_FILE, SUMMARY_KEYS,
                     WINDOWS_FILE, WINDOWS_HEADER)


def open_output(path):
    """Open an output file for writing, truncating whatever was there."""
    return open(path, "w", encoding="latin-1", newline="")


class RejectLog:
    """The rows of `rejects.tsv`.

    Rejects are raised by whichever stage notices the problem, so they arrive
    in no particular order; the file is ordered by input line number.
    """

    def __init__(self):
        self._rows = []
        self._text = ""

    def __len__(self):
        return len(self._rows)

    def add(self, line_number, reject, raw_prefix):
        self._rows.append((line_number, reject.reason, reject.field,
                           reject.detail, raw_prefix))
        self._rows.sort()

    def write(self, out_dir):
        self._text = REJECTS_HEADER + "\n"
        for row in self._rows:
            self._text += "%d\t%s\t%s\t%s\t%s\n" % row
        with open_output(os.path.join(out_dir, REJECTS_FILE)) as handle:
            handle.write(self._text)


class WindowWriter:
    """`windows.csv`, appended one aggregate row at a time."""

    def __init__(self, out_dir):
        self._path = os.path.join(out_dir, WINDOWS_FILE)
        with open_output(self._path) as handle:
            handle.write(WINDOWS_HEADER + "\n")

    def append(self, row):
        with open(self._path, "a", encoding="latin-1", newline="") as handle:
            handle.write(row + "\n")


def write_summary(out_dir, values):
    """`summary.txt`: one `key=value` line per counter, in section 2.3 order."""
    missing = [key for key in SUMMARY_KEYS if key not in values]
    if missing:
        raise KeyError("summary is missing %s" % ", ".join(missing))
    with open_output(os.path.join(out_dir, SUMMARY_FILE)) as handle:
        for key in SUMMARY_KEYS:
            handle.write("%s=%d\n" % (key, values[key]))
