"""The playfield: its size, its free cells, and the board string of a summary.

Pure geometry over a snake and a food cell. Nothing here knows about ticks,
collisions or the generator, which is what lets the visible suite check it on
a seed that has no game in it yet.
"""

WIDTH = 40
HEIGHT = 20


def in_bounds(x, y):
    return 0 <= x < WIDTH and 0 <= y < HEIGHT


def free_cells(snake):
    """Every cell no snake segment occupies, in ascending row-major order.

    Row-major index is y * WIDTH + x, so the list runs left to right within a
    row and top to bottom across rows. Food placement indexes into this list,
    so its order is part of the specification rather than an implementation
    detail.
    """
    taken = set(snake)
    return [
        (x, y)
        for y in range(HEIGHT)
        for x in range(WIDTH)
        if (x, y) not in taken
    ]


def render(snake, food):
    """The 819-character board string: 20 rows of 40 joined by '/'.

    One character per cell: '.' empty, '#' body, '@' head, '*' food. The head
    is written last, so a head drawn over any other glyph still reads '@'.
    """
    cells = [["."] * WIDTH for _ in range(HEIGHT)]
    for x, y in snake[1:]:
        cells[y][x] = "#"
    if food is not None:
        cells[food[1]][food[0]] = "*"
    head_x, head_y = snake[0]
    cells[head_y][head_x] = "@"
    return "/".join("".join(row) for row in cells)
