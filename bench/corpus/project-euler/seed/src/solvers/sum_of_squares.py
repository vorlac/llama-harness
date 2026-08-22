from src.registry import register


def solve():
    return sum(n * n for n in range(1, 11))


register("sum_of_squares", solve)
