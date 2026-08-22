"""Counters. The public ``Application.stats()`` view is built from these.

Counter names are part of the service's observable surface: tests assert on
them, so a name change is a behaviour change.
"""

from __future__ import annotations

import threading
from typing import Dict

COUNTERS = (
    "upstream_requests",     # every request handed to the HTTP client library
    "pools_opened",          # outermost session scopes entered
    "sessions_opened",       # client sessions actually created
    "cache_hits",            # served from a fresh cache entry
    "cache_misses",          # had to load
    "cache_coalesced",       # joined an in-flight load instead of starting one
    "conditional_hits",      # upstream answered 304 Not Modified
    "stale_served",          # served a stale entry because the upstream failed
    "retries",               # retry attempts made by the retry decorator
    "stream_truncations",    # streaming reads that ended early
    "poller_ticks",
    "poller_errors",
)


class Metrics(object):
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._values = dict((name, 0) for name in COUNTERS)

    def incr(self, name: str, amount: int = 1) -> None:
        if name not in self._values:
            raise KeyError("unknown counter %r" % (name,))
        with self._lock:
            self._values[name] += amount

    def get(self, name: str) -> int:
        with self._lock:
            return self._values[name]

    def snapshot(self) -> Dict[str, int]:
        with self._lock:
            return dict(self._values)

    def reset(self) -> None:
        with self._lock:
            for name in self._values:
                self._values[name] = 0
