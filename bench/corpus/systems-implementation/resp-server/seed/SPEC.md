# SPEC: `resp-server` — a RESP2-speaking key/value server

Version 1.0. This document is the **authoritative** specification for the
`resp-server` task. Where this document and your memory of real Redis disagree,
this document wins. Where a real-world behaviour is implementation-defined, this
document pins one behaviour and says so (see §11). Two independent
implementations that follow this document must agree byte for byte on every
observable response.

The conformance suite is the grader. It is not in this workspace: it drives a
real TCP socket against this server from outside and compares real bytes.
Nothing in this document is decorative.

---

## 1. Scope

You implement a single-process TCP server that speaks the RESP2 protocol and
serves an in-memory keyspace. Required surface:

- **Connection**: `PING`, `ECHO`, `SELECT`, `QUIT`
- **Strings**: `GET`, `SET` (with `EX`, `PX`, `NX`, `XX`, `GET`), `GETSET`,
  `APPEND`, `INCR`, `INCRBY`, `DECR`, `DECRBY`, `STRLEN`, `MGET`, `MSET`
- **Keyspace**: `DEL`, `EXISTS`, `EXPIRE`, `PEXPIRE`, `TTL`, `PTTL`, `PERSIST`,
  `KEYS`, `TYPE`, `RENAME`, `SCAN`
- **Lists**: `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `LRANGE`, `LLEN`, `LREM`, `LINDEX`
- **Hashes**: `HSET`, `HGET`, `HDEL`, `HGETALL`, `HEXISTS`, `HINCRBY`, `HKEYS`,
  `HVALS`, `HLEN`
- **Sets**: `SADD`, `SREM`, `SMEMBERS`, `SISMEMBER`, `SCARD`, `SINTER`, `SUNION`,
  `SDIFF`
- **Transactions**: `MULTI`, `EXEC`, `DISCARD`, `WATCH`, `UNWATCH`
- **Pub/Sub**: `SUBSCRIBE`, `UNSUBSCRIBE`, `PUBLISH`
- **Harness support**: `FLUSHDB`, `DBSIZE`

`UNWATCH`, `PTTL`, `DECRBY`, `FLUSHDB` and `DBSIZE` are required in addition to
the headline list: the first three complete semantics that are otherwise
untestable, and the last two give the conformance harness a deterministic
per-case reset and a way to observe active expiration. They are not optional.

Not required, and not tested: persistence, replication, clustering, `AUTH`,
RESP3 / `HELLO`, keyspace notifications, `PSUBSCRIBE`, blocking commands, sorted
sets, streams, `OBJECT ENCODING`, `INFO`, `CONFIG`.

Anything the server receives that is not in the required surface is an unknown
command (§8.2). Implementing extra commands is allowed and untested; do not let
them change the behaviour of the required ones.

---

## 2. Harness contract

The conformance runner starts your server as a subprocess, waits for it to accept
connections, drives real client sockets against it, and stops it. This section is
the entire interface between the runner and your program. Any deviation makes the
run unscoreable.

### 2.1 Invocation

```
./run.sh --port <PORT>
```

- `run.sh` is invoked with the workspace root as the working directory.
- Nothing in this workspace carries an execute bit: it is seeded from a text
  manifest, which carries file contents and not file modes. The graded runner
  spawns `run.sh` directly and restores its mode before it does. From a shell,
  reach it as `bash run.sh --port <PORT>`.
- `--port <PORT>` gives a TCP port in `1024..65535`. The `--port=<PORT>` equals
  form must also be accepted.
- When `--port` is absent the server listens on port **6399**.
- The server listens on **127.0.0.1** only. Do not bind `0.0.0.0`.
- The listening socket sets `SO_REUSEADDR`.
- Any argument the server does not recognise: print a one-line diagnostic to
  stderr and exit with status `2`. Do not ignore it silently.

### 2.2 Readiness

1. Bind and `listen()` **before** doing anything else that can fail or block.
2. Immediately after `listen()` succeeds, print exactly one line to **stdout**:

   ```
   READY <PORT>
   ```

   terminated by a newline, where `<PORT>` is the decimal port actually bound.
   Flush stdout. This is the only thing your program may ever write to stdout.
3. All logging, diagnostics and errors go to **stderr**.

The runner treats the server as ready when a TCP connection to the port succeeds
**and** an inline `PING` on it is answered `+PONG`. It polls for up to **20
seconds**, then fails the whole run. The `READY` line is required by this spec
and shown in `reference-io/`, but the runner deliberately does not depend on it,
because a language runtime that buffers stdout would otherwise fail the run for a
reason unrelated to the protocol.

### 2.3 Shutdown

- On `SIGTERM` the server closes its listening socket, stops accepting, and exits
  with status `0` within **5 seconds**. The runner sends `SIGKILL` if that
  deadline passes.
- On `SIGINT` behave identically to `SIGTERM`.
- The server must never exit on its own while clients are connected. A crash (any
  exit before `SIGTERM`) fails the case in flight; the runner restarts the server
  and continues (§12.5), but restarts are reported.

### 2.4 Concurrency

- The server must serve at least **64 simultaneous connections**.
- A connection that has sent a *partial* command must never delay another
  connection. This is tested directly: client A writes half a multibulk command
  and stops; client B must still get its `+PONG` immediately; A then completes its
  command and must get the correct reply.
- No busy-waiting. The process must be effectively idle when no client is sending.
- Threads, processes, an event loop or coroutines are all acceptable. The keyspace
  is shared across all connections; concurrent access must not corrupt it or
  produce torn reads.

---

## 3. RESP2 wire format

All lengths are in bytes. `CRLF` means the two bytes `0x0D 0x0A`. All protocol
integers are ASCII decimal.

### 3.1 Reply types

| Type | First byte | Encoding | Example bytes |
|---|---|---|---|
| Simple string | `+` | `+<text>CRLF` | `+OK` |
| Error | `-` | `-<text>CRLF` | `-ERR no such key` |
| Integer | `:` | `:<int64>CRLF` | `:42`, `:-1` |
| Bulk string | `$` | `$<len>CRLF<len bytes>CRLF` | `$3CRLFfooCRLF` |
| Null bulk string | `$` | `$-1CRLF` | `$-1` |
| Array | `*` | `*<count>CRLF` then `<count>` replies | `*2CRLF$1CRLFaCRLF:7CRLF` |
| Empty array | `*` | `*0CRLF` | `*0` |
| Null array | `*` | `*-1CRLF` | `*-1` |

Rules:

1. Simple-string and error payloads never contain CR or LF. Bulk strings are
   binary safe and may contain any byte, CR, LF and NUL included.
2. Integers are serialised without a `+` sign and without leading zeros; zero is
   `:0`.
3. Never emit a null bulk string where this spec says empty array, or a null array
   where it says empty array. The suite compares the exact bytes; a null and an
   empty collection are different replies.
4. Arrays nest. Nested elements are ordinary replies of any type.
5. Every reply is written in full before the next reply on that connection. A
   reply is never interleaved with a pub/sub push on the same connection.

### 3.2 Request framing: multibulk

A normal request is an array of bulk strings:

```
*<argc>CRLF ( $<len>CRLF <len bytes> CRLF ) x argc
```

- `argc` is parsed as a signed 64-bit decimal.
- `argc <= 0`: the request is **silently discarded**. No reply is sent, the
  connection stays open and the parser resets. (`*0` and `*-1` headers both do
  nothing.)
- `argc > 1048576` (1024*1024), or `argc` not a valid decimal integer: reply
  `-ERR Protocol error: invalid multibulk length` and **close the connection**.
- Every element must start with `$`. A different first byte `c` gives
  `-ERR Protocol error: expected '$', got '<c>'` and closes. `<c>` is the
  offending byte written literally if it is printable ASCII (`0x20..0x7E`),
  otherwise as `\x` followed by two lowercase hex digits.
- `len` is parsed as a signed 64-bit decimal. `len < 0`, `len > 536870912`
  (512 MiB), or a malformed number gives
  `-ERR Protocol error: invalid bulk length` and closes.
- The `len` payload bytes must be followed by exactly CRLF. If the two bytes at
  that position are not CRLF, that is a bulk-length violation: reply
  `-ERR Protocol error: invalid bulk length` and close.
- The first argument is the command name; the rest are its arguments. An empty
  command name (`$0`) is an unknown command (§8.2).

### 3.3 Inline commands

If the first byte of a request is **not** `*`, the request is an inline command:
the bytes up to the next LF, with one optional preceding CR stripped.

1. The line is split into arguments by these rules (real Redis `sdssplitargs`):
   - Runs of ASCII space, tab, newline, carriage return, vertical tab and form
     feed separate arguments; leading and trailing runs are ignored.
   - A double-quoted section is one argument (or part of one). Inside it, `\xHH`
     is a byte from two hex digits of either case, and `\n` `\r` `\t` `\b` `\a`
     mean LF, CR, TAB, `0x08`, `0x07`; a backslash before any other byte yields
     that byte literally. The closing quote must be followed by a separator or the
     end of the line, otherwise the line is malformed.
   - A single-quoted section is one argument. Inside it only `\'` is an escape,
     yielding an apostrophe; every other byte, backslash included, is literal. The
     closing quote must be followed by a separator or the end of the line.
   - An unterminated quote, or a closing quote glued to a non-separator, makes the
     line malformed: reply `-ERR Protocol error: unbalanced quotes in request` and
     close.
2. An inline line that yields **zero** arguments (an empty line, or only
   whitespace) produces **no reply**. The connection stays open.
3. If more than **65536** bytes accumulate without an LF, reply
   `-ERR Protocol error: too big inline request` and close.
4. Inline and multibulk requests may be mixed freely on one connection, including
   inside a single TCP segment.

### 3.4 Pipelining

Clients may write several requests without waiting for replies, in any number of
TCP segments, split at any byte boundary. The server must:

- reply to each request in the order received, one reply per request;
- correctly reassemble a request split across reads, including a split inside a
  bulk payload, inside a CRLF, or inside the `*<argc>` header;
- never require a request to arrive in a single read.

### 3.5 Limits

| Limit | Value | On violation |
|---|---|---|
| Multibulk element count | 1048576 | `invalid multibulk length`, close |
| Bulk element length | 536870912 | `invalid bulk length`, close |
| Inline request length | 65536 | `too big inline request`, close |
| Concurrent connections | at least 64 supported | — |

A single value of at least **1 MiB** must round-trip through `SET`/`GET`
unmodified.

### 3.6 Connection teardown

Every protocol error listed in §3.2 and §3.3 is fatal to that connection: write
the error reply, then close the socket. Do not attempt to resynchronise. Command
errors (§8) are **not** protocol errors and never close the connection; `QUIT` is
the only clean, client-requested close.

---

## 4. Execution model

1. **Command lookup is case-insensitive** over ASCII: `set`, `SET` and `SeT` are
   the same command. Argument bytes are never case-folded — keys, values, channel
   names and patterns are case-sensitive and binary safe.
2. **Option keywords** inside a command (`EX`, `NX`, `MATCH`, `COUNT`, ...) are
   also matched case-insensitively.
3. **Arity is checked first**, before any other validation, using the table in
   §8.1. A wrong-arity command produces its error and nothing else happens.
4. **Type is checked before value parsing.** `INCR` on a key holding a list is
   `WRONGTYPE`, not "not an integer". This ordering is uniform: for every command
   the key's type is validated before any argument value is parsed or
   range-checked, so `LPOP k -1` and `LRANGE k x y` on a key holding a string are
   both `WRONGTYPE`, not an argument error. `SET` is the one documented exception,
   because its options are validated before the key is examined at all; its exact
   order is given in §7.3.
5. **Keys, values, fields and members are byte strings.** Any byte, including NUL,
   CR and LF, is legal in any of them. The empty string is a legal key and a legal
   value.
6. **Databases.** There are exactly 16 databases, indexed `0..15`, with completely
   independent keyspaces. Each connection starts on database 0. `SELECT` changes
   the current connection's database only. Pub/sub channels are global (§7.9.4);
   watches are keyed by database (§7.8.4).
7. **Atomicity.** Each command executes atomically with respect to every other
   connection: no other client can observe a half-applied command.
8. **Write ordering.** Replies and pub/sub pushes destined for one connection are
   emitted in the order the server produced them.

---

## 5. Integer parsing: `STRICT_INT64`

Everywhere this spec says an argument or a stored value must be an integer, it is
parsed by exactly this function. There are no exceptions and no lenient call
sites.

```
STRICT_INT64(s) -> int64 or FAIL
  if len(s) == 0                      -> FAIL
  i = 0; negative = false
  if s[0] == '-':
      negative = true; i = 1
      if len(s) == 1                  -> FAIL
  if s[i] == '0':
      if i + 1 != len(s) or negative  -> FAIL   # "0" ok; "00", "01", "-0" not
      return 0
  if s[i] not in '1'..'9'             -> FAIL
  v = 0
  while i < len(s):
      if s[i] not in '0'..'9'         -> FAIL
      v = v * 10 + (s[i] - '0')
      if v overflows uint64           -> FAIL
      i += 1
  if negative:
      if v > 9223372036854775808      -> FAIL
      return -v
  if v > 9223372036854775807          -> FAIL
  return v
```

Consequences the suite tests directly: `01`, `-0`, `+1`, `" 1"`, `"1 "`, the
empty string, `1.0`, `3e2`, `0x10`, a value with a trailing newline, and
`9223372036854775808` all FAIL. `0`, `-1`, `9223372036854775807` and
`-9223372036854775808` succeed.

A FAIL in a **command argument** is `ERR value is not an integer or out of range`.
A FAIL on a **stored string value** is the same message, except for hash fields
under `HINCRBY`, which report `ERR hash value is not an integer or out of range`.

---

## 6. Expiration

1. A key has either no expiry or an absolute expiry timestamp in milliseconds.
2. **Lazy expiration.** Any command that looks a key up must treat a key whose
   expiry is `<= now` as absent: it does not exist, has no type, is not returned
   by `KEYS` or `SCAN`, does not count towards `EXISTS`, and is not a candidate
   for `WRONGTYPE`. Writing to a logically expired key overwrites it as if the key
   were absent — an expired string does not make `LPUSH` fail.
3. **Active expiration.** A background cycle must run at least every **100 ms** and
   remove logically expired keys from every database without any client touching
   them. With a keyspace of 10,000 keys or fewer, every key that expired at time
   `T` must be physically gone by `T + 1000 ms`. This is observable through
   `DBSIZE`, which counts keys **physically present**, and it is tested: an
   implementation that expires only lazily fails the `expiration` group's
   `active-*` cases.
4. Expiry timestamps survive value mutation (`APPEND`, `INCR`, `LPUSH`, `HSET`,
   `SADD`, ...) and are cleared by whole-value replacement (`SET`, `GETSET`,
   `MSET`), by `PERSIST`, by `DEL`, by a `RENAME` onto the key, and by the key
   expiring.
5. `SET` in this spec does **not** support `KEEPTTL`; a plain `SET` always clears
   any existing TTL.
6. Read time from a monotonic clock where the platform offers one. TTL arithmetic
   uses milliseconds throughout.

---

## 7. Command reference

Notation: `argc` is the total number of arguments including the command name.
"Nil" means the null bulk string. "Null array" means the null array reply. Every
command also obeys the arity table (§8.1) and the error catalogue (§8.3).

### 7.1 Connection

| Command | Reply |
|---|---|
| `PING` | `+PONG` |
| `PING <msg>` | bulk `<msg>` |
| `ECHO <msg>` | bulk `<msg>` |
| `SELECT <index>` | `+OK` |
| `QUIT` | `+OK`, then close the connection |

- `SELECT`: `<index>` is `STRICT_INT64`. On FAIL:
  `ERR value is not an integer or out of range`. Outside `0..15`:
  `ERR DB index is out of range`. A successful `SELECT` does not touch
  subscriptions or watches.
- `QUIT` writes `+OK`, flushes, then closes. Any bytes pipelined after `QUIT` on
  the same connection are discarded.
- `PING` behaves differently in subscribed mode; see §7.9.3.

### 7.2 Harness / admin

| Command | Reply |
|---|---|
| `FLUSHDB` | `+OK` — removes every key in the current database only |
| `FLUSHDB ASYNC` / `FLUSHDB SYNC` | `+OK`, same observable effect |
| `DBSIZE` | integer: keys physically present in the current database |

`FLUSHDB` with any other second argument is `ERR syntax error`. `FLUSHDB` does not
alter subscriptions; it **does** dirty every `WATCH` on a key it removed (§7.8.4).

### 7.3 Strings

**`GET key`** — bulk value, or nil if absent. `WRONGTYPE` if the key holds a
non-string.

**`SET key value [EX seconds | PX milliseconds] [NX | XX] [GET]`**

- Options may appear in any order and are case-insensitive.
- `EX` and `PX` are mutually exclusive; `NX` and `XX` are mutually exclusive;
  repeating an option, supplying an unknown token, or giving `EX`/`PX`
  without its argument, is `ERR syntax error`.
- `seconds` / `milliseconds` are `STRICT_INT64`. A FAIL is
  `ERR value is not an integer or out of range`. A value `<= 0`, or one whose
  conversion to an absolute millisecond deadline overflows int64, is
  `ERR invalid expire time in 'set' command`.
- `NX` stores only if the key does not exist; `XX` only if it does. A logically
  expired key counts as not existing.
- Without `GET`: reply `+OK` when the value was stored, nil when `NX` or `XX`
  prevented the store.
- With `GET`: reply the **old** value as a bulk string, or nil when the key was
  absent — whether or not the store happened. If the key exists and holds a
  non-string, reply `WRONGTYPE` and store nothing.
- A successful store clears any existing TTL unless `EX`/`PX` set a new one.
- Validation order: arity, then option syntax, then expire-time validity, then the
  `GET` type check, then the store.

**`GETSET key value`** — store `value`, reply the old value or nil. Clears the
TTL. `WRONGTYPE` if the existing value is not a string.

**`APPEND key value`** — creates the key with `value` if absent, otherwise
appends. Reply: integer new length. Preserves the TTL. `WRONGTYPE` on a
non-string.

**`INCR key`**, **`DECR key`**, **`INCRBY key n`**, **`DECRBY key n`**

- An absent key is treated as `0`.
- The stored value is parsed with `STRICT_INT64`; a FAIL is
  `ERR value is not an integer or out of range`.
- `n` is `STRICT_INT64`; a FAIL is the same message.
- If the result would fall outside int64, reply
  `ERR increment or decrement would overflow` and do not modify the key. That
  includes `DECRBY key -9223372036854775808`.
- Reply: integer new value. The stored value becomes the canonical decimal
  rendering of the result — no leading zeros, a leading `-` for negatives. The TTL
  is preserved.

**`STRLEN key`** — integer length, `0` if absent, `WRONGTYPE` on a non-string.

**`MGET key [key ...]`** — array of bulk strings, one per key, in argument order.
A missing key **and a key holding a non-string** both yield nil. `MGET` never
returns `WRONGTYPE`.

**`MSET key value [key value ...]`** — `argc` must be odd and `>= 3`, otherwise
wrong arity. Always replies `+OK`. Sets every pair, overwriting existing values of
any type, and clears the TTL of every key it sets.

### 7.4 Keyspace

**`DEL key [key ...]`** — integer count of keys actually removed.

**`EXISTS key [key ...]`** — integer count of existing keys, **counting
duplicates**: `EXISTS k k` on an existing `k` replies `2`.

**`EXPIRE key seconds`**, **`PEXPIRE key milliseconds`**

- The interval is `STRICT_INT64`; a FAIL is
  `ERR value is not an integer or out of range`.
- Key absent (or logically expired): reply `0`, do nothing.
- Interval `<= 0`: delete the key immediately, reply `1`.
- Otherwise set the expiry to `now + interval`, replacing any existing one, and
  reply `1`.
- An interval so large that `now + interval` overflows int64 milliseconds is
  `ERR invalid expire time in 'expire' command`, respectively
  `ERR invalid expire time in 'pexpire' command`.

**`TTL key`** — `-2` if the key does not exist, `-1` if it has no expiry,
otherwise the remaining time in seconds as `(remaining_ms + 500) / 1000` using
integer division, floored at `0`.

**`PTTL key`** — `-2` and `-1` as above, otherwise the remaining milliseconds,
floored at `0`.

**`PERSIST key`** — `1` if an expiry was removed, `0` if the key is absent or had
no expiry.

**`KEYS pattern`** — array of every matching key in the current database, in
**unspecified order**, excluding logically expired keys. Matching is by §9.

**`TYPE key`** — simple string `+string`, `+list`, `+hash`, `+set`, or `+none` for
an absent key.

**`RENAME src dst`**

- `src` absent: `ERR no such key`.
- `src == dst` and the key exists: `+OK`, nothing changes.
- Otherwise move the value **and its expiry** to `dst`, overwriting whatever `dst`
  held (of any type) and discarding `dst`'s old expiry. `src` no longer exists.
  Reply `+OK`.

**`SCAN cursor [MATCH pattern] [COUNT count]`**

- `cursor` is an unsigned 64-bit decimal string. Anything else — a negative
  number, a non-numeric string, a value above `18446744073709551615` — is
  `ERR invalid cursor`. Note this is *not* `STRICT_INT64`: `0` and `00` are both
  accepted cursors, but the cursor you emit must have no leading zeros.
- `count` is `STRICT_INT64`; a parse FAIL is
  `ERR value is not an integer or out of range`. A parsed value `< 1` is
  `ERR syntax error`. Its default is `10`. It is a hint; you may return more or
  fewer keys.
- An unknown option token, or `MATCH` / `COUNT` given without its argument, is
  `ERR syntax error`. The cursor is validated before the options, so
  `SCAN abc COUNT 0` is `ERR invalid cursor`.
- Reply: a 2-element array — element 0 is the next cursor as a bulk string,
  element 1 is an array of key bulk strings.
- Guarantees you must provide:
  - Iteration starts at cursor `0` and ends when the returned cursor is `0`.
  - A **full iteration** (repeat until the cursor returns to `0`) returns every key
    that was present in the database for the whole iteration at least once.
  - Duplicates across iterations are allowed.
  - Logically expired keys are never returned.
  - `MATCH` filters the returned keys after selection, by §9; it does not affect
    the cursor.
  - A full iteration over `N` keys must terminate in at most
    `max(64, 4 * ceil(N / count))` calls. The suite enforces this so a pathological
    cursor scheme cannot pass by returning one key per call forever.
  - The cursor value itself is entirely yours: an index into an array, a reverse
    binary increment over a hash table, or a snapshot id. The suite asserts only
    the guarantees above.

### 7.5 Lists

Lists are ordered sequences of byte strings, addressed head (left, index 0) to
tail (right).

**`LPUSH key value [value ...]`** — prepend each value in argument order, so
`LPUSH k a b c` on an empty key yields `[c, b, a]`. Reply: integer new length.

**`RPUSH key value [value ...]`** — append each value in argument order:
`RPUSH k a b c` yields `[a, b, c]`. Reply: integer new length.

**`LPOP key [count]`**, **`RPOP key [count]`**

- Without `count`: reply the removed element as a bulk string, or nil if the key
  is absent.
- With `count`: `count` is `STRICT_INT64` and must be `>= 0`, otherwise
  `ERR value is out of range, must be positive`. Reply an array of up to `count`
  elements removed from the given end, in removal order. `count` of `0` replies an
  **empty array**. An absent key with `count` present replies a **null array**.

**`LRANGE key start stop`** — `start` and `stop` are `STRICT_INT64`. Negative
indexes count from the tail (`-1` is the last element). `start` is clamped up to
`0`, `stop` down to `len-1`. If `start > stop` after normalisation, or the key is
absent, reply an empty array. Otherwise reply the inclusive range.

**`LLEN key`** — integer length, `0` if absent.

**`LREM key count element`** — `count` is `STRICT_INT64`. Remove elements byte-equal
to `element`: `count > 0` from head to tail, at most `count`; `count < 0` from tail
to head, at most `|count|`; `count == 0` all of them. Reply: integer number
removed.

**`LINDEX key index`** — `index` is `STRICT_INT64`, negative counts from the tail.
Reply the element, or nil if the key is absent or the index is out of range.

**Empty-list rule.** Whenever a list command removes the last element the key is
deleted: `EXISTS` becomes `0` and `TYPE` becomes `none`. Never leave a zero-length
list behind.

### 7.6 Hashes

**`HSET key field value [field value ...]`** — `argc` must be `>= 4` and even.
Reply: integer count of fields that did **not** exist before this call.

**`HGET key field`** — bulk value, or nil if the key or field is absent.

**`HDEL key field [field ...]`** — integer count removed. Deletes the key when the
last field goes.

**`HGETALL key`** — flat array `field, value, field, value, ...` in unspecified
order; field/value adjacency must hold. Empty array if absent.

**`HEXISTS key field`** — `1` or `0`.

**`HINCRBY key field increment`** — an absent field is `0`; an absent key creates a
hash. An `increment` FAIL is `ERR value is not an integer or out of range`; a
stored field that FAILs is `ERR hash value is not an integer or out of range`;
overflow is `ERR increment or decrement would overflow`. Reply: integer new value.

**`HKEYS key`** / **`HVALS key`** — array of fields / values, unspecified order,
empty array if absent.

**`HLEN key`** — integer field count, `0` if absent.

### 7.7 Sets

Sets are unordered collections of distinct byte strings.

**`SADD key member [member ...]`** — integer count of members newly added.

**`SREM key member [member ...]`** — integer count removed. Deletes the key when
the last member goes.

**`SMEMBERS key`** — array of members in unspecified order; empty array if absent.

**`SISMEMBER key member`** — `1` or `0`.

**`SCARD key`** — integer cardinality, `0` if absent.

**`SINTER key [key ...]`**, **`SUNION key [key ...]`**, **`SDIFF key [key ...]`**

- Absent keys are treated as empty sets.
- `SINTER` is the intersection of all arguments; a single absent key makes the
  result empty. `SUNION` is the union. `SDIFF` is the first set minus all the
  others; an absent first key makes the result empty.
- Reply: array of members in unspecified order; an empty array when the result is
  empty. Duplicate key names among the arguments are allowed and change nothing.
- If **any** named key exists and holds a non-set, reply `WRONGTYPE`. Type checking
  covers all arguments before any result is computed.

### 7.8 Transactions

#### 7.8.1 `MULTI`

Replies `+OK` and puts the connection in queuing state. `MULTI` while already
queuing replies `ERR MULTI calls can not be nested` and leaves the state alone.

#### 7.8.2 Queuing

While queuing, every command except `MULTI`, `EXEC`, `DISCARD`, `WATCH`,
`SUBSCRIBE`, `UNSUBSCRIBE` and `QUIT` is appended to the queue and answered
`+QUEUED`.

- An **unknown command**, or a command with **wrong arity**, is not queued: reply
  its error immediately (§8.1, §8.2) and set the connection's `dirty-exec` flag.
- `WATCH` while queuing: `ERR WATCH inside MULTI is not allowed`. Not queued, does
  not set `dirty-exec`.
- `SUBSCRIBE` / `UNSUBSCRIBE` while queuing:
  `ERR SUBSCRIBE is not allowed in transactions` /
  `ERR UNSUBSCRIBE is not allowed in transactions`. Not queued, no `dirty-exec`.
- `QUIT` while queuing behaves as a normal `QUIT`: `+OK` and close.
- No other validation happens at queue time. A `SET` with bad option syntax, a
  `WRONGTYPE` operation, an unparsable integer — all of those queue successfully
  and fail at execution time.

#### 7.8.3 `EXEC`

- Outside a transaction: `ERR EXEC without MULTI`.
- With `dirty-exec` set: reply
  `EXECABORT Transaction discarded because of previous errors.` — note the
  trailing period — then discard the queue, clear all watches and leave queuing
  state.
- With any watched key dirty (§7.8.4): reply a **null array**, discard the queue,
  clear all watches and leave queuing state.
- Otherwise execute every queued command in order, atomically with respect to
  other connections, and reply an array with one element per queued command in
  order. A command that fails at execution time contributes its **error reply as an
  array element**; it does not abort the rest.
- An empty queue replies an empty array.
- After `EXEC` the connection leaves queuing state and all its watches are cleared,
  in every one of the cases above.

#### 7.8.4 `WATCH` / `UNWATCH`

- `WATCH key [key ...]` replies `+OK` and marks those keys for this connection.
  Watching the same key twice is harmless. Watches are recorded against
  `(database index, key)`: watching `k` on db 0 is unaffected by writes to `k` on
  db 1.
- A watched key becomes **dirty** when any connection, including the watching one,
  executes a command that **actually changes** it: creates it, alters its value or
  type, deletes it, or renames onto or away from it. `FLUSHDB` dirties every watch
  on a key it removed.
- A command that is a no-op does **not** dirty: `DEL` of an absent key, `LPOP` on
  an absent key, `SREM` of an absent member, a `SET ... NX` that did not store,
  `EXPIRE` on an absent key, or any failed command. Note that `SET k v` where `k`
  already holds `v` **does** dirty — the write happened.
- **Passive expiration does not dirty a watch.** If a watched key simply expires
  between `WATCH` and `EXEC`, the transaction still executes. This is pinned; see
  §11.
- `UNWATCH` replies `+OK` and clears every watch on the connection.
- `EXEC` and `DISCARD` clear watches. Closing the connection clears them.

#### 7.8.5 `DISCARD`

Outside a transaction: `ERR DISCARD without MULTI`. Otherwise `+OK`, discard the
queue, clear `dirty-exec`, clear all watches, leave queuing state.

### 7.9 Pub/Sub

#### 7.9.1 `SUBSCRIBE channel [channel ...]`

For each channel, in argument order, push a 3-element array whose elements are the
bulk string `subscribe`, the channel name as a bulk string, and an integer: the
number of channels this connection is subscribed to **after** processing that
argument. Subscribing to an already-subscribed channel still emits a reply and
leaves the count unchanged. A connection with at least one subscription is in
**subscribed mode**.

#### 7.9.2 `UNSUBSCRIBE [channel ...]`

- With channels: one 3-element array per argument, in argument order, with first
  element `unsubscribe`, second the channel name, third the remaining subscription
  count after that argument. Unsubscribing from a channel the connection is not
  subscribed to still emits its reply.
- With no channels: one reply per currently subscribed channel, in the order the
  connection subscribed to them, counting down to `0`. If the connection has no
  subscriptions, emit exactly one reply whose channel element is a **null bulk
  string** and whose count is `0`.

#### 7.9.3 Subscribed mode

While in subscribed mode only `SUBSCRIBE`, `UNSUBSCRIBE`, `PING` and `QUIT` may
run. Any other command replies

```
ERR Can't execute '<cmd>': only SUBSCRIBE / UNSUBSCRIBE / PING / QUIT are allowed in this context
```

where `<cmd>` is the command's canonical **lowercase** name. The connection stays
open. `PUBLISH` is not in the allow-list: a subscribed connection that publishes
gets this error. Publish from a second connection.

`PING` in subscribed mode does **not** reply `+PONG`. It replies a 2-element array
of bulk strings: `pong` and the empty string for a bare `PING`, or `pong` and the
message for `PING <msg>`.

When the last subscription is dropped the connection leaves subscribed mode and
normal commands work again.

#### 7.9.4 `PUBLISH channel message`

Deliver to every connection subscribed to `channel`, **across all databases** —
channels are global — as a 3-element array of bulk strings: `message`, the channel
name, the payload. Reply to the publisher with the integer number of connections
that received it. A publisher subscribed to its own channel would receive its own
message and count itself, but cannot reach `PUBLISH` from subscribed mode, so in
practice the count excludes the publisher. Delivery to one connection preserves
publish order; ordering between different receiving connections is unspecified.

---

## 8. Errors

Error replies are simple `-`-prefixed lines. The suite compares them **exactly**,
including the leading error code and the capitalisation, because real clients
branch on them.

### 8.1 Arity

Checked before anything else. The error is

```
ERR wrong number of arguments for '<name>' command
```

with `<name>` the **canonical lowercase** command name from this table, not the
spelling the client used.

| Command | Valid `argc` | Command | Valid `argc` |
|---|---|---|---|
| `PING` | 1..2 | `LPUSH` | >= 3 |
| `ECHO` | 2 | `RPUSH` | >= 3 |
| `SELECT` | 2 | `LPOP` | 2..3 |
| `QUIT` | 1 | `RPOP` | 2..3 |
| `FLUSHDB` | 1..2 | `LRANGE` | 4 |
| `DBSIZE` | 1 | `LLEN` | 2 |
| `GET` | 2 | `LREM` | 4 |
| `SET` | >= 3 | `LINDEX` | 3 |
| `GETSET` | 3 | `HSET` | >= 4 and even |
| `APPEND` | 3 | `HGET` | 3 |
| `INCR` | 2 | `HDEL` | >= 3 |
| `DECR` | 2 | `HGETALL` | 2 |
| `INCRBY` | 3 | `HEXISTS` | 3 |
| `DECRBY` | 3 | `HINCRBY` | 4 |
| `STRLEN` | 2 | `HKEYS` | 2 |
| `MGET` | >= 2 | `HVALS` | 2 |
| `MSET` | >= 3 and odd | `HLEN` | 2 |
| `DEL` | >= 2 | `SADD` | >= 3 |
| `EXISTS` | >= 2 | `SREM` | >= 3 |
| `EXPIRE` | 3 | `SMEMBERS` | 2 |
| `PEXPIRE` | 3 | `SISMEMBER` | 3 |
| `TTL` | 2 | `SCARD` | 2 |
| `PTTL` | 2 | `SINTER` | >= 2 |
| `PERSIST` | 2 | `SUNION` | >= 2 |
| `KEYS` | 2 | `SDIFF` | >= 2 |
| `TYPE` | 2 | `MULTI` | 1 |
| `RENAME` | 3 | `EXEC` | 1 |
| `SCAN` | >= 2 | `DISCARD` | 1 |
| `SUBSCRIBE` | >= 2 | `WATCH` | >= 2 |
| `UNSUBSCRIBE` | >= 1 | `UNWATCH` | 1 |
| `PUBLISH` | 3 | | |

### 8.2 Unknown command

```
ERR unknown command '<NAME>'
```

`<NAME>` is the command name **exactly as the client sent it**, byte for byte,
with no case folding and no argument summary. This is a deliberate simplification
of real Redis (§11). The connection stays open. An empty command name produces
`ERR unknown command ''`.

### 8.3 Catalogue

| Text | Raised by |
|---|---|
| `WRONGTYPE Operation against a key holding the wrong kind of value` | any command applied to a key of the wrong type, except `MGET`, which returns nil |
| `ERR value is not an integer or out of range` | a `STRICT_INT64` FAIL on an argument or on a stored string value |
| `ERR hash value is not an integer or out of range` | `HINCRBY` on a field whose value FAILs |
| `ERR increment or decrement would overflow` | `INCR`, `INCRBY`, `DECR`, `DECRBY` or `HINCRBY` result outside int64 |
| `ERR value is out of range, must be positive` | a negative `count` to `LPOP` or `RPOP` |
| `ERR syntax error` | a bad option token or an illegal option combination in `SET`, `SCAN` or `FLUSHDB` |
| `ERR invalid expire time in 'set' command` | `SET` with `EX`/`PX` `<= 0` or overflowing |
| `ERR invalid expire time in 'expire' command` | `EXPIRE` whose absolute deadline overflows |
| `ERR invalid expire time in 'pexpire' command` | `PEXPIRE` whose absolute deadline overflows |
| `ERR no such key` | `RENAME` with a missing source |
| `ERR DB index is out of range` | `SELECT` outside `0..15` |
| `ERR invalid cursor` | `SCAN` with a cursor that is not an unsigned 64-bit decimal |
| `ERR MULTI calls can not be nested` | `MULTI` while queuing |
| `ERR EXEC without MULTI` | `EXEC` outside a transaction |
| `ERR DISCARD without MULTI` | `DISCARD` outside a transaction |
| `EXECABORT Transaction discarded because of previous errors.` | `EXEC` with `dirty-exec` set |
| `ERR WATCH inside MULTI is not allowed` | `WATCH` while queuing |
| `ERR SUBSCRIBE is not allowed in transactions` | `SUBSCRIBE` while queuing |
| `ERR UNSUBSCRIBE is not allowed in transactions` | `UNSUBSCRIBE` while queuing |
| `ERR Can't execute '<cmd>': only SUBSCRIBE / UNSUBSCRIBE / PING / QUIT are allowed in this context` | a disallowed command in subscribed mode |
| `ERR Protocol error: invalid multibulk length` | §3.2, closes the connection |
| `ERR Protocol error: invalid bulk length` | §3.2, closes the connection |
| `ERR Protocol error: expected '$', got '<c>'` | §3.2, closes the connection |
| `ERR Protocol error: unbalanced quotes in request` | §3.3, closes the connection |
| `ERR Protocol error: too big inline request` | §3.3, closes the connection |

---

## 9. Glob matching

`KEYS` and `SCAN ... MATCH` use this matcher. It operates on raw bytes, is
case-sensitive, and has no anchoring — the whole string must be consumed.

```
match(pattern, string):
  '*'         matches any sequence of bytes, including empty
  '?'         matches exactly one byte
  '[' ... ']' matches one byte from the class:
                leading '^' negates the class
                'a-z' inside the class is an inclusive byte range
                '\' inside the class escapes the next byte literally
                a class with no closing ']' extends to the end of the pattern
  '\x'        matches the byte x literally, inside a class or outside one
  any other   matches itself
```

An empty pattern matches only the empty string. Examples the suite checks:

| Pattern | Matches | Does not match |
|---|---|---|
| `*` | everything | — |
| `h?llo` | `hello`, `hallo` | `hllo`, `heello` |
| `h*llo` | `hllo`, `heeeello` | `hllop` |
| `h[ae]llo` | `hello`, `hallo` | `hillo` |
| `h[^e]llo` | `hallo` | `hello` |
| `h[a-c]llo` | `hallo`, `hbllo`, `hcllo` | `hdllo` |
| `\*` | a single asterisk | `x` |
| `key:*` | `key:1`, `key:` | `keys:1` |

---

## 10. Performance floor

The suite is a correctness suite, but it will not wait forever. On a single
connection the server must sustain at least **10,000 simple commands per second**
when pipelined, and must answer any single command the suite issues in under
**2 seconds**. `KEYS` and `SMEMBERS` over 10,000 elements must return within that
bound. An implementation that is O(N) per command where the spec implies O(1) —
storing a hash as an association list and rescanning it per field, say — will
still pass, but nothing may be quadratic in the size of a value.

---

## 11. Pinned decisions

Where real Redis is ambiguous, version-dependent, or awkward to test, this spec
chooses. These are the choices most likely to trip an implementer working from
memory:

1. **The unknown-command error** is `ERR unknown command '<NAME>'` with no
   `, with args beginning with: ...` tail.
2. **The subscribed-mode error** is the fixed string in §7.9.3, naming only the
   four commands this spec supports.
3. **`TTL` rounding** is `(remaining_ms + 500) / 1000`, i.e. round to nearest,
   floored at 0.
4. **Passive expiration does not dirty a `WATCH`.**
5. **`SET` has no `KEEPTTL`**; a plain `SET` always clears the TTL.
6. **`MGET` returns nil for a wrong-type key** rather than an error.
7. **`*0` and `*-1` request headers are silently ignored**, producing no reply.
8. **Inline quoting** follows `sdssplitargs`, including `\xHH` and single quotes.
9. **`DBSIZE` counts physically present keys**, so it is the observable for active
   expiration.
10. **`SCAN` cursors are opaque**; only the guarantees in §7.4 are tested, plus the
    iteration bound.
11. **`EXISTS` counts duplicate arguments separately.**
12. **`STRICT_INT64` rejects leading zeros, a leading `+`, `-0` and surrounding
    whitespace**, uniformly for arguments and for stored values.
13. **There are exactly 16 databases**; channels are global and watches are keyed
    by `(db, key)`.
14. **The key's type is checked before argument values are parsed**, for every
    command except `SET` (§4.4). Real Redis parses some arguments first; this spec
    does not.

---

## 12. The conformance suite

### 12.1 Where it is

The runner and its 869 cases are **not in this workspace**. They are
materialized outside it, after this process has exited, and they drive
`run.sh` from there. There is no case file here to read, and reading one would
be a failed run rather than a clever one.

What is here is `reference-io/` (§13) and the visible check `bash test.sh`,
which runs the eight smoke cases through `reference-io/smoke.py`.

### 12.2 How it is run

The runner starts the server with `run.sh --port <N>`, using the workspace root
as the working directory, waits for readiness (§2.2), runs every case, then
sends `SIGTERM`.

### 12.3 Output

One line per case, then a summary in exactly this shape:

```
conformance: <passed>/<total> passed (<pct>%) in <n> group(s)
```

Exit status is `0` if and only if every selected case passed. Report the
`conformance:` line verbatim when you report your pass rate.

### 12.4 Per-case isolation

Before each case the runner, on a dedicated control connection, pipelines
`SELECT n` and `FLUSHDB` for `n` in `0..15` and then `SELECT 0`. Every client
connection a case opens is closed when the case ends. Your server must therefore
tolerate connections appearing and disappearing continuously; leaking per-client
state — subscriptions, watches, transaction queues — across connections will fail
later cases in ways that look unrelated.

### 12.5 Crash handling

If the server process dies, the runner marks the current case failed with
`server exited`, restarts it (up to 10 times per run) and continues. Restarts are
counted in the summary. A run that exhausts its restarts stops early and the
remaining cases count as failures.

### 12.6 Case file format

Each case file is a JSON object. `reference-io/smoke.json` is one, and it is
the only one in this workspace:

```json
{
  "group": "strings",
  "description": "GET/SET and friends",
  "cases": [
    { "name": "set-then-get",
      "steps": [
        {"cmd": ["SET", "k", "v"], "expect": ["+", "OK"]},
        {"cmd": ["GET", "k"], "expect": ["$", "v"]}
      ] }
  ]
}
```

**All strings in a case file are Latin-1**: every JSON code point in the range
`U+0000..U+00FF` denotes exactly that byte, so `"\u0000"` is a NUL byte and
`"ÿ"` is the byte `0xFF`. No code point above `U+00FF` appears in any case
file.

Step forms. Every step may carry `"client": "<name>"`, defaulting to `"c1"`; a
client name is connected lazily the first time it is used.

| Step key | Meaning |
|---|---|
| `cmd` | array of strings, encoded by the runner as a RESP multibulk request and written |
| `send` | raw bytes to write, verbatim, with no framing added |
| `expect` | read exactly one reply from this client and match it (§12.7) |
| `expect_repeat` | `[n, expectation]` — read `n` replies and match each against the same expectation |
| `expect_closed` | assert the server closes the connection (a read returns EOF) |
| `expect_nothing_ms` | assert no bytes arrive on this client for N milliseconds |
| `sleep_ms` | pause the runner |
| `connect` | open the named connection explicitly |
| `close` | close the named connection |
| `scan_collect` | perform a full `SCAN` iteration and assert its result (§12.8) |
| `note` | a comment; ignored |

A step with `cmd` or `send` and no `expect` writes and reads nothing. A step with
only `expect` reads the next reply. That is how pipelining is expressed: one
`send` carrying several requests, then several `expect` steps.

### 12.7 Expectation forms

An expectation is a 2-element JSON array, `[tag, payload]`:

| Form | Matches |
|---|---|
| `["+", "OK"]` | simple string, exact |
| `["-", "ERR ..."]` | error, exact |
| `["-*", "WRONGTYPE"]` | error whose text starts with the payload |
| `[":", 42]` | integer, exact |
| `[":~", [lo, hi]]` | integer in the inclusive range |
| `["$", "bar"]` | bulk string, exact |
| `["$", null]` | null bulk string |
| `["$*", null]` | any non-null bulk string |
| `["*", ["a", 1, null]]` | array, ordered, element by element |
| `["*", null]` | null array |
| `["*u", ["a", "b"]]` | array compared as an unordered multiset |
| `["*p", ["f", "v", "g", "w"]]` | flat field/value array compared as an unordered multiset of adjacent pairs |
| `["*n", 3]` | array of exactly 3 elements, contents unchecked |
| `["?", null]` | any well-formed reply |

Inside an array payload, a bare JSON string means a bulk string, a bare integer
means an integer reply, and `null` means a null bulk string. A nested JSON array
is itself a tagged expectation. So `["*", [["*u", ["x", "y"]], 1]]` expects a
2-element array whose first element is a 2-element array containing `x` and `y` in
either order, and whose second element is the integer `1`.

### 12.8 `scan_collect`

```json
{"scan_collect": {"match": "k:*", "count": 10, "max_calls": 200},
 "expect_keys": ["k:1", "k:2"]}
```

The runner iterates `SCAN` from cursor `0` until the returned cursor is `0`,
asserting on every call that the reply is a 2-element array whose first element is
an unsigned-64-bit decimal string with no leading zeros and whose second is an
array of bulk strings. It fails if the iteration exceeds `max_calls`. It then
compares the **set** of keys seen against `expect_keys`.

---

## 13. Reference I/O

`reference-io/` holds annotated transcripts of the harness contract and of several
protocol exchanges, written as `C:` (client to server) and `S:` (server to client)
lines with `\r`, `\n` and `\xNN` escapes. They are documentation, not test data —
except `reference-io/smoke.json`, which is a real case file in the format of
§12.6, and `reference-io/smoke.py`, which runs it:

```
bash test.sh
python3 reference-io/smoke.py --run-sh run.sh
```

Eight cases over the harness contract end to end are the visible check. They say
that the plumbing works and nothing about the 869-case suite that grades the
workspace.
