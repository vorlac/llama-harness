"""The synchronous Session object.

Lifecycle is manual: construct it, use it, call close(). There is no context
manager. Timeouts are floats of seconds and cover the WHOLE request - connect
plus read - because the underlying transport only knows how to arm one timer.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, Optional
from urllib.parse import urlencode

import wirenet

from .errors import ConfigError
from .hooks import RequestRecord, fire
from .response import Response, StreamHandle

DEFAULT_TIMEOUT = 5.0
DEFAULT_POOL_SIZE = 8

_FAULT_TO_KIND = {"connect": "connect", "dns": "connect", "protocol": "protocol"}


def _join(base: Optional[str], path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if not base:
        raise ConfigError("relative path %r used on a session with no base_url"
                          % (path,))
    return base.rstrip("/") + "/" + path.lstrip("/")


class Session(object):
    """A pooled connection to one origin.

    Counters are per-session: ``request_count`` includes every attempt, whether
    it produced a response or a transport failure.
    """

    def __init__(self, base_url=None, timeout=DEFAULT_TIMEOUT,
                 pool_size=DEFAULT_POOL_SIZE, headers=None, user_agent=None):
        if timeout is not None and (not isinstance(timeout, (int, float))
                                    or timeout <= 0):
            raise ConfigError("timeout must be a positive number of seconds, "
                              "got %r" % (timeout,))
        if pool_size < 1:
            raise ConfigError("pool_size must be >= 1")
        self.base_url = base_url
        self.timeout = float(timeout) if timeout is not None else None
        self.pool_size = int(pool_size)
        self.headers = dict(headers or {})
        if user_agent:
            self.headers["user-agent"] = user_agent
        self.closed = False
        self.request_count = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------- verbs

    def get(self, path, params=None, headers=None, timeout=None) -> Response:
        return self._perform("GET", path, params=params, headers=headers,
                             timeout=timeout)

    def head(self, path, params=None, headers=None, timeout=None) -> Response:
        return self._perform("HEAD", path, params=params, headers=headers,
                             timeout=timeout)

    def post(self, path, body=None, json=None, headers=None,
             timeout=None) -> Response:
        if json is not None and body is not None:
            raise ConfigError("pass either body or json, not both")
        payload = body
        send_headers = dict(headers or {})
        if json is not None:
            import json as _json
            payload = _json.dumps(json, sort_keys=True).encode("utf-8")
            send_headers.setdefault("content-type", "application/json")
        return self._perform("POST", path, body=payload, headers=send_headers,
                             timeout=timeout)

    def get_stream(self, path, params=None, headers=None,
                   timeout=None) -> StreamHandle:
        """Start a streaming read. The caller MUST close the handle."""
        url, budget, send_headers = self._prepare("GET", path, params, headers,
                                                  timeout)
        try:
            reply = wirenet.dispatch("GET", url, headers=send_headers)
        except wirenet.Fault as fault:
            return StreamHandle(0, {}, url, [], error=str(fault),
                                error_kind=_FAULT_TO_KIND[fault.kind])
        cost = reply.connect_delay + reply.delay
        if budget is not None and cost > budget:
            return StreamHandle(0, {}, url, [],
                                error="timed out after %.3fs" % budget,
                                error_kind="timeout")
        if cost:
            time.sleep(cost)
        return StreamHandle(reply.status, reply.headers, url,
                            reply.iter_chunks(), fault_after=reply.fault_after,
                            fault_kind=reply.fault_kind)

    # -------------------------------------------------------------- guts

    def _prepare(self, method, path, params, headers, timeout):
        if self.closed:
            raise ConfigError("session for %r is closed" % (self.base_url,))
        if timeout is not None and (not isinstance(timeout, (int, float))
                                    or timeout <= 0):
            raise ConfigError("timeout must be a positive number of seconds, "
                              "got %r" % (timeout,))
        url = _join(self.base_url, path)
        if params:
            url = url + ("&" if "?" in url else "?") + urlencode(
                sorted(params.items()), doseq=True)
        budget = float(timeout) if timeout is not None else self.timeout
        send_headers = dict(self.headers)
        send_headers.update(headers or {})
        with self._lock:
            self.request_count += 1
            attempt = self.request_count
        fire(RequestRecord(method, url, budget, attempt, send_headers))
        return url, budget, send_headers

    def _perform(self, method, path, params=None, body=None, headers=None,
                 timeout=None) -> Response:
        url, budget, send_headers = self._prepare(method, path, params, headers,
                                                  timeout)
        started = time.monotonic()
        try:
            reply = wirenet.dispatch(method, url, headers=send_headers, body=body)
        except wirenet.Fault as fault:
            return Response(0, {}, b"", url, error=str(fault),
                            error_kind=_FAULT_TO_KIND[fault.kind],
                            elapsed=time.monotonic() - started)
        cost = reply.connect_delay + reply.delay
        if budget is not None and cost > budget:
            return Response(0, {}, b"", url,
                            error="timed out after %.3fs" % budget,
                            error_kind="timeout",
                            elapsed=time.monotonic() - started)
        if cost:
            time.sleep(cost)
        body_bytes = b"" if method == "HEAD" else reply.body
        return Response(reply.status, reply.headers, body_bytes, url,
                        elapsed=time.monotonic() - started)

    def close(self) -> None:
        self.closed = True

    def __repr__(self):
        return "<legacy_http.Session %s%s>" % (
            self.base_url, " CLOSED" if self.closed else "")
