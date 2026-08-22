"""Service-level errors.

Callers of feedservice never see an HTTP client error. Everything the client
library reports is translated into one of these by feedservice.gateway, and the
retry and cache layers make their decisions from these types alone.
"""

from __future__ import annotations

from typing import Optional


class FeedError(Exception):
    """Base class for every error this service raises."""


class UpstreamUnavailable(FeedError):
    """The upstream did not deliver a usable response.

    ``cause_kind`` is one of:
      timeout   - the request exceeded its budget
      connect   - the connection could not be established
      protocol  - the peer answered with something that was not valid HTTP
      server    - a 5xx response

    The distinction matters: ``protocol`` is NOT retried, because a peer talking
    garbage will keep talking garbage and retrying it has cost us outages before
    (see ARCHITECTURE.md, "Retry policy").
    """

    def __init__(self, upstream, cause_kind, detail=""):
        super().__init__("%s unavailable (%s)%s"
                         % (upstream, cause_kind, (": " + detail) if detail else ""))
        self.upstream = upstream
        self.cause_kind = cause_kind
        self.detail = detail


class UpstreamRejected(FeedError):
    """The upstream answered with a 4xx that is not a throttle. Never retried."""

    def __init__(self, upstream, status, detail=""):
        super().__init__("%s rejected the request with %d%s"
                         % (upstream, status, (": " + detail) if detail else ""))
        self.upstream = upstream
        self.status = int(status)
        self.detail = detail


class UpstreamThrottled(FeedError):
    """The upstream answered 429. Always retried, honouring Retry-After."""

    def __init__(self, upstream, retry_after=None):
        super().__init__("%s throttled the request (retry_after=%r)"
                         % (upstream, retry_after))
        self.upstream = upstream
        self.retry_after = retry_after  # type: Optional[float]


class MalformedUpstreamPayload(FeedError):
    """The upstream answered 2xx with a body we could not use. Never retried."""

    def __init__(self, upstream, detail=""):
        super().__init__("%s returned a malformed payload%s"
                         % (upstream, (": " + detail) if detail else ""))
        self.upstream = upstream
        self.detail = detail
