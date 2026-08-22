# Log format and report contract

This is the prose statement of what `reference/aggregate.py` computes. The
reference implementation is the final authority: where this document and the
code disagree, the code wins, because the correctness suite compares against
the code.

Read this before you optimise anything. Most of the available speed comes from
exploiting guarantees stated here — but every one of them is a guarantee about
*the generated workload*, not about *validity*. Section 3 spells out the
difference, and the correctness suite tests it.

---

## 1. Input

A UTF-8 text file, one JSON object per line, LF line endings, final line
terminated. Written by `tools/generate_workload.py`, which is seeded and
produces byte-identical output for a given `(--lines, --seed, --minutes)`
triple on any machine and any CPython 3.8+.

A well-formed record has exactly these nine keys:

| key | type | meaning |
|---|---|---|
| `ts` | string | event timestamp, `YYYY-MM-DDTHH:MM:SS.mmmZ` |
| `endpoint` | string | request path as received, may carry ids and a query string |
| `method` | string | HTTP method |
| `status` | integer | HTTP status code |
| `dur_ms` | integer | server-side duration in whole milliseconds |
| `bytes` | integer | response body size in bytes |
| `session` | string | client session id |
| `user` | string | user id |
| `region` | string | edge region that served the request |

Example line, exactly as the generator writes it:

```
{"ts":"2026-03-14T08:00:00.951Z","endpoint":"/api/v2/cart","method":"GET","status":200,"dur_ms":824,"bytes":212,"session":"sess-214d29a58103","user":"u-001574","region":"us-west-2"}
```

### Properties of the generated workload

These hold for every file `tools/generate_workload.py` writes, and you may
build a fast path around them:

- keys appear in the canonical order listed above;
- the serialisation is compact — no space after `:` or `,`;
- no string value contains a `"`, a `\`, or a non-ASCII character, so no JSON
  string escape ever appears;
- `ts` always falls on the single calendar day the generator was asked for, so
  the log never crosses midnight;
- events are *not* sorted by `ts`: the generator applies up to +/-3000 ms of
  jitter, so a session's events are interleaved with other sessions' and are
  out of order within the file;
- roughly one line in a thousand is deliberately malformed.

## 2. Validity

A line is a **record** if and only if all of the following hold. Anything else
is **malformed**: it is counted and otherwise ignored.

1. The line, with `line.rstrip("\n")` applied, is not empty. The file is
   read in text mode with UTF-8 decoding; input is LF-terminated.
2. It parses as JSON (`json.loads` semantics) and yields an object.
3. Its key set is exactly the nine keys above — no missing key, no extra key.
4. `ts` is a string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`.
5. `endpoint` is a string beginning with `/`.
6. `method`, `session`, `user`, `region` are non-empty strings.
7. `status` is an integer (JSON `true`/`false` do not count) in `100..599`.
8. `dur_ms` and `bytes` are integers (again, not booleans) and `>= 0`.

A JSON float never satisfies rules 7 or 8, even when it is integral: `1.0` and
`1e3` are malformed values.

## 3. The guarantee that is *not* a guarantee

Section 1's bullet list describes the bytes the generator emits. Section 2
defines validity in terms of JSON semantics. These are different statements,
and the correctness fixtures in `tools/check_correctness.py` contain
hand-written lines that are valid under section 2 while violating section 1's
byte-level shape:

- keys in a non-canonical order;
- whitespace after `:` and `,`;
- JSON escapes in string values: `"\/api\/v2\/orders"` decodes to
  `/api/v2/orders`, and `"\u0075-000042"` decodes to `u-000042`.

Every one of those lines is a record and must be aggregated. A fast positional
parser is the right idea, but it has to *verify* that the line really has the
canonical shape and fall back to a general JSON parse when it does not. The
fallback costs nothing on the generated workload, where it is taken about once
per thousand lines.

## 4. Derived values

**Normalised endpoint.** Cut the raw `endpoint` at the first `?` and discard
the query string. Split the remainder on `/`. Replace every segment that is
entirely ASCII digits, or that is exactly 32 lowercase hex characters, with the
literal `{id}`. Rejoin with `/`.

- `/api/v2/orders/48213` -> `/api/v2/orders/{id}`
- `/api/v2/search?q=blue+widget&page=2` -> `/api/v2/search`
- `/api/v2/users/3f0c1a9d2b4e5f60718293a4b5c6d7e8` -> `/api/v2/users/{id}`
- `/api/v2/cart/` -> `/api/v2/cart/` (a trailing slash is *not* removed; the
  empty final segment is not an id, so `/api/v2/cart` and `/api/v2/cart/` are
  two different endpoints)

**Minute label.** The first minute of `ts`, formatted `YYYY-MM-DDTHH:MMZ`. For
`2026-03-14T08:07:31.482Z` the label is `2026-03-14T08:07Z`.

**Epoch milliseconds.** `ts` interpreted as UTC, expressed as an exact integer
number of milliseconds since `1970-01-01T00:00:00Z`.

**Exact percentile.** For a non-empty list of integer durations and an integer
percentile `p`, sort ascending and take the element at 1-based rank

```
rank = ceil(p * n / 100)      computed with integer arithmetic
```

clamped into `1..n`. This is the nearest-rank definition. It is exact by
construction: **no sampling, no interpolation, no t-digest, no HDR histogram
with bucket error, no reservoir.** An answer that is off by one unit on one
percentile of one bucket is a failing answer.

**Mean.** The exact integer sum of the bucket's durations divided by the
integer count, then `round(x, 4)`. Sum the integers as integers; accumulating
into a float loses precision and will diverge on large buckets.

## 5. Output

A single JSON document written to the path given as the second argument,
serialised with `json.dump(report, fh, indent=2, ensure_ascii=True)` followed
by one `\n`. Key order is insertion order and is part of the contract. The
correctness suite compares the file **byte for byte** against the reference.

Top-level keys, in this order:

### `meta`
| field | value |
|---|---|
| `input` | the basename of the input path (everything after the last `/`) |
| `lines_read` | total lines read, malformed included |
| `records` | lines that were valid records |
| `malformed` | `lines_read - records` |
| `first_malformed_lines` | 1-based line numbers of the first 10 malformed lines, ascending |

### `buckets`
One entry per `(minute, normalised endpoint, status)` triple that occurs at
least once, sorted by `(minute, endpoint, status)` ascending — plain string
comparison for the first two, numeric for the third. Fields in order:
`minute`, `endpoint`, `status`, `count`, `bytes`, `min_ms`, `max_ms`,
`mean_ms`, `p50_ms`, `p95_ms`, `p99_ms`. `bytes` is the sum of the bucket's
`bytes` values; the `*_ms` fields describe its `dur_ms` values.

### `status_totals`
One `{status, count}` entry per status code seen, ascending by code.

### `top_endpoints`
The 20 normalised endpoints with the highest record count, ordered by count
descending then endpoint ascending. Fields: `endpoint`, `count`, `bytes`,
`p99_ms` — where `p99_ms` is the exact p99 over *every* duration recorded for
that endpoint, across all minutes and all statuses.

### `top_users`
The 20 users with the highest total `bytes`, ordered by bytes descending then
user id ascending. Fields: `user`, `bytes`, `count`.

### `regions`
Every region, ordered by count descending then region ascending. Fields:
`region`, `count`, `bytes`.

### `slowest_requests`
The 25 slowest individual records, ordered by `dur_ms` descending then 1-based
input line number ascending. Fields: `line`, `ts`, `endpoint` (normalised),
`status`, `dur_ms`, `session`.

### `sessions`
A session is every record sharing one `session` value. Its events are ordered
by `(ts, line number)` ascending — `ts` compared as a string, which is
equivalent to chronological order given the fixed timestamp width.

| field | value |
|---|---|
| `total` | number of distinct sessions |
| `converted` | sessions with at least one event whose normalised endpoint is `/api/v2/checkout` **and** whose status is exactly `200` |
| `multi_endpoint` | sessions touching more than one distinct normalised endpoint |
| `longest` | the 25 sessions with the largest `span_ms`, ordered by `span_ms` descending then session id ascending |
| `top_paths` | the 10 most common session paths, ordered by count descending then path ascending; a path is the session's distinct normalised endpoints in first-touch order, joined with `" > "` |

Each entry of `longest` has, in order: `session`, `user` (the user id on the
session's *first* event), `events` (event count), `first_ts`, `last_ts`,
`span_ms` (epoch millis of `last_ts` minus epoch millis of `first_ts`),
`endpoints` (the distinct normalised endpoints in first-touch order, as a
list), `converted` (boolean).

Each entry of `top_paths` has `path` then `count`.

## 6. Command-line contract

```
python3 reference/aggregate.py <input.log> <output.json>
./run.sh [<input.log>] [<output.json>]
```

`run.sh` defaults to `data/access.log` and `out/report.json` when called
without arguments. Both programs exit 0 on
success. Anything they print goes to stderr; stdout is not part of the
contract for this category.

`run.sh` must launch Python as `"${LOGAGG_PYTHON:-python3}"`. Both
`tools/bench.py` and `tools/check_correctness.py` export `LOGAGG_PYTHON` as the
interpreter they are themselves running under, and they run the reference under
that same interpreter. Without this, a candidate launched under a newer CPython
than the reference would report a speedup that is partly a CPython release
note, and the measurement would not mean what it claims to mean.
