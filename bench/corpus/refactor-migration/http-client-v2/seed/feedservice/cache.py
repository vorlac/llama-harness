"""TTL cache with single-flight loading, conditional revalidation and
stale-on-error.

Three behaviours here are load-bearing and are asserted by the test suite:

1. Single flight. Concurrent loads of the same key produce exactly ONE upstream
   request. Late arrivals join the in-flight load and receive its result -
   including its exception.
2. Revalidation. A loader may return NOT_MODIFIED, meaning the upstream said
   304; the cached value survives and its age resets.
3. Stale on error. If a load fails with a *transient* error and the entry is
   still within the stale grace window, the stale value is served instead of
   raising.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Optional

from .errors import FeedError
from .retry import is_retryable


class _NotModified(object):
    def __repr__(self):
        return "NOT_MODIFIED"


NOT_MODIFIED = _NotModified()


class Loaded(object):
    """What a loader returns when it really fetched something."""

    __slots__ = ("value", "etag")

    def __init__(self, value, etag=None):
        self.value = value
        self.etag = etag


class Entry(object):
    __slots__ = ("value", "etag", "stored_at")

    def __init__(self, value, etag, stored_at):
        self.value = value
        self.etag = etag
        self.stored_at = stored_at


class CacheResult(object):
    """A value plus where it came from.

    source is one of: fresh, loaded, revalidated, coalesced, stale.
    """

    __slots__ = ("value", "source")

    def __init__(self, value, source):
        self.value = value
        self.source = source

    def __repr__(self):
        return "<CacheResult %s>" % (self.source,)


class _InFlight(object):
    def __init__(self):
        self.done = threading.Event()
        self.value = None
        self.error = None

    def set_result(self, value):
        self.value = value
        self.done.set()

    def set_error(self, error):
        self.error = error
        self.done.set()

    def wait(self):
        self.done.wait()


class TTLCache(object):
    def __init__(self, metrics, stale_grace_seconds=300.0, clock=time.monotonic):
        self.metrics = metrics
        self.stale_grace_seconds = float(stale_grace_seconds)
        self._clock = clock
        self._entries = {}   # type: Dict[str, Entry]
        self._inflight = {}  # type: Dict[str, _InFlight]
        self._lock = threading.Lock()

    # ------------------------------------------------------------ queries

    def peek(self, key) -> Optional[Entry]:
        with self._lock:
            return self._entries.get(key)

    def keys(self):
        with self._lock:
            return tuple(sorted(self._entries))

    def invalidate(self, key) -> None:
        with self._lock:
            self._entries.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def _is_fresh(self, entry, ttl) -> bool:
        return (self._clock() - entry.stored_at) < ttl

    def _within_grace(self, entry, ttl) -> bool:
        age = self._clock() - entry.stored_at
        return age <= (ttl + self.stale_grace_seconds)

    # ------------------------------------------------------------ loading

    def get_or_load(self, key: str, loader: Callable[[Optional[Entry]], Any],
                    ttl: float, allow_stale: bool = True) -> CacheResult:
        entry = self.peek(key)
        if entry is not None and self._is_fresh(entry, ttl):
            self.metrics.incr("cache_hits")
            return CacheResult(entry.value, "fresh")

        with self._lock:
            inflight = self._inflight.get(key)
            leader = inflight is None
            if leader:
                inflight = _InFlight()
                self._inflight[key] = inflight

        if not leader:
            inflight.wait()
            self.metrics.incr("cache_coalesced")
            if inflight.error is not None:
                raise inflight.error
            return CacheResult(inflight.value, "coalesced")

        try:
            result = self._load(key, loader, ttl, allow_stale)
        except BaseException as exc:
            inflight.set_error(exc)
            raise
        else:
            inflight.set_result(result.value)
            return result
        finally:
            with self._lock:
                self._inflight.pop(key, None)

    def _load(self, key, loader, ttl, allow_stale) -> CacheResult:
        entry = self.peek(key)
        self.metrics.incr("cache_misses")
        try:
            outcome = loader(entry)
        except FeedError as exc:
            if (entry is not None and allow_stale and is_retryable(exc)
                    and self._within_grace(entry, ttl)):
                self.metrics.incr("stale_served")
                return CacheResult(entry.value, "stale")
            raise

        if outcome is NOT_MODIFIED:
            if entry is None:
                raise RuntimeError(
                    "loader for %r returned NOT_MODIFIED with nothing cached" % (key,))
            with self._lock:
                entry.stored_at = self._clock()
            self.metrics.incr("conditional_hits")
            return CacheResult(entry.value, "revalidated")

        if not isinstance(outcome, Loaded):
            raise RuntimeError(
                "loader for %r returned %r, expected Loaded or NOT_MODIFIED"
                % (key, type(outcome).__name__))
        with self._lock:
            self._entries[key] = Entry(outcome.value, outcome.etag, self._clock())
        return CacheResult(outcome.value, "loaded")
