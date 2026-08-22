from src.registry import register


def solve():
    return sum(1 for n in range(1, 361) if 360 % n == 0)


register("count_divisors", solve)
