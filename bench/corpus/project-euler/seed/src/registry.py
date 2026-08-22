"""The solver registry: one common interface every solver is reached through."""

_SOLVERS = {}


def register(name, solve):
    if name in _SOLVERS:
        raise ValueError("solver %r is already registered" % name)
    _SOLVERS[name] = solve


def get(name):
    if name not in _SOLVERS:
        raise KeyError(name)
    return _SOLVERS[name]


def names():
    return sorted(_SOLVERS)
