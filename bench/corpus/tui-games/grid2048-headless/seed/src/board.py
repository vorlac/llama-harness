"""The 4x4 board and the pure questions that can be asked of one.

Written already. A grid is a list of four rows, each a list of four ints, with
row index 0 at the top and column index 0 at the left. A cell holds 0 or a
power of two.
"""

SIZE = 4


def blank():
    return [[0] * SIZE for _ in range(SIZE)]


def copy(grid):
    return [row[:] for row in grid]


def empty_cells(grid):
    """Every zero cell as (row, column), in row-major order.

    Spawn placement indexes into this list, so its order is part of the
    specification rather than an implementation detail.
    """
    return [
        (r, c)
        for r in range(SIZE)
        for c in range(SIZE)
        if grid[r][c] == 0
    ]


def max_tile(grid):
    return max(value for row in grid for value in row)


def count_empty(grid):
    return sum(1 for row in grid for value in row if value == 0)
