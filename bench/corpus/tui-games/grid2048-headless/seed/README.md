# grid2048-headless

A game of 2048 with no terminal in it: a seed and a script of move commands go
in, one line of JSON comes out, and the same two inputs always produce the same
bytes.

`SPEC.md` is the specification and is normative in full. `NOTES.md` is the
workspace's own account of which requirements it meets.

Run the visible suite with:

```
python3 tools/run_tests.py tests
```
