"""Session lifecycle.

One SessionPool holds one client session per upstream, created lazily. The pool
is bound to the *ambient scope*: code deep in the call graph calls
``current_pool()`` rather than having a session threaded through every
signature.

``session_scope`` is reentrant on purpose. The dashboard path enters a scope,
then the aggregator enters one, then each client enters one; only the outermost
actually creates and closes a pool. Nesting must stay free - if every nested
scope opened its own pool, one dashboard build would open a dozen connections
to the same three hosts.

Work handed to another worker cannot see the ambient scope, so a worker adopts
the caller's pool explicitly:

    with session_scope(config, metrics, adopt=parent_pool) as pool:
        ...

An adopted scope never closes the pool it borrowed.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Dict, Optional

import legacy_http

_state = threading.local()


class SessionPool(object):
    """Lazily-created client sessions, one per upstream."""

    def __init__(self, config, metrics):
        self._config = config
        self._metrics = metrics
        self._sessions = {}  # type: Dict[str, legacy_http.Session]
        self._lock = threading.Lock()
        self.closed = False

    def session_for(self, upstream: str) -> legacy_http.Session:
        if self.closed:
            raise RuntimeError("session pool is closed")
        with self._lock:
            existing = self._sessions.get(upstream)
            if existing is not None:
                return existing
            settings = self._config.upstream(upstream)
            session = legacy_http.Session(
                base_url=settings.base_url,
                timeout=settings.timeout_seconds,
                pool_size=self._config.pool_size,
                user_agent=self._config.user_agent,
            )
            self._sessions[upstream] = session
            self._metrics.incr("sessions_opened")
            return session

    @property
    def open_upstreams(self):
        with self._lock:
            return tuple(sorted(self._sessions))

    def close(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
            self.closed = True
        for session in sessions:
            session.close()

    def __repr__(self):
        return "<SessionPool %s%s>" % (
            ",".join(self.open_upstreams) or "-", " CLOSED" if self.closed else "")


def _stack():
    stack = getattr(_state, "stack", None)
    if stack is None:
        stack = []
        _state.stack = stack
    return stack


def current_pool() -> Optional[SessionPool]:
    """The pool of the innermost active scope, or None outside any scope."""
    stack = _stack()
    return stack[-1] if stack else None


def scope_depth() -> int:
    return len(_stack())


@contextmanager
def session_scope(config, metrics, adopt: Optional[SessionPool] = None):
    """Enter a session scope. Reentrant; only the outermost owns the pool."""
    stack = _stack()
    if stack:
        pool = stack[-1]
        stack.append(pool)
        try:
            yield pool
        finally:
            stack.pop()
        return
    if adopt is not None:
        stack.append(adopt)
        try:
            yield adopt
        finally:
            stack.pop()
        return
    pool = SessionPool(config, metrics)
    metrics.incr("pools_opened")
    stack.append(pool)
    try:
        yield pool
    finally:
        stack.pop()
        pool.close()
