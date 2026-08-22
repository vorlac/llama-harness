"""Sliding and merging, per SPEC.md section 5.

Sliding is here: a row's non-zero values are gathered in order and the row is
padded back to four. Merging is not, so `slide_left` emits every tile it was
given and always reports a gain of zero, and no direction can ever score.
SPEC.md requirement R7 step 2 is the missing half; NOTES.md keeps the index.
"""

from src.board import SIZE, copy


def slide_left(row):
    """The row after a LEFT move, and the score that move adds."""
    values = [value for value in row if value]
    values += [0] * (SIZE - len(values))
    return values, 0


def apply(grid, direction):
    """The grid after a move in `direction`, and the score that move adds.

    Every direction is expressed through `slide_left`, so the merge rule lands
    in one place for all four.
    """
    out = copy(grid)
    gain = 0
    if direction == "L":
        for r in range(SIZE):
            out[r], step = slide_left(out[r])
            gain += step
    elif direction == "R":
        for r in range(SIZE):
            row, step = slide_left(out[r][::-1])
            out[r] = row[::-1]
            gain += step
    elif direction == "U":
        for c in range(SIZE):
            column, step = slide_left([out[r][c] for r in range(SIZE)])
            for r in range(SIZE):
                out[r][c] = column[r]
            gain += step
    elif direction == "D":
        for c in range(SIZE):
            column, step = slide_left([out[r][c] for r in range(SIZE)][::-1])
            column = column[::-1]
            for r in range(SIZE):
                out[r][c] = column[r]
            gain += step
    else:
        raise ValueError("no such direction: %r" % (direction,))
    return out, gain
