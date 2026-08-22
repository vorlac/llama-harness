"""Event hooks.

Hooks are process-wide and MUST be coroutine functions - they are awaited in the
request path, so they can do I/O of their own. Registering a plain function
raises ConfigurationError rather than silently never firing.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Callable, List

from .errors import ConfigurationError

_lock = threading.RLock()
_hooks = []  # type: List[Callable]


def add_request_hook(fn) -> None:
    if not asyncio.iscoroutinefunction(fn):
        raise ConfigurationError(
            "request hooks must be coroutine functions; %r is not" % (fn,))
    with _lock:
        _hooks.append(fn)


def remove_request_hook(fn) -> None:
    with _lock:
        if fn in _hooks:
            _hooks.remove(fn)


def clear_request_hooks() -> None:
    with _lock:
        del _hooks[:]


async def fire(request) -> None:
    with _lock:
        current = list(_hooks)
    for hook in current:
        try:
            await hook(request)
        except Exception:            # instrumentation must not break traffic
            pass
