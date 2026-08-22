"""Configuration objects.

Timeouts here are floats of seconds and mean the whole request, because that is
what the HTTP client this service was built on accepts. Every value is data:
nothing in the service reads an environment variable at call time.
"""

from __future__ import annotations

from typing import Dict, Iterable, Tuple

DATA_UPSTREAMS = ("catalog", "pricing", "inventory")


class RetryPolicy(object):
    """How many extra attempts a retryable failure gets, and how long to wait.

    ``retries`` counts RETRIES, not attempts: retries=2 means up to 3 calls.
    """

    __slots__ = ("retries", "backoff_base_seconds", "max_delay_seconds")

    def __init__(self, retries=2, backoff_base_seconds=0.05,
                 max_delay_seconds=1.0):
        self.retries = int(retries)
        self.backoff_base_seconds = float(backoff_base_seconds)
        self.max_delay_seconds = float(max_delay_seconds)

    def replace(self, **overrides) -> "RetryPolicy":
        values = dict(retries=self.retries,
                      backoff_base_seconds=self.backoff_base_seconds,
                      max_delay_seconds=self.max_delay_seconds)
        values.update(overrides)
        return RetryPolicy(**values)

    def __repr__(self):
        return "RetryPolicy(retries=%d, backoff_base_seconds=%r)" % (
            self.retries, self.backoff_base_seconds)


class UpstreamConfig(object):
    __slots__ = ("name", "base_url", "timeout_seconds", "cache_ttl_seconds",
                 "retry")

    def __init__(self, name, base_url, timeout_seconds, cache_ttl_seconds,
                 retry=None):
        self.name = name
        self.base_url = base_url
        self.timeout_seconds = float(timeout_seconds)
        self.cache_ttl_seconds = float(cache_ttl_seconds)
        self.retry = retry if retry is not None else RetryPolicy()

    def replace(self, **overrides) -> "UpstreamConfig":
        values = dict(name=self.name, base_url=self.base_url,
                      timeout_seconds=self.timeout_seconds,
                      cache_ttl_seconds=self.cache_ttl_seconds,
                      retry=self.retry)
        values.update(overrides)
        return UpstreamConfig(**values)

    def __repr__(self):
        return "UpstreamConfig(%r, timeout=%.2fs, ttl=%.1fs)" % (
            self.name, self.timeout_seconds, self.cache_ttl_seconds)


class Config(object):
    __slots__ = ("upstreams", "user_agent", "pool_size", "stale_grace_seconds",
                 "poll_interval_seconds", "max_parallel_refreshes",
                 "live_price_limit")

    def __init__(self, upstreams, user_agent="feedservice/1.4",
                 pool_size=8, stale_grace_seconds=300.0,
                 poll_interval_seconds=0.02, max_parallel_refreshes=4,
                 live_price_limit=64):
        self.upstreams = dict(upstreams)
        self.user_agent = user_agent
        self.pool_size = int(pool_size)
        self.stale_grace_seconds = float(stale_grace_seconds)
        self.poll_interval_seconds = float(poll_interval_seconds)
        self.max_parallel_refreshes = int(max_parallel_refreshes)
        self.live_price_limit = int(live_price_limit)

    # ------------------------------------------------------------ lookups

    def upstream(self, name: str) -> UpstreamConfig:
        try:
            return self.upstreams[name]
        except KeyError:
            raise KeyError("no upstream named %r (have: %s)"
                           % (name, ", ".join(sorted(self.upstreams))))

    def names(self) -> Tuple[str, ...]:
        return tuple(sorted(self.upstreams))

    # ------------------------------------------------------- derived copies

    def _copy(self, upstreams=None, **overrides) -> "Config":
        values = dict(
            upstreams=upstreams if upstreams is not None else dict(self.upstreams),
            user_agent=self.user_agent,
            pool_size=self.pool_size,
            stale_grace_seconds=self.stale_grace_seconds,
            poll_interval_seconds=self.poll_interval_seconds,
            max_parallel_refreshes=self.max_parallel_refreshes,
            live_price_limit=self.live_price_limit,
        )
        values.update(overrides)
        return Config(**values)

    def with_upstream(self, name: str, **overrides) -> "Config":
        upstreams = dict(self.upstreams)
        upstreams[name] = self.upstream(name).replace(**overrides)
        return self._copy(upstreams=upstreams)

    def with_cache_ttl(self, seconds: float, names: Iterable[str] = None) -> "Config":
        upstreams = dict(self.upstreams)
        for name in (names if names is not None else upstreams):
            upstreams[name] = upstreams[name].replace(cache_ttl_seconds=seconds)
        return self._copy(upstreams=upstreams)

    def with_retries(self, retries: int, names: Iterable[str] = None) -> "Config":
        upstreams = dict(self.upstreams)
        for name in (names if names is not None else upstreams):
            upstreams[name] = upstreams[name].replace(
                retry=upstreams[name].retry.replace(retries=retries))
        return self._copy(upstreams=upstreams)

    def with_settings(self, **overrides) -> "Config":
        return self._copy(**overrides)

    def __repr__(self):
        return "Config(upstreams=%s)" % (", ".join(self.names()),)


def demo_config() -> Config:
    """The configuration the service ships with, pointed at the demo upstreams."""
    fast = RetryPolicy(retries=2, backoff_base_seconds=0.0, max_delay_seconds=0.05)
    return Config(upstreams={
        "catalog": UpstreamConfig("catalog", "http://catalog.internal", 2.0, 30.0,
                                  retry=fast.replace(retries=2)),
        "pricing": UpstreamConfig("pricing", "http://pricing.internal", 2.5, 15.0,
                                  retry=fast.replace(retries=2)),
        "inventory": UpstreamConfig("inventory", "http://inventory.internal", 2.0,
                                    20.0, retry=fast.replace(retries=1)),
        "media": UpstreamConfig("media", "http://media.internal", 1.0, 0.0,
                                retry=fast.replace(retries=0)),
        "search": UpstreamConfig("search", "http://search.internal", 1.0, 0.0,
                                 retry=fast.replace(retries=0)),
    })
