"""The rewind stack, per SPEC.md section 7.

A snapshot carries the board and the score, and restoring one writes both back.
The move counter and the generator's state are not part of a snapshot, so an
undo leaves both where the move left them, and a direction replayed after an
undo draws fresh numbers rather than the ones it drew the first time. The stack
is also unbounded. SPEC.md requirements R13 and R14 are the missing halves;
NOTES.md keeps the index.
"""

from src.board import copy

CAPACITY = 20


class UndoStack:
    def __init__(self):
        self.entries = []

    def __len__(self):
        return len(self.entries)

    def push(self, session):
        """Record the state to come back to, taken before a move is applied."""
        self.entries.append((copy(session.grid), session.score))

    def restore(self, session):
        """Rewind to the newest snapshot; report whether there was one."""
        if not self.entries:
            return False
        grid, score = self.entries.pop()
        session.grid = grid
        session.score = score
        return True
