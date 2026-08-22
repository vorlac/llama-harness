"""Shared plumbing for the upstream clients."""

from __future__ import annotations


class BaseClient(object):
    """Holds the wiring every client needs.

    ``retry_policy`` and ``metrics`` are read by the @with_retries decorator, so
    anything decorated with it must expose them - that includes the poller,
    which is not a client at all.
    """

    upstream = None  # type: str

    def __init__(self, config, gateway, cache, metrics):
        if self.upstream is None:
            raise TypeError("%s must set 'upstream'" % (type(self).__name__,))
        self.config = config
        self.gateway = gateway
        self.cache = cache
        self.metrics = metrics

    @property
    def settings(self):
        return self.config.upstream(self.upstream)

    @property
    def retry_policy(self):
        return self.settings.retry

    @property
    def ttl(self) -> float:
        return self.settings.cache_ttl_seconds

    def __repr__(self):
        return "<%s %s>" % (type(self).__name__, self.upstream)
