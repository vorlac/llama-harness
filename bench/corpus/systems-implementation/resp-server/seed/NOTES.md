# `resp-server` — implementation notes

## What this workspace is

A partial implementation of `SPEC.md`. The RESP2 framing of section 3 is
complete, including inline commands and their quoting, pipelining across
arbitrary read boundaries, and every protocol error and its connection close.
Sixteen databases, lazy and active expiration, and the connection, admin,
string, keyspace, list, hash and set families are all here.

The last graded run of this workspace, against the 869-case conformance suite,
reported:

```
conformance: 752/869 passed (86.5%) in 14 group(s)
```

Every one of the 117 failures is a case that runs a transaction command or a
pub/sub command. Both families are absent from the command table, so the
dispatcher answers them as unknown commands, and a case whose first step is
`MULTI` or `SUBSCRIBE` fails there. By group: `transactions` 60, `pubsub` 44,
nine `errors` cases that check those commands' arity, three `concurrency` cases
that use a transaction or a subscription to hold a connection open, and one
`binary` case that publishes on a channel whose name carries a NUL.

## Unimplemented

### Section 7.8 — transactions

`MULTI`, `EXEC`, `DISCARD`, `WATCH` and `UNWATCH` are not in `COMMANDS`.

The command table and the arity check are ready for them: `register` takes the
canonical name and the arity bounds of section 8.1, and `dispatch` in
`src/server.py` checks arity before anything else, so an entry for each of the
five is the whole of the table-side work.

What is not ready is the connection state they need. `Session` in
`src/server.py` carries the current database and a closing flag and nothing
else; queuing needs a queue, a `dirty-exec` flag and the rule that every command
but the seven control commands is answered `+QUEUED` rather than run. Optimistic
locking needs more: a watch is `(database index, key)` against a version the
server keeps, and a version moves only when a command **actually changes** that
key. Section 7.8.4's list of no-ops that must not dirty a watch - a `DEL` of an
absent key, an `SREM` of an absent member, a `SET ... NX` that did not store -
is the awkward half, and section 11.4 pins the other one: a key that simply
expires between `WATCH` and `EXEC` does not dirty anything, so the expiry cycle
in `src/server.py` and `Database.alive` must stay outside whatever records a
change.

### Section 7.9 — pub/sub

`SUBSCRIBE`, `UNSUBSCRIBE` and `PUBLISH` are not in `COMMANDS`.

This family is the one place in the specification where a command writes to a
connection other than the one that issued it, and `src/server.py` has no path
for that: `_serve` reads a request, dispatches it under the keyspace lock, and
writes the reply back on the same socket. A push needs the channel registry to
hold the target sessions, a per-connection write lock so a push and a reply are
never interleaved (section 3.1 rule 5), and the registry cleared when a
connection closes, because section 12.4 opens and closes connections
continuously and leaked subscriptions fail later cases in ways that look
unrelated.

Subscribed mode is the other half: `dispatch` gates the four allowed commands
and answers everything else with the fixed error of section 7.9.3, and `PING`
stops replying `+PONG` and replies the two-element array instead.

## Requirements index

| Section | Requirement                                                    | Where                                    |
| ------- | -------------------------------------------------------------- | ---------------------------------------- |
| §2.1    | `--port N` and `--port=N`; 6399 by default; exit 2 on anything else | `src/server.py:parse_port`          |
| §2.2    | Bind and listen first, then one `READY <port>` line on stdout    | `src/server.py:Server.run`               |
| §2.3    | `SIGTERM` and `SIGINT` close the listener and exit 0             | `src/server.py:main`                     |
| §2.4    | 64 connections; a partial command blocks only its own connection | `src/server.py:Server._serve`            |
| §3.1    | The seven reply encodings, null and empty kept distinct          | `src/resp.py`                            |
| §3.2    | Multibulk framing and its three protocol errors                  | `src/resp.py:_next_multibulk`            |
| §3.3    | Inline commands and `sdssplitargs` quoting                       | `src/resp.py:split_inline`               |
| §3.4    | Pipelining and reassembly across arbitrary read boundaries       | `src/server.py:Server._serve`            |
| §3.5    | The multibulk, bulk and inline ceilings                          | `src/resp.py`                            |
| §3.6    | A protocol error is fatal to its connection                      | `src/server.py:Server._serve`            |
| §4.1    | Case-insensitive command lookup, case-sensitive arguments        | `src/server.py:dispatch`                 |
| §4.3    | Arity checked before anything else                               | `src/server.py:dispatch`                 |
| §4.4    | Type checked before argument values are parsed                   | `src/commands.py:typed`                  |
| §4.6    | Sixteen independent databases                                    | `src/store.py:Keyspace`                  |
| §4.7    | One command at a time, atomically                                | `src/server.py:Server._serve`            |
| §5      | `STRICT_INT64` at every call site                                | `src/values.py:strict_int64`             |
| §6.2    | Lazy expiration on every lookup                                  | `src/store.py:Database.alive`            |
| §6.3    | The active cycle, and DBSIZE as its observable                   | `src/server.py:Server._sweeper`          |
| §7.1    | `PING`, `ECHO`, `SELECT`, `QUIT`                                 | `src/commands.py`                        |
| §7.2    | `FLUSHDB`, `DBSIZE`                                              | `src/commands.py`                        |
| §7.3    | The string family, and `SET`'s validation order                  | `src/commands.py:do_set`                 |
| §7.4    | The keyspace family, including `SCAN`'s guarantees               | `src/commands.py`, `src/store.py:Database.scan` |
| §7.5    | The list family and the empty-list rule                          | `src/commands.py`                        |
| §7.6    | The hash family                                                  | `src/commands.py`                        |
| §7.7    | The set family, type-checking every argument first               | `src/commands.py:_set_operands`          |
| §7.8    | Transactions                                                     | **unimplemented** — see above            |
| §7.9    | Pub/sub                                                          | **unimplemented** — see above            |
| §8.1    | The arity table                                                  | `src/commands.py:register`               |
| §8.2    | `ERR unknown command '<NAME>'`, byte for byte                    | `src/commands.py:unknown_command`        |
| §8.3    | The error catalogue                                              | `src/commands.py`                        |
| §9      | Glob matching on raw bytes                                       | `src/values.py:glob_match`               |

## Design decisions

- **One thread per connection, one lock per command.** Section 2.4 requires a
  connection holding half a command not to delay another, and a thread per
  connection gives that without an event loop. The lock is taken for the
  duration of one command and nothing longer, which is section 4.7's atomicity
  and is also the seam a transaction's `EXEC` will need.
- **The request parser re-reads from the start.** `next_request` walks the
  buffer again on every read rather than keeping a resumable state machine. The
  walk is proportional to the number of elements and not to the number of bytes,
  because a bulk payload is skipped by its declared length, so a megabyte value
  arriving in sixteen segments costs sixteen short walks.
- **Every lookup goes through `Database.alive`.** Section 6.2's lazy rule then
  holds for every command without any command having to remember it, and the one
  place that deliberately does not consult it is `Database.size`, because
  section 11.9 makes `DBSIZE` the observable for the active cycle.
- **`SCAN` buckets keys by CRC32 into a fixed 1024 slots.** The bucket count
  never changes, so a key present for a whole iteration is always in the same
  bucket and is returned when that bucket is visited, which is section 7.4's
  full-iteration guarantee. Visiting at least sixteen buckets per call bounds a
  full iteration at 64 calls, which is the floor the same section sets.
- **The overflow band is open at the bottom.** `checked_sum` refuses a result of
  exactly INT64_MIN, because `DECRBY` reaches a result by negating its argument
  and INT64_MIN has no negation inside the type. Storing INT64_MIN with `SET`
  and reading it back is unaffected: the band is on the result of an arithmetic
  command, not on a stored value.
