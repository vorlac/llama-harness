"""Response and StreamHandle: status-code-carrying result objects."""

from __future__ import annotations

import json as _json
from typing import Dict, Iterator, List, Optional

from .errors import DecodeError

# error_kind values used when status_code == 0
TRANSPORT_KINDS = ("timeout", "connect", "protocol")


class Response(object):
    """The result of a request. Never raises for HTTP or transport failures.

    status_code == 0 means the request never produced an HTTP response; in that
    case ``error_kind`` says why and ``error`` carries a human-readable detail.
    """

    __slots__ = ("status_code", "headers", "body", "url", "error", "error_kind",
                 "elapsed")

    def __init__(self, status_code=0, headers=None, body=b"", url="",
                 error=None, error_kind=None, elapsed=0.0):
        self.status_code = int(status_code)
        self.headers = dict((k.lower(), v) for k, v in (headers or {}).items())
        self.body = body or b""
        self.url = url
        self.error = error
        self.error_kind = error_kind
        self.elapsed = elapsed

    @property
    def ok(self) -> bool:
        """True only for 2xx. 304 is NOT ok."""
        return 200 <= self.status_code < 300

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def json(self):
        if not self.body:
            raise DecodeError("empty body from %s (status %d)"
                              % (self.url, self.status_code))
        try:
            return _json.loads(self.body.decode("utf-8"))
        except ValueError as exc:
            raise DecodeError("bad JSON from %s: %s" % (self.url, exc))

    def header(self, name: str, default=None):
        return self.headers.get(name.lower(), default)

    def __repr__(self):
        if self.status_code == 0:
            return "<Response FAILED %s %s>" % (self.error_kind, self.url)
        return "<Response %d %s>" % (self.status_code, self.url)


class StreamHandle(object):
    """A streaming read in progress.

    The handle must be closed by the caller - there is no context manager
    support. A connection that dies mid-stream does NOT raise: iteration stops
    early and ``error_kind`` is set, so callers have to check it after the loop
    or they will silently accept a truncated stream.
    """

    __slots__ = ("status_code", "headers", "url", "error", "error_kind",
                 "closed", "_chunks", "_fault_after", "_fault_kind", "_consumed")

    def __init__(self, status_code, headers, url, chunks, fault_after=None,
                 fault_kind="timeout", error=None, error_kind=None):
        self.status_code = int(status_code)
        self.headers = dict((k.lower(), v) for k, v in (headers or {}).items())
        self.url = url
        self.error = error
        self.error_kind = error_kind
        self.closed = False
        self._chunks = list(chunks or [])
        self._fault_after = fault_after
        self._fault_kind = fault_kind
        self._consumed = 0

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def chunks(self) -> Iterator[bytes]:
        for chunk in self._chunks:
            if self._fault_after is not None and self._consumed >= self._fault_after:
                self.error_kind = self._fault_kind
                self.error = "connection dropped after %d chunks" % self._consumed
                return
            self._consumed += 1
            yield chunk
        if self._fault_after is not None and self._consumed >= self._fault_after:
            self.error_kind = self._fault_kind
            self.error = "connection dropped after %d chunks" % self._consumed

    def lines(self) -> Iterator[str]:
        """Yield complete decoded lines. A trailing partial line is dropped."""
        buffer = b""
        for chunk in self.chunks():
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                yield line.decode("utf-8", "replace")
        if buffer and self.error_kind is None:
            yield buffer.decode("utf-8", "replace")

    def close(self) -> None:
        self.closed = True
        self._chunks = []

    def __repr__(self):
        return "<StreamHandle %d %s>" % (self.status_code, self.url)
