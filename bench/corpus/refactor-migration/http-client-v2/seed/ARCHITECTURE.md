# feedservice

A read-side aggregation service. It reads a product catalog, a pricing service
and an inventory service, joins them, and answers with one report. It caches
aggressively, retries carefully, degrades rather than failing where it can, and
keeps a background poller warming the cache.

Everything runs against `wirenet`, an in-process fake network, so there is no
network access at any point and every run is reproducible.

## Layout

| Path                            | What it is                                                    |
| ------------------------------- | ------------------------------------------------------------- |
| `feedservice/app.py`            | `Application` - the only public surface. Synchronous.         |
| `feedservice/aggregate.py`      | Joins the three upstreams into a report.                      |
| `feedservice/clients/`          | One client per upstream: catalog, pricing, inventory, health. |
| `feedservice/gateway.py`        | Translates HTTP results into `feedservice.errors`.            |
| `feedservice/session.py`        | Session pool and the ambient, reentrant session scope.        |
| `feedservice/cache.py`          | TTL cache: single flight, revalidation, stale-on-error.       |
| `feedservice/retry.py`          | The `@with_retries` decorator and its classification rules.   |
| `feedservice/tracing.py`        | Counts the requests one build issued, via a client hook.      |
| `feedservice/poller.py`         | Background cache warmer.                                      |
| `feedservice/metrics.py`        | Counters, exposed through `Application.stats()`.              |
| `feedservice/config.py`         | Configuration objects and `demo_config()`.                    |
| `feedservice/errors.py`         | The service's own error taxonomy.                             |
| `feedservice/testing.py`        | Test-support helpers. A public contract - see its docstring.  |
| `feedservice/demo_upstreams.py` | The fake upstream world. Library-agnostic.                    |
| `feedservice/cli.py`            | `python3 -m feedservice.cli`.                                 |
| `legacy_http/`                  | Vendored deprecated HTTP client. Frozen.                      |
| `modern_http/`                  | Vendored supported HTTP client. Frozen.                       |
| `wirenet/`                      | Vendored in-process fake network. Frozen.                     |
| `tests/`                        | The behavioural suite. Frozen.                                |

## Request path

```
Application.dashboard()
  trace_requests()                 # hooks the client library, counts requests
    session_scope()                # outermost scope: creates the pool
      ReportBuilder.build()
        CatalogClient.items()      -> TTLCache.get_or_load()
                                       -> @with_retries _fetch_index()
                                            -> session_scope()   (nested, free)
                                               -> Gateway.fetch_json()
                                                  -> pool.session_for("catalog")
        PricingClient.prices_for() -> ... Gateway.post_json()
        InventoryClient.levels()   -> ... Gateway.fetch_json(), once per page
```

`Application.refresh_many()` fans the same work out across a small thread pool,
under one shared session scope that the workers adopt explicitly. The poller
runs the same refresh path on its own worker.

## Retry policy

`feedservice/retry.py` retries transient failures only:

* retried: 429 (honouring `Retry-After`), timeouts, connection failures, 5xx;
* not retried: 4xx other than 429, undecodable bodies, and **protocol
  failures** - a peer emitting garbage keeps emitting garbage, and retrying it
  has turned a broken upstream into an outage before.

Backoff is exponential and deterministic - no jitter - so tests can pin it.

## Cache semantics

Every load reports a source, and those strings are part of the public report:

| source        | meaning                                                  |
| ------------- | -------------------------------------------------------- |
| `fresh`       | the entry was inside its TTL                             |
| `loaded`      | this call fetched it                                     |
| `revalidated` | the upstream answered 304 and the entry survived         |
| `coalesced`   | this call joined a load already in flight                |
| `stale`       | the load failed transiently and the old value was served |

## Running it

```sh
bash build.sh                 # byte-compile, verify the vendored libraries
bash run.sh                   # one report as JSON on stdout
bash run.sh truncated-stream  # ...against a different fake world
bash test.sh                  # the suite, then the migration completeness check
```
