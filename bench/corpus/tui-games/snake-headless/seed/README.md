# snake-headless

A game of Snake with no terminal in it: a seed and a script of directives go in,
one line of JSON comes out, and the same two inputs always produce the same
bytes.

`SPEC.md` is the specification and is normative in full.

Written already, and not to be changed:

- `src/board.py` — the 40x20 playfield, its free cells in row-major order, and
  the 819-character board string.
- `src/summary.py` — the summary's key order and its compact serialisation.

Still to write: `src/rng.py`, `src/food.py`, `src/engine.py` and
`src/replay.py`, per `SPEC.md` section 1.

Run the visible suite with:

```
python3 tools/run_tests.py tests
```

It covers the two written modules only. It passes as the tree stands and must
keep passing.
