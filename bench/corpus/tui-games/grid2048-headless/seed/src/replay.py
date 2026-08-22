"""Script parsing, the replay loop and the summary's values.

Written already. A replay is a pure function of a seed and a script: no clock,
no terminal and no randomness beyond the session's own generator.
"""

from src.board import count_empty, max_tile
from src.session import DIRECTIONS, Session
from src.summary import SCHEMA

TOKENS = DIRECTIONS + ("Z", "Q")


class ScriptError(Exception):
    pass


def parse(text):
    """Every directive in the script, as (token, count) pairs in order."""
    out = []
    for number, raw in enumerate(text.split("\n"), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        token = parts[0].upper()
        if token not in TOKENS:
            raise ScriptError("line %d: unknown token %r" % (number, parts[0]))
        if len(parts) == 1:
            out.append((token, 1))
            continue
        if len(parts) != 2 or not parts[1].isdigit() or int(parts[1]) < 1:
            raise ScriptError("line %d: bad repeat count %r" % (number, line))
        out.append((token, int(parts[1])))
    return out


def replay(seed, text):
    """Run the script against a fresh session and return it, with its status."""
    session = Session(seed)
    stopped_on_quit = False
    for token, count in parse(text):
        if stopped_on_quit:
            break
        for _ in range(count):
            if token == "Q":
                stopped_on_quit = True
                break
            if token == "Z":
                session.undo_once()
            else:
                session.move(token)
    session.status = _status(session, stopped_on_quit)
    return session


def _status(session, stopped_on_quit):
    if not session.any_legal():
        return "game_over"
    if stopped_on_quit:
        return "quit"
    return "script_end"


def fields(session):
    """The summary's values, for `src.summary.to_line`."""
    return {
        "schema": SCHEMA,
        "seed": session.seed,
        "grid": [row[:] for row in session.grid],
        "score": session.score,
        "moves": session.moves,
        "rejected": session.rejected,
        "undos": session.undos,
        "ai_moves": session.ai_moves,
        "max_tile": max_tile(session.grid),
        "empty": count_empty(session.grid),
        "won": max_tile(session.grid) >= 2048,
        "status": session.status,
        "rng_state": "%016X" % session.rng.state,
    }
