"""Application - the public face of the service.

Everything outside this module is internal. Callers (the CLI, the HTTP server
that fronts this service in production, the test suite) use Application and
nothing else, and Application's surface is SYNCHRONOUS: callers hand it a
request and get a report back.

    with Application(demo_config()) as app:
        report = app.dashboard()

Concurrency lives inside: refresh_many fans several refreshes out at once and
the poller runs on its own worker. The cache guarantees that concurrent work on
the same key results in exactly one upstream request.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Iterable, List

from .aggregate import ReportBuilder
from .cache import TTLCache
from .clients import (CatalogClient, HealthClient, InventoryClient,
                      PricingClient)
from .config import DATA_UPSTREAMS, Config, demo_config
from .gateway import Gateway
from .metrics import Metrics
from .poller import Poller
from .session import session_scope
from .tracing import trace_requests


class Application(object):
    def __init__(self, config: Config = None, metrics: Metrics = None):
        self.config = config if config is not None else demo_config()
        self.metrics = metrics if metrics is not None else Metrics()
        self.cache = TTLCache(self.metrics, self.config.stale_grace_seconds)
        self.gateway = Gateway(self.config, self.metrics)
        self.catalog = CatalogClient(self.config, self.gateway, self.cache,
                                     self.metrics)
        self.pricing = PricingClient(self.config, self.gateway, self.cache,
                                     self.metrics)
        self.inventory = InventoryClient(self.config, self.gateway, self.cache,
                                         self.metrics)
        self.health_client = HealthClient(self.config, self.gateway, self.metrics)
        self.reports = ReportBuilder(self.config, self.metrics, self.catalog,
                                     self.pricing, self.inventory)
        self.poller = None
        self.closed = False

    # -------------------------------------------------------- lifecycle

    def __enter__(self) -> "Application":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.close()
        return False

    def close(self) -> None:
        if self.closed:
            return
        self.stop_poller()
        self.cache.clear()
        self.closed = True

    def _check_open(self) -> None:
        if self.closed:
            raise RuntimeError("Application is closed")

    # ------------------------------------------------------------ reads

    def dashboard(self, live: bool = False) -> dict:
        """Build the aggregated report. One session scope covers the build."""
        self._check_open()
        with trace_requests() as trace:
            with session_scope(self.config, self.metrics):
                report = self.reports.build(live=live)
        report["upstream_calls"] = trace.count
        return report

    def health(self) -> Dict[str, str]:
        """Probe every upstream. Returns {upstream: state}."""
        self._check_open()
        return self.health_client.check_all()

    # --------------------------------------------------------- refreshes

    def refresh(self, key: str) -> str:
        """Refresh one cache key. Returns the cache source for the load."""
        self._check_open()
        with session_scope(self.config, self.metrics) as pool:
            return self._refresh_one(key, pool)

    def refresh_many(self, keys: Iterable[str]) -> List[str]:
        """Refresh several keys at once, under a single session scope.

        Duplicate keys are not de-duplicated here on purpose: coalescing
        concurrent loads of the same key is the cache's job, and doing it twice
        would hide a bug in the cache.
        """
        self._check_open()
        keys = list(keys)
        if not keys:
            return []
        with session_scope(self.config, self.metrics) as pool:
            workers = min(self.config.max_parallel_refreshes, len(keys))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = [executor.submit(self._refresh_one, key, pool)
                           for key in keys]
                return [future.result() for future in futures]

    def _refresh_one(self, key: str, pool) -> str:
        # Runs on a worker that cannot see the caller's ambient scope, so the
        # caller's pool is adopted explicitly.
        with session_scope(self.config, self.metrics, adopt=pool):
            if key == "catalog":
                return self.catalog.items().source
            if key == "pricing":
                ids = [item["id"] for item in self.catalog.items().value]
                return self.pricing.prices_for(ids).source
            if key == "inventory":
                return self.inventory.levels().source
            raise KeyError("no refreshable key %r (have: %s)"
                           % (key, ", ".join(DATA_UPSTREAMS)))

    # ------------------------------------------------------------ poller

    def start_poller(self, interval: float = None, keys=None) -> None:
        self._check_open()
        if self.poller is not None and self.poller.running:
            return
        self.poller = Poller(self.config, self.metrics, self.refresh,
                             keys=keys, interval=interval)
        self.poller.start()

    def stop_poller(self, timeout: float = 2.0) -> bool:
        if self.poller is None:
            return True
        stopped = self.poller.stop(timeout=timeout)
        self.poller = None
        return stopped

    def wait_for_poll_ticks(self, count: int, timeout: float = 5.0) -> bool:
        if self.poller is None:
            return False
        return self.poller.wait_for_ticks(count, timeout=timeout)

    @property
    def poller_running(self) -> bool:
        return self.poller is not None and self.poller.running

    # ------------------------------------------------------------- stats

    def stats(self) -> Dict[str, int]:
        return self.metrics.snapshot()

    def __repr__(self):
        return "<feedservice.Application %s%s>" % (
            ",".join(self.config.names()), " CLOSED" if self.closed else "")
