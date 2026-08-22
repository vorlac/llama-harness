#!/usr/bin/env python3
"""Follow the live model transcript of whichever benchmark cell is running.

    /usr/bin/python3 scripts/watch_transcript.py

No arguments. Every knob is a constant in the CONFIG block below. Run it in a
second terminal beside `scripts/run_and_watch.py`.

WHY THIS IS A SEPARATE TERMINAL

run_and_watch.py prints three feeds: the driver's output, the scoreboard, and
the conductor console. All three are summaries. None of them is the thing the
model actually said and did — the tool calls, the edits, the shell commands, the
reasoning between them. That transcript is what changes when the harness
changes, so watching it is how a modification is judged.

It is a separate process because it is a different kind of feed. The dashboard
repaints on a timer; a transcript scrolls at the model's own pace. Interleaving
them in one terminal makes both unreadable.

WHAT IT DOES

Watches the work root for the newest cell transcript and relays it line by line.
When the driver moves to the next cell, this follows: it prints a banner naming
the arm and task it has switched to, and carries on. Three arms run back to back
on each task, so a task's three transcripts arrive in sequence in one stream and
the arms can be read against each other without touching a file.

It also ARCHIVES. The work trees live under $TMPDIR, which the operating system
is entitled to delete; a transcript left there is not evidence you still have
next week. Every completed cell's transcript is copied next to that run's result
JSON, under `<results dir>/transcripts/`, so comparing this run against the one
after your next modification is reading two directories rather than trying to
remember what the terminal said.

It reads. It never writes to the work tree and never touches the driver, so
starting it, stopping it, and starting it again mid-run are all safe.
"""

import os
import pathlib
import re
import shutil
import signal
import sys
import time
from typing import Any, Dict, List, Optional

# ═════════════════════════════════════════════════════════════════════════════
# CONFIG — everything you might want to change lives here.
# ═════════════════════════════════════════════════════════════════════════════

# Where the driver builds its throwaway repos. None means the same default
# conductor_bench.py uses, $TMPDIR/llama-leash-conductor-work. Change it only if
# you changed WORK_ROOT in run_and_watch.py, and then set it to the same path.
WORK_ROOT: Optional[str] = None

# Where finished transcripts are archived to. None means "the newest run
# directory under .data/benchmark/watch", which is the one run_and_watch.py just
# minted, so the default needs no maintenance. Set a path to archive somewhere
# else; set ARCHIVE to False to archive nowhere.
RESULTS_DIR: Optional[str] = None

# Copy each completed cell's transcript next to that run's result JSON. Off
# means the only copy stays in $TMPDIR and is one cache sweep from gone.
ARCHIVE = True

# When attaching to a cell that is ALREADY running, how many of its existing
# lines to print before following. This is the catch-up for starting the watcher
# late. 0 attaches silently at the end and shows only what happens from now on;
# a large number replays the cell from its beginning.
CATCH_UP_LINES = 40

# Strip opencode's ANSI colour codes. False keeps its colouring, which
# distinguishes tool calls from prose and is worth having in a terminal that
# renders it. True is for piping this into a file or a pager that does not.
STRIP_ANSI = False

# Prefix every line with mm:ss since the current cell started. This is how a
# stall is seen: the clock keeps moving while the transcript does not. It also
# makes "which step is slow" answerable without instrumenting anything.
SHOW_ELAPSED = True

# Seconds between checks for a new cell and for new bytes. The model emits a
# line every few seconds at best, so sub-second polling only burns CPU.
POLL_SECONDS = 1.0

# Print a line when a cell has produced no output for this many seconds. A
# conductor turn on this hardware runs one to seven minutes, so anything under
# a couple of minutes cries wolf. Set 0 to never print it.
STALL_NOTICE_SECONDS = 180

# ═════════════════════════════════════════════════════════════════════════════

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

BANNER = "═" * 78


def work_root() -> pathlib.Path:
    """The directory holding <model>/<capability>/<arm>/<task>/rN cell dirs."""
    if WORK_ROOT:
        return pathlib.Path(WORK_ROOT)
    tmp = os.environ.get("TMPDIR", "/tmp").rstrip("/")
    return pathlib.Path(tmp) / "llama-leash-conductor-work"


def results_dir() -> Optional[pathlib.Path]:
    """Where to archive, or None when there is nowhere sensible to archive to."""
    if not ARCHIVE:
        return None
    if RESULTS_DIR:
        return pathlib.Path(RESULTS_DIR)
    watch = pathlib.Path(".data/benchmark/watch")
    if not watch.is_dir():
        return None
    runs = sorted((d for d in watch.iterdir() if d.is_dir()), key=lambda d: d.name)
    return runs[-1] if runs else None


def transcripts() -> List[pathlib.Path]:
    """Every cell transcript under the work root, newest last."""
    root = work_root()
    if not root.is_dir():
        return []
    found = list(root.glob("*/*/*/*/*/opencode.log"))
    found.sort(key=lambda p: p.stat().st_mtime)
    return found


def cell_label(log: pathlib.Path) -> str:
    """`arm / task / rN` read back out of the cell directory layout."""
    parts = log.parts
    try:
        rep, task, arm = parts[-2], parts[-3], parts[-4]
    except IndexError:
        return str(log)
    return "%s / %s / %s" % (arm, task, rep)


def archive_name(log: pathlib.Path) -> str:
    """A flat filename that keeps the cell identity the directories carried."""
    parts = log.parts
    return "%s__%s__%s.log" % (parts[-4], parts[-3], parts[-2])


def archive(log: pathlib.Path) -> None:
    """Copy one finished transcript next to its run's results, if we can."""
    target_dir = results_dir()
    if target_dir is None:
        return
    try:
        destination = target_dir / "transcripts"
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(log), str(destination / archive_name(log)))
    except OSError as exc:
        emit("archive failed for %s: %s" % (cell_label(log), exc), None)


def render(line: str, started: Optional[float]) -> str:
    text = line.rstrip("\n")
    if STRIP_ANSI:
        text = ANSI_RE.sub("", text)
    if SHOW_ELAPSED and started is not None:
        elapsed = int(time.time() - started)
        return "%02d:%02d  %s" % (elapsed // 60, elapsed % 60, text)
    return text


def emit(text: str, started: Optional[float]) -> None:
    sys.stdout.write(render(text, started) + "\n")
    sys.stdout.flush()


def banner(log: pathlib.Path, catching_up: bool) -> None:
    sys.stdout.write("\n%s\n" % BANNER)
    sys.stdout.write(
        "  %s%s\n" % (cell_label(log), "   (already running — catching up)" if catching_up else "")
    )
    sys.stdout.write("  %s\n" % log)
    sys.stdout.write("%s\n\n" % BANNER)
    sys.stdout.flush()


def cell_start(log: pathlib.Path, first_seen: float) -> float:
    """When the cell began, for the elapsed clock.

    st_birthtime is the creation time and is what we want. st_ctime is NOT: on
    this platform it is the inode change time, so it advances on every write and
    an elapsed clock built on it reads zero forever. Where birth time is absent,
    the moment this watcher first saw the file is the honest answer — it
    understates a cell already in flight, which the banner says out loud.
    """
    try:
        return log.stat().st_birthtime
    except AttributeError:
        return first_seen


def read_text(handle) -> str:
    """Decode whatever the transcript has produced since the last read.

    The transcript is opened in binary and decoded here rather than opened in
    text mode, because a text-mode handle cannot be seeked to an arbitrary byte
    offset and the catch-up below needs exactly that.
    """
    return handle.read().decode("utf-8", errors="replace")


def tail_lines(handle, count: int) -> None:
    """Print the last `count` lines already in an open transcript."""
    handle.seek(0, os.SEEK_END)
    if count <= 0:
        return
    size = handle.tell()
    # 4 KiB per wanted line is generous for a transcript and bounds the read on
    # a cell that has been running for an hour.
    window = min(size, max(65536, count * 4096))
    handle.seek(size - window)
    existing = read_text(handle).splitlines()
    for line in existing[-count:]:
        sys.stdout.write(line + "\n")
    sys.stdout.flush()
    handle.seek(0, os.SEEK_END)


def stop_on_sigterm(signum: int, frame: Any) -> None:
    """Route a kill through the same exit path Ctrl-C takes.

    Without this, a SIGTERM ends the process before the archive step and every
    transcript the run produced stays only in $TMPDIR.
    """
    raise KeyboardInterrupt


def follow() -> None:
    signal.signal(signal.SIGTERM, stop_on_sigterm)
    root = work_root()
    sys.stdout.write("watching %s\n" % root)
    target = results_dir()
    sys.stdout.write("archiving to %s\n" % (target / "transcripts" if target else "(nowhere)"))
    sys.stdout.write("waiting for a cell to start...\n")
    sys.stdout.flush()

    current: Optional[pathlib.Path] = None
    handle = None
    started: Optional[float] = None
    last_output = time.time()
    stalled = False
    archived: Dict[str, bool] = {}

    try:
        while True:
            found = transcripts()
            newest = found[-1] if found else None

            if newest is not None and newest != current:
                if current is not None:
                    if handle is not None:
                        # Drain whatever the finished cell wrote after its last
                        # read, so the switch never eats its closing lines.
                        for line in read_text(handle).splitlines():
                            emit(line, started)
                        handle.close()
                    if not archived.get(str(current)):
                        archive(current)
                        archived[str(current)] = True
                catching_up = newest.stat().st_size > 0
                current = newest
                started = cell_start(newest, time.time())
                handle = open(str(newest), "rb")
                banner(newest, catching_up)
                tail_lines(handle, CATCH_UP_LINES if catching_up else 0)
                last_output = time.time()
                stalled = False

            if handle is not None:
                chunk = read_text(handle)
                if chunk:
                    for line in chunk.splitlines():
                        emit(line, started)
                    last_output = time.time()
                    stalled = False
                elif (
                    STALL_NOTICE_SECONDS
                    and not stalled
                    and time.time() - last_output > STALL_NOTICE_SECONDS
                ):
                    emit(
                        "-- no output for %ds --" % int(time.time() - last_output),
                        started,
                    )
                    stalled = True

            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        if handle is not None:
            for line in read_text(handle).splitlines():
                emit(line, started)
            handle.close()
        # Archive every transcript on the way out, not just the one in view: a
        # watcher started late never saw the earlier cells switch.
        for log in transcripts():
            if not archived.get(str(log)):
                archive(log)
        sys.stdout.write("\nstopped.\n")
        sys.stdout.flush()


if __name__ == "__main__":
    follow()
