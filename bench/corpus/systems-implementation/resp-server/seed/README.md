# `resp-server` workspace

A RESP2-speaking key/value server as pinned by `SPEC.md`: protocol framing, the
keyspace, expiration, and the string, list, hash and set families. What is here
is a partial implementation: it speaks the protocol, passes the eight smoke
cases in `reference-io/`, and meets most of the specification. `NOTES.md` names
what it does not meet.

## Layout

```
SPEC.md                    the normative specification; authoritative
NOTES.md                   what is implemented, what is not, and why
build.sh                   a no-op; the server runs from source
run.sh                     starts the server, SPEC.md section 2
test.sh                    the visible check
src/resp.py                RESP2 replies out, requests in, inline splitting
src/values.py              STRICT_INT64 and the glob matcher
src/store.py               sixteen databases, values, expiries, SCAN
src/commands.py            the command table and the families implemented here
src/server.py              sockets, one thread per connection, the expiry cycle
src/main.py                the command line
reference-io/              annotated transcripts, smoke.json and the script that runs it
```

## Running it

Nothing here carries an execute bit, so every script is reached through its
interpreter:

```sh
bash run.sh --port 7000           # start the server
bash test.sh                      # the visible check
```

## The visible check and the graded run

`bash test.sh` runs `reference-io/smoke.py`, which starts the server on a free
port and drives the eight smoke cases over real sockets. That is the harness
contract end to end - framing, pipelining, two connections, one error of each
shape - and it is the only check this workspace can run.

The graded run is an 869-case conformance suite that is **not in this
workspace**. It drives real client sockets against `run.sh --port N` from
outside, compares exact bytes, resets every database between cases, and passes
only when every case passes.

## Dependencies

Python 3, standard library only. No third-party package.
