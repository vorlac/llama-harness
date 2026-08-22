"""modern_http exception hierarchy.

Everything that goes wrong is an exception. There are no status codes to check
and no error strings to compare.

    ModernHTTPError
      +-- ConfigurationError        programmer error
      +-- DecodeError               body was not the type you asked for
      +-- TransportError            no HTTP response was produced
      |     +-- ConnectError
      |     +-- ConnectTimeout      NOTE: sibling of ReadTimeout, not a subclass
      |     +-- ReadTimeout
      |     +-- PoolTimeout
      |     +-- ProtocolError
      +-- HTTPStatusError           an HTTP response with a >= 400 status
            +-- ClientError         4xx
            |     +-- NotFound          404
            |     +-- Unauthorized      401 AND 403
            |     +-- TooManyRequests   429, carries .retry_after
            +-- ServerError         5xx

There is deliberately no common base class shared only by the two timeout types,
and 429 sits under ClientError even though servers mean it as "come back later".
"""

from __future__ import annotations

from typing import Optional


class ModernHTTPError(Exception):
    """Base class for every error this library raises."""


class ConfigurationError(ModernHTTPError):
    """Misuse of the API: bad timeout object, session not started, and so on."""


class DecodeError(ModernHTTPError):
    """Body could not be decoded as requested (e.g. .json() on a non-JSON body)."""


class TransportError(ModernHTTPError):
    """The request never produced an HTTP response."""

    def __init__(self, message, request=None):
        super().__init__(message)
        self.request = request


class ConnectError(TransportError):
    """The connection could not be established."""


class ConnectTimeout(TransportError):
    """Establishing the connection exceeded the connect budget."""


class ReadTimeout(TransportError):
    """Reading the response exceeded the read (or total) budget."""


class PoolTimeout(TransportError):
    """No connection became free within the pool budget."""


class ProtocolError(TransportError):
    """The peer spoke something that was not HTTP, or hung up mid-message."""


class HTTPStatusError(ModernHTTPError):
    """An HTTP response arrived, and its status was >= 400."""

    def __init__(self, message, response=None):
        super().__init__(message)
        self.response = response

    @property
    def status(self) -> Optional[int]:
        return None if self.response is None else self.response.status


class ClientError(HTTPStatusError):
    """4xx."""


class NotFound(ClientError):
    """404."""


class Unauthorized(ClientError):
    """401 or 403. The distinction is only available via .response.status."""


class TooManyRequests(ClientError):
    """429. ``retry_after`` is parsed from the header, or None if absent."""

    def __init__(self, message, response=None, retry_after=None):
        super().__init__(message, response=response)
        self.retry_after = retry_after


class ServerError(HTTPStatusError):
    """5xx."""


def for_status(status: int, response=None) -> HTTPStatusError:
    """Build the right exception for a status code."""
    message = "HTTP %d for %s" % (status, getattr(response, "url", "?"))
    if status == 404:
        return NotFound(message, response=response)
    if status in (401, 403):
        return Unauthorized(message, response=response)
    if status == 429:
        raw = None
        if response is not None:
            raw = response.headers.get("retry-after")
        retry_after = None
        if raw is not None:
            try:
                retry_after = float(raw)
            except (TypeError, ValueError):
                retry_after = None
        return TooManyRequests(message, response=response, retry_after=retry_after)
    if 400 <= status < 500:
        return ClientError(message, response=response)
    return ServerError(message, response=response)
