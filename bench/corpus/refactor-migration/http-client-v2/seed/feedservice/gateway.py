"""The one place in the service that touches the HTTP client library.

Well - it is supposed to be the one place. It is not: the health probe, the
streaming reader, the poller's own liveness check and the test-support helpers
all reach for the client directly. That is exactly why this migration is not a
one-file change.

Every response is translated into either a GatewayResult or a
``feedservice.errors`` exception. Nothing above this layer may see a status
code, an error string or a client-library exception.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

import legacy_http

from .errors import (MalformedUpstreamPayload, UpstreamRejected,
                     UpstreamThrottled, UpstreamUnavailable)
from .session import current_pool


class GatewayResult(object):
    """A successful upstream read.

    ``not_modified`` is True when the upstream answered 304 to a conditional
    request; ``payload`` is then None and the caller keeps what it already had.
    """

    __slots__ = ("payload", "status", "headers", "not_modified", "etag")

    def __init__(self, payload=None, status=200, headers=None,
                 not_modified=False, etag=None):
        self.payload = payload
        self.status = status
        self.headers = headers or {}
        self.not_modified = not_modified
        self.etag = etag

    def header(self, name, default=None):
        return self.headers.get(name.lower(), default)

    def __repr__(self):
        return "<GatewayResult %d%s>" % (
            self.status, " not-modified" if self.not_modified else "")


def _parse_retry_after(raw) -> Optional[float]:
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


class Gateway(object):
    def __init__(self, config, metrics):
        self.config = config
        self.metrics = metrics

    # ---------------------------------------------------------- plumbing

    def _session(self, upstream: str) -> legacy_http.Session:
        pool = current_pool()
        if pool is None:
            raise RuntimeError(
                "no session scope is active; wrap the call in "
                "feedservice.session.session_scope(...)")
        return pool.session_for(upstream)

    def _raise_for_status(self, upstream, status, detail=""):
        if status == 429:
            raise UpstreamThrottled(upstream, retry_after=None)
        if status >= 500:
            raise UpstreamUnavailable(upstream, "server",
                                      "HTTP %d %s" % (status, detail))
        if status >= 400:
            raise UpstreamRejected(upstream, status, detail)
        raise UpstreamUnavailable(upstream, "protocol",
                                  "unexpected status %d %s" % (status, detail))

    def _check(self, upstream, response):
        """Turn a non-2xx or failed Response into a service error."""
        if response.status_code == 0:
            raise UpstreamUnavailable(upstream, response.error_kind or "connect",
                                      response.error or "")
        if response.status_code == 429:
            raise UpstreamThrottled(
                upstream,
                retry_after=_parse_retry_after(response.header("retry-after")))
        if not response.ok:
            self._raise_for_status(upstream, response.status_code,
                                   response.text[:120])

    def _decode(self, upstream, response):
        try:
            return response.json()
        except legacy_http.DecodeError as exc:
            raise MalformedUpstreamPayload(upstream, str(exc))

    # ------------------------------------------------------------- verbs

    def fetch_json(self, upstream, path, params=None, etag=None,
                   timeout=None) -> GatewayResult:
        session = self._session(upstream)
        headers = {"if-none-match": etag} if etag else None
        self.metrics.incr("upstream_requests")
        response = session.get(path, params=params, headers=headers,
                               timeout=timeout)
        if response.status_code == 304:
            return GatewayResult(None, 304, response.headers, not_modified=True,
                                 etag=response.header("etag", etag))
        self._check(upstream, response)
        return GatewayResult(self._decode(upstream, response),
                             response.status_code, response.headers,
                             etag=response.header("etag"))

    def post_json(self, upstream, path, payload, timeout=None) -> GatewayResult:
        session = self._session(upstream)
        self.metrics.incr("upstream_requests")
        response = session.post(path, json=payload, timeout=timeout)
        self._check(upstream, response)
        return GatewayResult(self._decode(upstream, response),
                             response.status_code, response.headers)

    def probe(self, upstream, path="/healthz") -> str:
        """One health check. Never raises: the state is the answer."""
        try:
            self.fetch_json(upstream, path)
        except UpstreamUnavailable as exc:
            return exc.cause_kind
        except UpstreamThrottled:
            return "throttled"
        except UpstreamRejected:
            return "rejected"
        except MalformedUpstreamPayload:
            return "malformed"
        return "ok"

    def stream_records(self, upstream, path, limit=None,
                       timeout=None) -> Tuple[List[Any], bool]:
        """Read newline-delimited JSON.

        Returns (records, truncated). A stream that dies part-way through is not
        an error: the records read so far are real and are kept, and the caller
        is told the read was incomplete so it can warn.
        """
        session = self._session(upstream)
        self.metrics.incr("upstream_requests")
        handle = session.get_stream(path, timeout=timeout)
        try:
            if handle.status_code == 0:
                raise UpstreamUnavailable(upstream,
                                          handle.error_kind or "connect",
                                          handle.error or "")
            if not handle.ok:
                self._raise_for_status(upstream, handle.status_code)
            records = []  # type: List[Any]
            for line in handle.lines():
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except ValueError as exc:
                    raise MalformedUpstreamPayload(
                        upstream, "bad NDJSON line: %s" % (exc,))
                if limit is not None and len(records) >= limit:
                    break
            truncated = handle.error_kind is not None
            if truncated:
                self.metrics.incr("stream_truncations")
            return records, truncated
        finally:
            handle.close()
