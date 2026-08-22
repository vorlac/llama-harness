"""Global request hooks.

Hooks are plain synchronous callables registered process-wide. Every request
issued by any Session is passed to every hook before it goes on the wire. A hook
that raises is ignored - instrumentation must never break traffic.
"""

from __future__ import annotations

import threading
from typing import Callable, List

_lock = threading.RLock()
_hooks = []  # type: List[Callable[["RequestRecord"], None]]


class RequestRecord(object):
    """What a hook is handed. Timeouts are plain floats of seconds."""

    __slots__ = ("method", "url", "timeout_seconds", "attempt", "headers")

    def __init__(self, method, url, timeout_seconds, attempt, headers):
        self.method = method
        self.url = url
        self.timeout_seconds = timeout_seconds
        self.attempt = attempt
        self.headers = dict(headers or {})

    def __repr__(self):
        return "<RequestRecord %s %s timeout=%.3f>" % (
            self.method, self.url, self.timeout_seconds)


def add_request_hook(fn: Callable[[RequestRecord], None]) -> None:
    with _lock:
        _hooks.append(fn)


def remove_request_hook(fn) -> None:
    with _lock:
        if fn in _hooks:
            _hooks.remove(fn)


def clear_request_hooks() -> None:
    with _lock:
        del _hooks[:]


def fire(record: RequestRecord) -> None:
    with _lock:
        current = list(_hooks)
    for hook in current:
        try:
            hook(record)
        except Exception:            # instrumentation must not break traffic
            pass
