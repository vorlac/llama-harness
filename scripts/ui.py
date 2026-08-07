"""Console output for the harness scripts.

Uses `rich <https://rich.readthedocs.io>`_ when it is installed and degrades to
plain aligned text when it is not, so nothing here is a hard dependency and the
scripts still run on a bare system python.

Install the nicer output with::

    pip3 install --user rich

The fallback is not just a stub: it measures column widths by *visible* length,
which the hand-rolled ``%-22s`` formatting it replaces did not - ANSI colour
codes counted toward the pad width and silently broke every table.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from typing import (
    Dict,
    Iterable,
    List,
    Optional,
    Sequence,
    Tuple,
)

try:  # pragma: no cover - depends on the host
    from rich.console import Console
    from rich.progress import (
        BarColumn,
        MofNCompleteColumn,
        Progress,
        SpinnerColumn,
        TextColumn,
        TimeElapsedColumn,
        TimeRemainingColumn,
    )

    from rich.table import Table
    from rich.theme import Theme

    HAVE_RICH = True
except ImportError:  # pragma: no cover
    HAVE_RICH = False

_ANSI = re.compile(r"\033\[[0-9;]*m")
NO_COLOR = bool(os.environ.get("NO_COLOR"))


def visible_len(text: str) -> int:
    """Length ignoring ANSI escapes - what the terminal actually shows."""
    return len(_ANSI.sub("", str(text)))


def term_width(default: int = 100) -> int:
    """Current terminal width, re-read on every call.

    Deliberately not cached: the point is that a mid-run resize takes effect on
    the next line printed rather than only on the next invocation.
    """
    if os.environ.get("COLUMNS", "").isdigit():
        return int(os.environ["COLUMNS"])

    try:
        cols = shutil.get_terminal_size(fallback=(default, 24)).columns
    except (OSError, ValueError):
        cols = default

    return max(40, cols)


def fit(text: str, width: Optional[int] = None, marker: str = "\u2026") -> str:
    """Truncate to the terminal width, appending an ellipsis.

    ANSI-aware: escape sequences are copied through without counting toward the
    visible budget, and any open colour is reset at the cut so truncation cannot
    bleed styling into the rest of the terminal.
    """
    limit = width if width is not None else term_width()
    if visible_len(text) <= limit:
        return text

    budget = limit - 1  # room for the marker
    out, seen, index, styled = [], 0, 0, False
    while index < len(text) and seen < budget:
        match = _ANSI.match(text, index)
        if match:  # zero-width: copy, do not count
            out.append(match.group(0))
            styled = True
            index = match.end()
            continue

        out.append(text[index])
        seen += 1
        index += 1

    out.append(marker)
    if styled:
        out.append("\033[0m")

    return "".join(out)


def pad(text: str, width: int, right: bool = False) -> str:
    """Pad to `width` *visible* columns.

    Use this instead of ``%-22s`` on anything that might carry colour: printf
    pads to the string's raw length, so markup and escape codes eat the column
    and the table goes ragged exactly when a value is long enough to matter.
    """
    gap = max(0, width - visible_len(text))
    return (" " * gap + str(text)) if right else (str(text) + " " * gap)


_pad = pad  # internal alias, kept so existing call sites read unchanged


# Leading whitespace, then an optional bullet: -, +, *, a check/cross, or "3)".
_MARKER = re.compile(r"^(\s*)((?:[-+*•✓✗]|\d+[.)])\s+)?")


def display_len(text: str) -> int:
    """Visible width, ignoring both ANSI escapes and rich markup tags.

    :func:`visible_len` only knows about escapes. Anything measured before rich
    has rendered it also has to discount ``[muted]``-style tags, or the width is
    overstated by however much markup the caller happened to use.
    """
    return len(_ANSI.sub("", _strip_markup(str(text))))


def text_column(line: str) -> int:
    """Column where a line's text starts: its indent plus any bullet marker.

    This is the column a continuation line has to land on for a wrapped item to
    still read as one item rather than as two unrelated lines.
    """
    plain = _ANSI.sub("", _strip_markup(str(line)))
    match = _MARKER.match(plain)
    return len(match.group(1)) + len(match.group(2) or "")


_MARKUP_TAG = re.compile(r"\[(/?)([a-z_ ]*)\]")


def _track_tags(token: str, stack: List[str]) -> None:
    """Update the open-markup stack with whatever `token` opens or closes."""
    for closing, name in _MARKUP_TAG.findall(token):
        if not closing:
            stack.append(name)
        elif name:
            for index in range(len(stack) - 1, -1, -1):
                if stack[index] == name:
                    del stack[index]
                    break
        elif stack:  # bare [/] closes the most recent
            stack.pop()


def wrap_lines(
    text: str,
    width: Optional[int] = None,
    hang: Optional[int] = None,
) -> List[str]:
    """Wrap `text`, indenting continuation lines to where its text began.

    `hang` overrides that column, which is what a "label: value" item wants so
    the continuation lines up under the value rather than under the label.

    Runs of whitespace are preserved when they fall inside a line, so a padded
    column does not collapse just because the line happened to need wrapping.

    Markup spanning a break is closed at the end of the line and reopened on the
    next, since each line is rendered on its own - without that, a wrap between
    ``[muted]`` and ``[/muted]`` hands rich an unbalanced tag and it raises.
    """
    limit = width if width is not None else term_width()
    if hang is None:
        hang = text_column(text)

    continuation = " " * hang
    lines: List[str] = []
    open_tags: List[str] = []
    current = ""
    current_len = 0
    gap = ""

    for token in re.split(r"(\s+)", str(text)):
        if not token:
            continue
        if token.isspace():
            gap = token
            continue

        token_len = display_len(token)
        gap_len = len(gap)
        # `current` is empty only on the very first token, where the caller's
        # own leading indent is still sitting in `gap` and must be kept.
        if current and current_len + gap_len + token_len > limit:
            closers = "".join("[/%s]" % tag for tag in reversed(open_tags))
            reopeners = "".join("[%s]" % tag for tag in open_tags)
            lines.append(current + closers)
            current = continuation + reopeners + token
            current_len = hang + token_len
        else:
            current += gap + token
            current_len += gap_len + token_len

        _track_tags(token, open_tags)
        gap = ""

    if current:
        lines.append(current)

    return lines or [""]


_THEME = {
    "ok": "bold green",
    "bad": "bold red",
    "warn": "yellow",
    "muted": "dim",
    "model": "cyan",
    "metric": "bold",
}

_console = None
if HAVE_RICH:
    # When output is piped rich falls back to 80 columns, which ellipsizes model
    # ids in captured logs. Give redirected output a usable width instead.
    _width = None if sys.stdout.isatty() else int(os.environ.get("COLUMNS", "120"))
    _console = Console(theme=Theme(_THEME), no_color=NO_COLOR, soft_wrap=False, width=_width)


def _strip_markup(text: str) -> str:
    """Drop rich markup tags so the fallback does not print them literally."""
    return re.sub(r"\[/?[a-z_ ]+\]", "", text)


def _output_width() -> int:
    """Width both back ends agree on, so wrapping looks identical either way."""
    if HAVE_RICH and _console is not None:
        return _console.width
    return term_width()


def _emit(line: str) -> None:
    """Write one already-wrapped line, letting neither back end re-wrap it."""
    if HAVE_RICH:
        _console.print(line, highlight=False, no_wrap=True, overflow="ellipsis", crop=True)
    else:
        sys.stdout.write(_strip_markup(line) + "\n")
        sys.stdout.flush()


def print(  # noqa: A001
    text: str = "",
    wrap: bool = False,
    hang: Optional[int] = None,
) -> None:
    """Print one line, truncated to the terminal width unless `wrap` is set.

    Truncation is the default so that a narrow terminal shows one line per
    record instead of a ragged block that is far harder to scan. When wrapping
    *is* asked for, continuation lines are indented to the column where this
    line's text began, so a wrapped item still reads as a single item. Pass
    `hang` to override that column - a "label: value" item usually wants the
    continuation under the value rather than under the label.
    """
    if not wrap:
        if HAVE_RICH:
            # rich re-measures the terminal on every render, so a resize is
            # picked up automatically; crop+ellipsis matches `fit`'s shape.
            _console.print(
                text, highlight=False, no_wrap=True, overflow="ellipsis", crop=True
            )
        else:
            sys.stdout.write(fit(_strip_markup(text)) + "\n")
            sys.stdout.flush()
        return

    for line in wrap_lines(text, width=_output_width(), hang=hang):
        _emit(line)


def rule(title: str) -> None:
    """A section divider."""
    if HAVE_RICH:
        _console.rule("[bold]%s" % title, style="blue")
    else:
        line = _strip_markup(title)
        sys.stdout.write("\n%s\n%s\n" % (line, "-" * min(len(line), 78)))
        sys.stdout.flush()


def note(text: str) -> None:
    print("[muted]%s[/muted]" % text)


class SimpleTable:
    """Minimal table with the subset of rich's API this project uses."""

    def __init__(self, title: Optional[str] = None, caption: Optional[str] = None):
        self.title = title
        self.caption = caption
        self.columns: List[Tuple[str, bool]] = []  # (header, right_aligned)
        self.rows: List[Sequence[str]] = []

    def add_column(self, header: str, justify: str = "left", **_: object) -> None:
        self.columns.append((header, justify == "right"))

    # `style`/`overflow`/`no_wrap` are accepted and ignored for API parity
    # with rich.Table, so callers need no branching.

    def add_row(self, *cells: object) -> None:
        self.rows.append([("" if c is None else str(c)) for c in cells])


def table(title: Optional[str] = None, caption: Optional[str] = None):
    if HAVE_RICH:
        return Table(
            title=title,
            caption=caption,
            title_justify="left",
            caption_justify="left",
            header_style="bold",
            expand=False,
            pad_edge=False,
        )

    return SimpleTable(title, caption)


def show(tbl) -> None:
    """Render a table built by :func:`table`."""
    if HAVE_RICH:
        _console.print(tbl)
        return

    # Measure with display_len, not visible_len: these cells are rendered with
    # their markup stripped, so counting the tags would pad every column out by
    # however much markup the caller happened to use.
    widths = []
    for index, (header, _right) in enumerate(tbl.columns):
        longest = display_len(header)
        for row in tbl.rows:
            if index < len(row):
                longest = max(longest, display_len(row[index]))

        widths.append(longest)

    out = []
    if tbl.title:
        out.append(_strip_markup(tbl.title))

    header_cells = [
        _pad(_strip_markup(h), widths[i], tbl.columns[i][1])
        for i, (h, _r) in enumerate(tbl.columns)
    ]

    out.append("  " + "  ".join(header_cells))
    out.append("  " + "  ".join("-" * w for w in widths))
    for row in tbl.rows:
        cells = [
            _pad(_strip_markup(row[i]) if i < len(row) else "", widths[i], tbl.columns[i][1])
            for i in range(len(tbl.columns))
        ]

        out.append("  " + "  ".join(cells))

    if tbl.caption:
        out.append(_strip_markup(tbl.caption))

    sys.stdout.write("\n".join(out) + "\n")
    sys.stdout.flush()


def key_values(title: str, pairs: Iterable[Tuple[str, object]]) -> None:
    """Two-column detail block, e.g. the host profile."""
    tbl = table(title)
    tbl.add_column("", justify="left")
    tbl.add_column("", justify="left")
    for key, value in pairs:
        tbl.add_row("[muted]%s[/muted]" % key if HAVE_RICH else key, str(value))

    show(tbl)


class _NullProgress:
    """Fallback: log lines instead of a live bar."""

    def __init__(self, total: int, description: str):
        self.total = total
        self.done = 0
        self.description = description

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def advance(self, step: int = 1) -> None:
        self.done += step

    def update(self, description: str) -> None:
        self.description = description

    def log(self, text: str) -> None:
        sys.stdout.write("%s\n" % fit(_strip_markup(str(text))))
        sys.stdout.flush()

    def show(self, renderable) -> None:
        """Render a table built by :func:`table` without a live region."""
        show(renderable)

    @property
    def counter(self) -> str:
        return "%d/%d" % (self.done, self.total)


class _RichProgress:
    """Live bar that still allows ordinary printing above it."""

    def __init__(self, total: int, description: str):
        self.total = total
        self.done = 0
        self._progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold]{task.description}"),
            BarColumn(bar_width=28),
            MofNCompleteColumn(),
            TextColumn("[muted]elapsed[/muted]"),
            TimeElapsedColumn(),
            TextColumn("[muted]left[/muted]"),
            TimeRemainingColumn(),
            console=_console,
            transient=False,
        )

        self._task = None
        self._description = description

    def __enter__(self):
        self._progress.__enter__()
        self._task = self._progress.add_task(self._description, total=self.total)
        return self

    def __exit__(self, *exc):
        return self._progress.__exit__(*exc)

    def advance(self, step: int = 1) -> None:
        self.done += step
        self._progress.advance(self._task, step)

    def update(self, description: str) -> None:
        self._progress.update(self._task, description=description)

    def log(self, text: str) -> None:
        # Printing through the Progress console keeps the bar pinned to the
        # bottom instead of it being scrolled away by our own output.
        self._progress.console.print(
            text,
            highlight=False,
            no_wrap=True,
            overflow="ellipsis",
            crop=True,
        )

    def show(self, renderable) -> None:
        """Print a table above the live bar."""
        self._progress.console.print(renderable)

    @property
    def counter(self) -> str:
        return "%d/%d" % (self.done, self.total)


def progress(total: int, description: str = "working"):
    if HAVE_RICH and sys.stdout.isatty():
        return _RichProgress(total, description)

    return _NullProgress(total, description)


def status_text(ok: bool, label_ok: str = "ok", label_bad: str = "FAILED") -> str:
    return "[ok]%s[/ok]" % label_ok if ok else "[bad]%s[/bad]" % label_bad


def ratio_text(ratio: Optional[float], passed=None, total=None) -> str:
    if not isinstance(ratio, (int, float)):
        return "[muted]-[/muted]"

    pct = ratio * 100
    style = "ok" if pct >= 99 else ("warn" if pct >= 50 else "bad")
    if passed is not None and total:
        return "[%s]%.0f%%[/%s] [muted](%s/%s)[/muted]" % (style, pct, style, passed, total)

    return "[%s]%.0f%%[/%s]" % (style, pct, style)


def num(value: Optional[float], fmt: str = "%.1f") -> str:
    if not isinstance(value, (int, float)):
        return "[muted]-[/muted]"

    return fmt % value


def dependency_hint() -> Optional[str]:
    """Told once, so the plain-text path advertises the nicer one."""
    if HAVE_RICH:
        return None

    return "install `rich` for tables and live progress:  " "pip3 install --user rich"
