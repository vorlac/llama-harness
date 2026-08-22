"""wirenet - an in-process fake network.

Both vendored HTTP client libraries (``legacy_http`` and ``modern_http``) talk to
this module instead of a socket, so the whole service runs with no network
access and behaves identically on every machine.

A "server" is a callable registered for a host::

    wirenet.serve("catalog.internal", handler)

where ``handler(WireRequest) -> WireReply``. A handler may also raise
``wirenet.Fault`` to simulate a connection-level failure.

Timing is simulated, not slept away. A reply carries ``connect_delay`` and
``delay`` (seconds); the *client library* decides what to do with them:

* if the declared cost exceeds the caller's timeout budget the client reports a
  timeout immediately, without sleeping - so timeout tests are instant and
  deterministic;
* otherwise the client really sleeps for that long, so short delays can be used
  to create genuine overlap between concurrent requests.

Streaming replies carry ``chunks``. Chunk boundaries deliberately do not line up
with line boundaries, so clients must buffer. ``fault_after`` drops the
connection after that many chunks have been delivered.

This module is library-agnostic: nothing in it knows about legacy_http or
modern_http, and it is NOT part of any migration.
"""

from __future__ import annotations

import json as _json
import threading
from typing import Callable, Dict, List, Optional, Sequence
from urllib.parse import parse_qs, urlsplit

__all__ = [
    "Fault",
    "WireError",
    "WireRequest",
    "WireReply",
    "serve",
    "unserve",
    "reset",
    "hosts",
    "dispatch",
    "traffic",
    "json_reply",
    "text_reply",
    "ndjson_reply",
    "empty_reply",
    "split_url",
]

FAULT_KINDS = ("connect", "protocol", "dns")


class WireError(Exception):
    """Base class for wirenet problems."""


class Fault(WireError):
    """Connection-level failure raised by a handler or by the router.

    ``kind`` is one of ``connect``, ``protocol`` or ``dns``.
    """

    def __init__(self, kind: str = "connect", detail: str = "") -> None:
        if kind not in FAULT_KINDS:
            raise WireError("unknown fault kind: %r" % (kind,))
        super().__init__("%s fault%s" % (kind, (": " + detail) if detail else ""))
        self.kind = kind
        self.detail = detail


class WireRequest(object):
    def __init__(self, method, url, host, path, query, headers, body):
        self.method = method
        self.url = url
        self.host = host
        self.path = path
        self.query = query          # Dict[str, List[str]]
        self.headers = headers      # Dict[str, str], keys lower-cased
        self.body = body            # bytes

    def param(self, name: str, default: Optional[str] = None) -> Optional[str]:
        values = self.query.get(name)
        return values[0] if values else default

    def json(self):
        if not self.body:
            return None
        return _json.loads(self.body.decode("utf-8"))

    def __repr__(self):
        return "<WireRequest %s %s>" % (self.method, self.url)


class WireReply(object):
    """What a fake server hands back.

    status        - HTTP status code
    headers       - response headers (keys are lower-cased on construction)
    body          - full body as bytes (also the fallback for non-streaming reads)
    chunks        - byte chunks for streaming reads; defaults to [body]
    delay         - seconds the server spends producing the response
    connect_delay - seconds spent establishing the connection
    fault_after   - drop the connection after N chunks have been delivered
    fault_kind    - "timeout" or "protocol"; how the mid-stream drop presents
    """

    def __init__(self, status=200, headers=None, body=b"", chunks=None,
                 delay=0.0, connect_delay=0.0, fault_after=None,
                 fault_kind="timeout"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.status = int(status)
        self.headers = dict((k.lower(), v) for k, v in (headers or {}).items())
        self.body = body
        self.chunks = list(chunks) if chunks is not None else None
        self.delay = float(delay)
        self.connect_delay = float(connect_delay)
        self.fault_after = fault_after
        self.fault_kind = fault_kind

    def iter_chunks(self) -> List[bytes]:
        if self.chunks is not None:
            return list(self.chunks)
        return [self.body] if self.body else []

    def __repr__(self):
        return "<WireReply %d %d bytes>" % (self.status, len(self.body))


# ------------------------------------------------------------------ routing

_lock = threading.RLock()
_routes = {}            # type: Dict[str, Callable[[WireRequest], WireReply]]
traffic = []            # type: List[str]


def serve(host: str, handler: Callable[[WireRequest], WireReply]) -> None:
    with _lock:
        _routes[host.lower()] = handler


def unserve(host: str) -> None:
    with _lock:
        _routes.pop(host.lower(), None)


def reset() -> None:
    """Forget every registered host and clear the traffic log."""
    with _lock:
        _routes.clear()
        del traffic[:]


def hosts() -> Sequence[str]:
    with _lock:
        return sorted(_routes)


def split_url(url: str):
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        raise WireError("not an absolute URL: %r" % (url,))
    return parts.scheme, parts.netloc.lower(), (parts.path or "/"), parts.query


def dispatch(method: str, url: str, headers=None, body=None) -> WireReply:
    """Route one request. Raises Fault when the host is unreachable."""
    scheme, host, path, query = split_url(url)
    with _lock:
        handler = _routes.get(host)
        traffic.append("%s %s" % (method.upper(), url))
    if handler is None:
        raise Fault("dns", "no server for host %r" % (host,))
    if isinstance(body, str):
        body = body.encode("utf-8")
    request = WireRequest(
        method=method.upper(),
        url=url,
        host=host,
        path=path,
        query=parse_qs(query, keep_blank_values=True),
        headers=dict((k.lower(), v) for k, v in (headers or {}).items()),
        body=body or b"",
    )
    reply = handler(request)
    if not isinstance(reply, WireReply):
        raise WireError("handler for %r returned %r, expected WireReply"
                        % (host, type(reply).__name__))
    return reply


# ------------------------------------------------------------ reply helpers

def json_reply(payload, status=200, headers=None, **kwargs) -> WireReply:
    hdrs = {"content-type": "application/json"}
    hdrs.update(headers or {})
    body = _json.dumps(payload, sort_keys=True).encode("utf-8")
    return WireReply(status=status, headers=hdrs, body=body, **kwargs)


def text_reply(text, status=200, headers=None, **kwargs) -> WireReply:
    hdrs = {"content-type": "text/plain"}
    hdrs.update(headers or {})
    return WireReply(status=status, headers=hdrs, body=text, **kwargs)


def empty_reply(status=204, headers=None, **kwargs) -> WireReply:
    return WireReply(status=status, headers=headers or {}, body=b"", **kwargs)


def ndjson_reply(records, chunk_sizes=None, status=200, headers=None,
                 **kwargs) -> WireReply:
    """Newline-delimited JSON, split into chunks that ignore line boundaries."""
    body = b"".join(
        (_json.dumps(r, sort_keys=True) + "\n").encode("utf-8") for r in records)
    if chunk_sizes is None:
        chunk_sizes = [max(1, len(body) // 3 + 7)] * 4
    chunks = []
    offset = 0
    for size in chunk_sizes:
        if offset >= len(body):
            break
        chunks.append(body[offset:offset + size])
        offset += size
    if offset < len(body):
        chunks.append(body[offset:])
    hdrs = {"content-type": "application/x-ndjson"}
    hdrs.update(headers or {})
    return WireReply(status=status, headers=hdrs, body=body, chunks=chunks, **kwargs)
