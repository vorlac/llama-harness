# Reference I/O

Worked sessions for the harness contract in `SPEC.md` §3. Use them to check the
plumbing - framing, escaping, flushing - before anything else: a framing bug
looks like 884 semantic failures in the graded run.

Each `NN-name.in` is a script of request lines. Each `NN-name.out` is the reply
stream the harness must produce for it:

```sh
bash run.sh < reference-io/01-plumbing.in | diff -u reference-io/01-plumbing.out -
```

`check_io.py` runs all six at once and is what `bash test.sh` calls.

| File | Covers |
|---|---|
| `01-plumbing.in` | framing, wire escapes, the `-` convention for the empty string, protocol errors |
| `02-submatch.in` | capture-group reporting, including `-1 -1` for a group that did not participate |
| `03-find.in` | the successive-match scan, empty matches, assertions during a scan |
| `04-errors.in` | compile diagnostics: code and code-point position |
| `05-program.in` | five compiled-program dumps |
| `06-unicode.in` | code point offsets over multibyte text |

`05-program.out` is **illustrative**, not exact: the graded run checks the
structural properties in `SPEC.md` §9.3, so any well-formed compilation of those
patterns is accepted, and `check_io.py` checks the shape of the dump rather than
its text. Every other file diffs clean against a correct implementation, byte
for byte.
