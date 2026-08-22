# Reference I/O

Annotated transcripts of the harness contract and of several protocol exchanges,
written as `C:` (client to server) and `S:` (server to client) lines with `\r`,
`\n` and `\xNN` escapes. They are documentation, not test data.

| File | Covers |
|---|---|
| `01-lifecycle.txt` | startup, the `READY` line, readiness probing, `SIGTERM` |
| `02-strings-and-expiry.txt` | `SET` options, the `INCR` family, `TTL` rounding |
| `03-inline-and-pipelining.txt` | inline commands, quoting, requests split across reads |
| `04-transactions-and-watch.txt` | `MULTI`, `EXEC`, `DISCARD`, optimistic locking |
| `05-pubsub.txt` | `SUBSCRIBE`, `PUBLISH`, subscribed-mode restrictions |
| `06-protocol-errors.txt` | every framing fault of `SPEC.md` section 3 and its close |

`smoke.json` is a real case file in the format of `SPEC.md` section 12.6, and
`smoke.py` runs it against a live server:

```sh
python3 reference-io/smoke.py --run-sh run.sh
```

That is what `bash test.sh` calls. Eight cases over the harness contract say the
plumbing works; the 869-case suite that grades the workspace is not here.
