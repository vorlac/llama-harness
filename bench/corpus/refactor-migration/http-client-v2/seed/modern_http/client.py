"""ClientSession - the async, context-managed entry point."""

from __future__ import annotations

import asyncio
import json as _json
import time
from typing import Optional
from urllib.parse import urlencode

import wirenet

from . import hooks
from .errors import (ConfigurationError, ConnectError, ConnectTimeout,
                     ProtocolError, ReadTimeout, for_status)
from .models import Limits, Request, Response, StreamingResponse, Timeout

DEFAULT_TIMEOUT = Timeout(connect=5.0, read=5.0, total=10.0)

_FAULT_TO_ERROR = {
    "connect": ConnectError,
    "dns": ConnectError,
    "protocol": ProtocolError,
}


def _join(base: Optional[str], url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if not base:
        raise ConfigurationError(
            "relative url %r used on a session with no base_url" % (url,))
    return base.rstrip("/") + "/" + url.lstrip("/")


class ClientSession(object):
    """An async HTTP session bound to a connection pool.

    A session must be started before use::

        async with ClientSession(base_url="http://x.internal") as session:
            response = await session.get("/thing")

    Using an unstarted or already-closed session raises ConfigurationError.
    """

    def __init__(self, *, base_url=None, timeout=None, limits=None,
                 headers=None):
        if timeout is not None and not isinstance(timeout, Timeout):
            raise ConfigurationError(
                "timeout must be a modern_http.Timeout, got %r"
                % (type(timeout).__name__,))
        if limits is not None and not isinstance(limits, Limits):
            raise ConfigurationError("limits must be a modern_http.Limits")
        self.base_url = base_url
        self.timeout = timeout if timeout is not None else DEFAULT_TIMEOUT
        self.limits = limits if limits is not None else Limits()
        self.headers = dict(headers or {})
        self.request_count = 0
        self.closed = False
        self._started = False
        self._slots = None

    async def __aenter__(self) -> "ClientSession":
        if self.closed:
            raise ConfigurationError("session for %r is closed" % (self.base_url,))
        self._started = True
        self._slots = asyncio.Semaphore(self.limits.max_connections)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        await self.aclose()
        return False

    async def aclose(self) -> None:
        self.closed = True
        self._started = False

    # ------------------------------------------------------------- verbs

    async def get(self, url, *, params=None, headers=None, timeout=None,
                  raise_on_status=False) -> Response:
        return await self._perform("GET", url, params=params, headers=headers,
                                   timeout=timeout,
                                   raise_on_status=raise_on_status)

    async def head(self, url, *, params=None, headers=None, timeout=None,
                   raise_on_status=False) -> Response:
        return await self._perform("HEAD", url, params=params, headers=headers,
                                   timeout=timeout,
                                   raise_on_status=raise_on_status)

    async def post(self, url, *, json=None, content=None, params=None,
                   headers=None, timeout=None,
                   raise_on_status=False) -> Response:
        if json is not None and content is not None:
            raise ConfigurationError("pass either json or content, not both")
        send_headers = dict(headers or {})
        body = content
        if json is not None:
            body = _json.dumps(json, sort_keys=True).encode("utf-8")
            send_headers.setdefault("content-type", "application/json")
        return await self._perform("POST", url, params=params, body=body,
                                   headers=send_headers, timeout=timeout,
                                   raise_on_status=raise_on_status)

    def stream(self, method, url, *, params=None, headers=None, timeout=None):
        """Return an async context manager yielding a StreamingResponse."""
        return _StreamContext(self, method, url, params, headers, timeout)

    # -------------------------------------------------------------- guts

    def _check(self) -> None:
        if self.closed:
            raise ConfigurationError("session for %r is closed" % (self.base_url,))
        if not self._started:
            raise ConfigurationError(
                "session for %r was never started; use 'async with "
                "ClientSession(...) as session:'" % (self.base_url,))

    def _build(self, method, url, params, headers, body, timeout):
        self._check()
        if timeout is not None and not isinstance(timeout, Timeout):
            raise ConfigurationError(
                "timeout must be a modern_http.Timeout, got %r"
                % (type(timeout).__name__,))
        full = _join(self.base_url, url)
        if params:
            full = full + ("&" if "?" in full else "?") + urlencode(
                sorted(params.items()), doseq=True)
        send_headers = dict(self.headers)
        send_headers.update(headers or {})
        self.request_count += 1
        return Request(method, full, headers=send_headers, content=body,
                       timeout=timeout if timeout is not None else self.timeout,
                       attempt=self.request_count)

    async def _transport(self, request):
        """Dispatch and apply the timeout budget. Returns a wirenet reply."""
        budget = request.timeout
        try:
            reply = wirenet.dispatch(request.method, request.url,
                                     headers=request.headers,
                                     body=request.content)
        except wirenet.Fault as fault:
            raise _FAULT_TO_ERROR[fault.kind](str(fault), request=request)
        connect_budget = budget.connect_budget
        if connect_budget is not None and reply.connect_delay > connect_budget:
            raise ConnectTimeout(
                "connect timed out after %.3fs for %s"
                % (connect_budget, request.url), request=request)
        read_budget = budget.read_budget
        if read_budget is not None and reply.delay > read_budget:
            raise ReadTimeout(
                "read timed out after %.3fs for %s"
                % (read_budget, request.url), request=request)
        cost = reply.connect_delay + reply.delay
        if budget.total is not None and cost > budget.total:
            raise ReadTimeout(
                "request exceeded total budget of %.3fs for %s"
                % (budget.total, request.url), request=request)
        if cost:
            await asyncio.sleep(cost)
        return reply

    async def _perform(self, method, url, params=None, body=None, headers=None,
                       timeout=None, raise_on_status=False) -> Response:
        request = self._build(method, url, params, headers, body, timeout)
        await hooks.fire(request)
        started = time.monotonic()
        async with self._slots:
            reply = await self._transport(request)
        content = b"" if method == "HEAD" else reply.body
        response = Response(reply.status, reply.headers, content, request.url,
                            request=request, elapsed=time.monotonic() - started)
        if raise_on_status and response.status >= 400:
            raise for_status(response.status, response=response)
        return response

    def __repr__(self):
        return "<modern_http.ClientSession %s%s>" % (
            self.base_url, " CLOSED" if self.closed else "")


class _StreamContext(object):
    def __init__(self, session, method, url, params, headers, timeout):
        self._session = session
        self._method = method
        self._url = url
        self._params = params
        self._headers = headers
        self._timeout = timeout
        self._response = None

    async def __aenter__(self) -> StreamingResponse:
        session = self._session
        request = session._build(self._method, self._url, self._params,
                                 self._headers, None, self._timeout)
        await hooks.fire(request)
        reply = await session._transport(request)
        self._response = StreamingResponse(
            reply.status, reply.headers, request.url, reply.iter_chunks(),
            request=request, fault_after=reply.fault_after,
            fault_kind=reply.fault_kind)
        return self._response

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        if self._response is not None:
            await self._response.aclose()
        return False
