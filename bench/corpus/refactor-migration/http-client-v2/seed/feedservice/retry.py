"""The retry decorator.

Applied to the client methods that actually issue a request. It reads its policy
off the instance (``self.retry_policy``) and counts attempts into
``self.metrics``, so it works the same on a catalog client and on the background
poller.

Retry classification lives in ``is_retryable`` and is deliberately narrow:

* UpstreamThrottled       -> retried, honouring Retry-After when present
* UpstreamUnavailable     -> retried for timeout / connect / server
* UpstreamUnavailable     -> NOT retried for protocol
* UpstreamRejected        -> never retried (4xx will not fix itself)
* MalformedUpstreamPayload-> never retried (the body will decode the same way)
"""

from __future__ import annotations

import functools
import time

from .errors import (FeedError, MalformedUpstreamPayload, UpstreamRejected,
                     UpstreamThrottled, UpstreamUnavailable)

RETRYABLE_CAUSES = ("timeout", "connect", "server")


def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, UpstreamThrottled):
        return True
    if isinstance(exc, UpstreamUnavailable):
        return exc.cause_kind in RETRYABLE_CAUSES
    return False


def backoff_delay(attempt: int, policy) -> float:
    """Exponential, capped. Deterministic - no jitter, so tests can pin it."""
    delay = policy.backoff_base_seconds * (2 ** (attempt - 1))
    return min(delay, policy.max_delay_seconds)


def delay_for(exc: BaseException, attempt: int, policy) -> float:
    if isinstance(exc, UpstreamThrottled) and exc.retry_after is not None:
        return min(float(exc.retry_after), policy.max_delay_seconds)
    return backoff_delay(attempt, policy)


def with_retries(fn):
    """Retry a bound method that raises FeedError, per ``self.retry_policy``."""

    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        policy = self.retry_policy
        attempt = 1
        while True:
            try:
                return fn(self, *args, **kwargs)
            except FeedError as exc:
                if attempt > policy.retries or not is_retryable(exc):
                    raise
                delay = delay_for(exc, attempt, policy)
                self.metrics.incr("retries")
                if delay > 0:
                    time.sleep(delay)
                attempt += 1

    wrapper.retries_enabled = True
    return wrapper
