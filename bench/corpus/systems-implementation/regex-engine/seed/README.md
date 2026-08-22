# `regex-engine` workspace

A regular expression engine for the dialect pinned by `SPEC.md`, with a parser,
a compiler to the instruction program of §9, a matcher and the line harness of
§3. What is here is a partial implementation: it speaks the protocol, passes the
six worked sessions in `reference-io/`, and meets most of the specification.
`NOTES.md` names what it does not meet.

## Layout

```
SPEC.md                    the normative specification; authoritative
NOTES.md                   what is implemented, what is not, and why
build.sh                   a no-op; the engine runs from source
run.sh                     the harness of SPEC.md section 3
test.sh                    the visible check
src/errors.py              the twelve compile-error codes and the two exceptions
src/wire.py                the ASCII token encoding of section 3.3
src/parse.py               pattern text -> node tree, one left-to-right pass
src/compile.py             node tree -> instruction program, and the dump format
src/matcher.py             running a program over a subject
src/main.py                the request loop
reference-io/              six worked sessions and the script that runs them
```

## Running it

Nothing here carries an execute bit, so every script is reached through its
interpreter:

```sh
bash run.sh                       # the harness; reads requests on stdin
bash test.sh                      # the visible check
echo 'MATCH a\x2ab aab' | bash run.sh
```

## The visible check and the graded run

`bash test.sh` runs `reference-io/check_io.py` over all six sessions. That is
protocol plumbing plus one worked example of each reply shape, and it is the
only check this workspace can run.

The graded run is an 884-case conformance suite that is **not in this
workspace**. It drives `bash run.sh` through the same protocol from outside,
checks every reply exactly, enforces a per-case wall clock, and passes only when
every case passes.

## Dependencies

Python 3, standard library only. No third-party package, and - per `SPEC.md`
§1 - no regular expression library of any kind, including the standard
library's, anywhere in the engine.
