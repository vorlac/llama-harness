# Migration spec: legacy_http to modern_http

This is the specification for the change. It states the target, the API
differences, the behaviour that must not move, and the places where the mapping
is genuinely undecided. It does not tell you what to decide in those places -
deciding them, and writing down why, is the work.

---

## 1. Target state

Every request the service makes goes through `modern_http`. When the work is
done:

* no file outside `legacy_http/` mentions `legacy_http`, and nothing imports it
  at runtime;
* the test suite passes, unedited;
* `MIGRATION-NOTES.md` exists at the project root and records every decision
  listed in section 5, with the reasoning behind it;
* `scripts/check_migration.sh` passes in strict mode.

`legacy_http/` itself stays in the tree. Do not delete it, do not edit it, and
do not import it.

### The sync/async boundary

`modern_http` is async. `feedservice.app.Application` is not, and stays that
way: `dashboard()`, `refresh()`, `refresh_many()`, `health()`, the poller
controls and `stats()` are called synchronously by the CLI and by the test
suite, and their signatures and return types are fixed.

So the boundary is: **`Application`'s public methods are synchronous; the call
graph below them is async.** How the loop is hosted, and how the poller shares
that loop with foreground calls, is your decision (section 5).

### The migration surface

| Fact | Command |
|---|---|
| 14 references to `legacy_http`, in 4 files | `grep -rn legacy_http feedservice tests` |
| ~35 uses of its response/session API | `grep -rnE '\.(status_code\|error_kind\|get_stream\|ok)\b' feedservice` |
| ~40 functions across 12 modules change colour | follow the call graph in ARCHITECTURE.md |

The four files that import the client library are the easy part. The awkward
parts are the places that are not obviously HTTP code at all:

* `feedservice/retry.py` - a decorator that sleeps between attempts, wrapping
  functions that are about to become coroutines;
* `feedservice/session.py` - a reentrant context manager holding ambient state
  in a `threading.local`;
* `feedservice/tracing.py` - a context manager that installs a client hook, in
  production code, used on every dashboard build;
* `feedservice/poller.py` - a background thread with an `Event`-driven sleep and
  a stop protocol;
* `feedservice/app.py` - a `ThreadPoolExecutor` fan-out that hands a session
  pool to its workers;
* `feedservice/testing.py` - test-support helpers whose synchronous signatures
  the frozen suite depends on.

---

## 2. API differences

| Concern | legacy_http | modern_http |
|---|---|---|
| Call style | `session.get(path)` returns a `Response` | `await session.get(url)` returns a `Response` |
| Session start | construct and use | must be entered: `async with ClientSession(...) as s` (using an unstarted session raises `ConfigurationError`) |
| Session end | `session.close()` | `await session.aclose()`, or leave the `async with` block |
| Status | `response.status_code`, `0` means "no response" | `response.status`; there is no zero status - failures raise |
| Success test | `response.ok` (2xx only) | `response.is_success` (2xx), `response.is_redirect` (3xx) |
| Error statuses | inspected by the caller | `response.raise_for_status()`, or `raise_on_status=True`; **raises for >= 400 only** |
| Transport failure | `status_code == 0` plus `error_kind` in `{"timeout", "connect", "protocol"}` | raises `ConnectError`, `ConnectTimeout`, `ReadTimeout`, `PoolTimeout` or `ProtocolError`, all under `TransportError` |
| Timeout | one float of seconds, covering connect **and** read | `Timeout(connect=..., read=..., total=...)`, all keyword-only and individually optional; no float shorthand exists |
| 401 vs 403 | `status_code` tells them apart | both raise `Unauthorized`; the status is only on `exc.response.status` |
| 429 | `status_code == 429`, `Retry-After` read by the caller | raises `TooManyRequests`, a subclass of `ClientError`, with `.retry_after` parsed for you |
| 404 | `status_code == 404` | raises `NotFound`, a subclass of `ClientError` |
| 5xx | `status_code >= 500` | raises `ServerError` (sibling of `ClientError` under `HTTPStatusError`) |
| Body decode | `response.json()` raises `legacy_http.DecodeError` | `response.json()` raises `modern_http.DecodeError` |
| Streaming | `handle = session.get_stream(...)`; caller must `close()` it | `async with session.stream("GET", url) as response:` |
| Stream iteration | `handle.lines()` - a mid-stream failure **stops quietly** and sets `handle.error_kind` | `response.aiter_lines()` - a mid-stream failure **raises** `ReadTimeout` or `ProtocolError` |
| Request hooks | `add_request_hook(fn)`, plain callable, gets a `RequestRecord` with `timeout_seconds: float` | `add_request_hook(fn)`, **must be a coroutine function**, gets a `Request` with `timeout: Timeout` |
| Timeout taxonomy | one kind: `error_kind == "timeout"` | `ConnectTimeout` and `ReadTimeout` are siblings, with no shared timeout-only base class |

Read `modern_http/errors.py` for the full hierarchy, and run
`python3 -m modern_http._selfcheck` for a worked example of every call form.

### Timeout accounting, precisely

`legacy_http` arms one timer for the whole request: it fails when
`connect_time + read_time > timeout`.

`modern_http` checks each budget it was given: `connect_time` against
`connect` (falling back to `total`), `read_time` against `read` (falling back to
`total`), and, when `total` is set, `connect_time + read_time` against `total`.
A budget left as `None` is unbounded.

An upstream that spends 0.4s connecting and 0.8s responding therefore behaves
differently under different mappings of "one second". The suite contains an
upstream that does exactly this.

---

## 3. Behaviour that must be preserved exactly

Every item here is asserted by the frozen suite; the suite is the arbiter, but
these are the intentions behind it.

1. **Report content and shape.** Same keys, same values, same sort order, same
   determinism: two builds against the same world produce equal reports.
2. **Request counts.** A cold `dashboard()` issues exactly 5 upstream requests
   (catalog index, pricing batch, three inventory pages); `dashboard(live=True)`
   issues 6; a warm build issues 0. `report["upstream_calls"]` reports that
   number and must keep doing so.
3. **Pagination.** Inventory pages are fetched in cursor order, each page's
   cursor coming from the previous page's `Link` header. Pricing is fetched
   after the catalog, because it needs the catalog's ids.
4. **Retry classification.** 429 and timeout/connect/5xx are retried; 4xx,
   undecodable payloads and protocol failures are not. Attempt counts and the
   `retries` counter stay as they are. A protocol failure results in exactly one
   request.
5. **`Retry-After` handling.** A 429 carrying `Retry-After` waits that long
   (capped by `max_delay_seconds`) instead of using the backoff curve.
6. **Cache semantics.** The five source strings (`fresh`, `loaded`,
   `revalidated`, `coalesced`, `stale`) keep their meanings. Concurrent loads of
   one key produce exactly one upstream request and the waiters get the leader's
   result - including its exception. A 304 revalidates in place. A transient
   failure inside the stale grace window serves the stale value; a fatal one
   does not.
7. **Conditional requests.** The catalog's ETag is sent back as `If-None-Match`
   and a 304 response is a success, not an error.
8. **Streaming truncation.** A live-price stream that dies part-way yields the
   records that did arrive, sets `live_truncated`, adds the warning, increments
   `stream_truncations`, and is neither retried nor treated as a degradation.
9. **Health vocabulary.** `Application.health()` returns one of `ok`, `timeout`,
   `connect`, `protocol`, `server`, `throttled`, `rejected`, `malformed` per
   upstream, computed with that upstream's configured timeout budget, without
   retries.
10. **Session pooling.** One dashboard build opens one pool and one session per
    upstream it actually talks to, no matter how deeply scopes nest.
    `refresh_many` shares one pool across all its workers. No scope survives the
    call that opened it: `feedservice.session.current_pool()` is `None` before
    and after.
11. **Error taxonomy.** `feedservice.errors` keeps its classes, their fields
    (`upstream`, `status`, `cause_kind`, `retry_after`, `detail`) and which
    condition raises which.
12. **Counters.** Every name in `feedservice.metrics.COUNTERS` keeps its meaning
    and its arithmetic.
13. **Poller.** It ticks on its interval, warms the same cache the foreground
    reads, counts errors without dying, and stops promptly when asked -
    `stop_poller()` returns `True` well inside its timeout.
14. **Degradation policy.** Catalog failure fails the build; pricing and
    inventory failures degrade it.
15. **CLI.** `python3 -m feedservice.cli` and `bash run.sh` keep their output shape
    and exit codes.

---

## 4. Frozen surface

These names must keep existing, keep their signatures, and stay **synchronous**,
because the frozen suite calls them directly:

* `feedservice.app.Application`: `dashboard(live=False)`, `refresh(key)`,
  `refresh_many(keys)`, `health()`, `start_poller(interval=None, keys=None)`,
  `stop_poller(timeout=2.0)`, `wait_for_poll_ticks(count, timeout=5.0)`,
  `poller_running`, `stats()`, `close()`, context-manager support.
* `feedservice.testing`: `install_upstreams(scenario)`, `capture_requests()` as
  a synchronous context manager yielding a list of `RequestRecord`,
  `RequestRecord.{method,url,timeout_seconds,attempt,path}` where
  `timeout_seconds` is a float, and `probe_url(url, timeout_seconds=1.0)`
  returning `{"ok": bool, "status": int|None, "failure": None|"timeout"|
  "connect"|"protocol"}`.
* `feedservice.session.current_pool()`.
* `feedservice.retry.is_retryable(exc)` and `backoff_delay(attempt, policy)`.
* `feedservice.clients.inventory.next_cursor(link_header)`.
* `feedservice.config`, `feedservice.errors`, `feedservice.metrics.COUNTERS`.

Do not edit: `tests/`, `legacy_http/`, `modern_http/`, `wirenet/`,
`feedservice/demo_upstreams.py`, `scripts/`. If a change seems to require
editing one of these, the change is wrong.

---

## 5. Decisions the spec does not make

Each of these is a genuine fork where the two libraries do not line up. Pick a
side, make the suite green, and write down in `MIGRATION-NOTES.md` what you
picked, what you rejected, and what would make you revisit it.

1. **Mapping a float timeout onto `Timeout`.** The config carries one number per
   upstream and that number means the whole request. `Timeout` has three fields
   and no shorthand. Which field(s) does the number become, and what happens to
   `modern_http`'s own default `Timeout` when a caller passes nothing?

2. **Collapsing the transport taxonomy.** `UpstreamUnavailable.cause_kind` has
   four values; `modern_http` has five transport exception types plus the fact
   that `ConnectTimeout` and `ReadTimeout` share no timeout-specific base class.
   Which exception becomes which cause, and where does `PoolTimeout` - which the
   old library could not express at all - belong?

3. **429 under `ClientError`.** The old code branched on the number 429 before
   it branched on "4xx". The new library makes 429 a *subclass* of the class
   that represents "client error, do not retry". How do you keep 429 retryable
   without making every 4xx retryable, and where do you read `retry_after` -
   from the exception, or from the header, given they can disagree?

4. **304 is not an error and not a success.** `response.is_success` is False for
   304 but `raise_for_status()` does not raise. Where does the conditional-GET
   branch go, and what stops a stray 3xx that is *not* 304 from being silently
   accepted as data?

5. **Streaming failures: exception versus flag.** The old handle stopped quietly
   and set `error_kind`; the new response raises mid-iteration. The service must
   still return the partial records plus a truncated flag. Where do you catch,
   how do you keep the records already consumed, and how do you distinguish "the
   stream broke half way" (a warning) from "the stream never started" (a
   failure)?

6. **Carrying the ambient session scope.** Today it is a `threading.local` with
   a depth stack, plus an explicit `adopt=` for work handed to another worker.
   Under one event loop, what carries it - a plain module global, a
   `contextvars.ContextVar`, something else? What does `adopt=` mean when the
   workers are tasks rather than threads, and what must be true for nested
   scopes to keep coalescing to one pool when several tasks run at once?

7. **Hosting the loop under a synchronous façade.** `Application`'s methods stay
   sync while everything below them is async, and the poller must run in the
   background between foreground calls, sharing one cache with them.
   `asyncio.run()` per call, one long-lived loop owned by the Application,
   something else? Whatever you choose has to make the cache's single-flight and
   the session pool work *between* the poller and foreground calls, not just
   within one of them.

8. **Session lifecycle.** Sessions are created lazily, one per upstream, and
   closed when the scope ends. The new session must be entered as a context
   manager. How do you keep the laziness and the deterministic close without
   turning `session_for()` into something the callers have to `async with`
   themselves?

9. **Sleeping in the retry decorator.** `time.sleep` inside a coroutine stalls
   every other task on the loop. Beyond the obvious swap, decide whether the
   decorator still needs to support synchronous functions, and what it does if
   it is applied to one.

10. **Recording a `Timeout` as a float.** `feedservice.testing.RequestRecord`
    and `feedservice.tracing` observe requests through the library's hook, which
    now hands over a `Timeout` object. `timeout_seconds` must still be a float
    that means "the budget this request was given". Which field do you report
    when the budget is expressed in more than one?

11. **Whether to parallelise.** The report currently fetches its three upstreams
    one after another, and inventory pages strictly in sequence. Async makes
    concurrency cheap. Decide whether to take it - and note that request counts,
    the catalog-before-pricing dependency and the pagination order are all
    pinned by section 3.

12. **Decode versus status order.** The old code checked the status, then
    decoded. `raise_for_status()` invites the reverse. Decide the order and make
    sure a 500 with an HTML error page still surfaces as a server failure rather
    than a payload error.

---

## 6. Checking your work

```sh
bash build.sh                     # byte-compiles, verifies the vendored libraries
bash test.sh                      # the frozen suite, then the completeness gate
scripts/check_migration.sh     # the gate on its own
python3 scripts/poison_legacy.py   # the suite with legacy_http unimportable
python3 -m modern_http._selfcheck  # the new library, exercised on its own
```

`scripts/check_migration.sh` is in "baseline" mode until something imports
`modern_http`, then switches to strict mode. Strict mode fails if any
`legacy_http` reference remains, if the poisoned run fails, or if
`MIGRATION-NOTES.md` is missing or trivial. It also warns when the old library's
vocabulary (`status_code`, `error_kind`, `get_stream`) survives in the new code,
because that is what a compatibility shim looks like from the outside.

**A shim is a failure, not a shortcut.** Re-implementing `legacy_http`'s
interface on top of `modern_http` so that call sites do not have to change fails
this task even if every test is green.
