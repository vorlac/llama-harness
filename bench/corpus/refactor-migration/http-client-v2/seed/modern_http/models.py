"""Value types: Timeout, Limits, Request, Response, StreamingResponse."""

from __future__ import annotations

import json as _json
from typing import Dict, Optional

from .errors import ConfigurationError, DecodeError


class Timeout(object):
    """An explicit timeout budget. All fields are keyword-only and optional.

    connect - budget for establishing the connection
    read    - budget for reading the response
    total   - budget for the whole request, connect plus read

    A field left as None is unbounded. There is intentionally no
    ``Timeout(5.0)`` shorthand: the library will not guess which budget a bare
    number was supposed to mean.
    """

    __slots__ = ("connect", "read", "total")

    def __init__(self, *, connect=None, read=None, total=None):
        for name, value in (("connect", connect), ("read", read), ("total", total)):
            if value is None:
                continue
            if not isinstance(value, (int, float)) or value <= 0:
                raise ConfigurationError(
                    "Timeout.%s must be a positive number of seconds, got %r"
                    % (name, value))
        self.connect = None if connect is None else float(connect)
        self.read = None if read is None else float(read)
        self.total = None if total is None else float(total)

    @property
    def connect_budget(self) -> Optional[float]:
        return self.connect if self.connect is not None else self.total

    @property
    def read_budget(self) -> Optional[float]:
        return self.read if self.read is not None else self.total

    def __eq__(self, other):
        return (isinstance(other, Timeout) and self.connect == other.connect
                and self.read == other.read and self.total == other.total)

    def __hash__(self):
        return hash((self.connect, self.read, self.total))

    def __repr__(self):
        return "Timeout(connect=%r, read=%r, total=%r)" % (
            self.connect, self.read, self.total)


class Limits(object):
    """Connection pool limits."""

    __slots__ = ("max_connections", "max_keepalive")

    def __init__(self, *, max_connections=8, max_keepalive=4):
        if max_connections < 1:
            raise ConfigurationError("max_connections must be >= 1")
        self.max_connections = int(max_connections)
        self.max_keepalive = int(max_keepalive)

    def __repr__(self):
        return "Limits(max_connections=%d)" % self.max_connections


class Request(object):
    """What an event hook is handed. ``timeout`` is a Timeout, never a float."""

    __slots__ = ("method", "url", "headers", "content", "timeout", "attempt")

    def __init__(self, method, url, headers=None, content=None, timeout=None,
                 attempt=1):
        self.method = method
        self.url = url
        self.headers = dict(headers or {})
        self.content = content or b""
        self.timeout = timeout
        self.attempt = attempt

    def __repr__(self):
        return "<Request %s %s %r>" % (self.method, self.url, self.timeout)


class Response(object):
    """A completed response. ``status`` - not ``status_code``."""

    __slots__ = ("status", "headers", "content", "url", "request", "elapsed")

    def __init__(self, status, headers=None, content=b"", url="", request=None,
                 elapsed=0.0):
        self.status = int(status)
        self.headers = dict((k.lower(), v) for k, v in (headers or {}).items())
        self.content = content or b""
        self.url = url
        self.request = request
        self.elapsed = elapsed

    @property
    def is_success(self) -> bool:
        return 200 <= self.status < 300

    @property
    def is_redirect(self) -> bool:
        return 300 <= self.status < 400

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", "replace")

    def json(self):
        if not self.content:
            raise DecodeError("empty body from %s (status %d)"
                              % (self.url, self.status))
        try:
            return _json.loads(self.content.decode("utf-8"))
        except ValueError as exc:
            raise DecodeError("bad JSON from %s: %s" % (self.url, exc))

    def raise_for_status(self) -> "Response":
        """Raise an HTTPStatusError for status >= 400. 3xx does not raise."""
        from .errors import for_status
        if self.status >= 400:
            raise for_status(self.status, response=self)
        return self

    def __repr__(self):
        return "<Response %d %s>" % (self.status, self.url)


class StreamingResponse(object):
    """A response whose body is read incrementally.

    Only obtainable from ``async with session.stream(...)``. A connection that
    dies mid-body raises ReadTimeout or ProtocolError out of the iterator.
    """

    __slots__ = ("status", "headers", "url", "request", "_chunks",
                 "_fault_after", "_fault_kind", "_delivered", "_closed")

    def __init__(self, status, headers, url, chunks, request=None,
                 fault_after=None, fault_kind="timeout"):
        self.status = int(status)
        self.headers = dict((k.lower(), v) for k, v in (headers or {}).items())
        self.url = url
        self.request = request
        self._chunks = list(chunks or [])
        self._fault_after = fault_after
        self._fault_kind = fault_kind
        self._delivered = 0
        self._closed = False

    @property
    def is_success(self) -> bool:
        return 200 <= self.status < 300

    def raise_for_status(self) -> "StreamingResponse":
        from .errors import for_status
        if self.status >= 400:
            raise for_status(self.status, response=self)
        return self

    async def aiter_bytes(self):
        from .errors import ProtocolError, ReadTimeout
        for chunk in self._chunks:
            if self._closed:
                return
            if (self._fault_after is not None
                    and self._delivered >= self._fault_after):
                break
            self._delivered += 1
            yield chunk
        if (self._fault_after is not None
                and self._delivered >= self._fault_after):
            detail = ("connection dropped after %d chunks of %s"
                      % (self._delivered, self.url))
            if self._fault_kind == "protocol":
                raise ProtocolError(detail, request=self.request)
            raise ReadTimeout(detail, request=self.request)

    async def aiter_lines(self):
        """Yield complete decoded lines. A trailing partial line is dropped."""
        buffer = b""
        async for chunk in self.aiter_bytes():
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                yield line.decode("utf-8", "replace")
        if buffer:
            yield buffer.decode("utf-8", "replace")

    async def aclose(self) -> None:
        self._closed = True
        self._chunks = []

    def __repr__(self):
        return "<StreamingResponse %d %s>" % (self.status, self.url)
