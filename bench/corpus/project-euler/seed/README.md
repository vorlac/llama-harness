# euler

A collection solver: a registry, one module per problem under `src/solvers/`,
and a command line over both.

- `src/registry.py` holds the registry. `register(name, solve)` refuses a
  duplicate name, `get(name)` raises `KeyError` for a name it does not hold,
  and `names()` returns the registered names sorted.
- A solver module defines `solve()`, which takes no arguments and returns an
  int, and calls `register("<module name>", solve)` at import time under its
  own module name. `src/solvers/sum_of_squares.py` is the shape, in full.
- `src/solvers/__init__.py` imports every solver module, so importing the
  package is what registers the collection.
- `src/cli.py` is `list` and `run <name|all>` over the registry.

Run the suite with `python3 tools/run_tests.py tests`.
