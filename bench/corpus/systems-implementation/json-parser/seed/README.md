# `json-parser` workspace

A JSON parser for RFC 8259 as pinned by `SPEC.md`, with a canonical serialiser
and a byte-oriented harness. What is here is a partial implementation: it
speaks the protocol, passes the seventeen worked exchanges in `reference-io/`,
and meets most of the specification. `NOTES.md` names what it does not meet.

## Layout

```
SPEC.md                    the normative specification; authoritative
NOTES.md                   what is implemented, what is not, and why
sample.json                the default input for a bare `bash run.sh`
run.sh                     the three modes of SPEC.md section 4
test.sh                    the visible check
src/errors.py              the fourteen codes, JsonError, offset -> line/column
src/utf8.py                whole-input UTF-8 validation and scalar decoding
src/model.py               the parsed value: exact-decimal numbers, no floats
src/parser.py              bytes -> value, one left-to-right pass
src/canonical.py           value -> canonical text
src/main.py                the command line and the harness protocol
reference-io/              seventeen worked exchanges and the script that runs them
```

## Running it

Nothing here carries an execute bit, so every script is reached through its
interpreter:

```sh
bash run.sh                       # parse sample.json, print the canonical form
bash run.sh path/to/doc.json      # parse a file; exit 1 and one stderr line if rejected
bash run.sh --harness             # protocol mode, SPEC.md section 3
bash test.sh                      # the visible check
```

## The visible check and the graded run

`test.sh` runs `reference-io/check_io.py` over both sessions. That is protocol
plumbing plus one example of each error class that is easiest to get subtly
wrong, and it is the only check this workspace can run.

The graded run is a 639-case conformance suite that is **not in this
workspace**. It drives `bash run.sh --harness` through the same protocol from
outside, checks every accept/reject verdict, and for rejections checks the code,
the byte offset, the line and the column; for accepted documents it checks the
canonical form byte for byte and feeds it back in to confirm canonicalisation
is idempotent. There is no case file here to read, and reading one would be a
failed run rather than a clever one.

## Dependencies

Python 3, standard library only. No third-party package, and — per `SPEC.md`
section 2 — no JSON parser from the standard library anywhere in the parse or
serialise path.
