"""modern_http - the supported async HTTP client.

Differences from legacy_http that matter to callers:

* every call is a coroutine and must be awaited;
* sessions are context managers and refuse to work unless started;
* failures are exceptions (see modern_http.errors), never status codes;
* timeouts are ``Timeout`` objects with separate connect/read/total budgets;
* streaming is ``async with session.stream(...)`` and raises on a dropped
  connection instead of stopping quietly;
* HTTP error statuses only become exceptions if you ask, via
  ``raise_for_status()`` or ``raise_on_status=True``.

Run ``python3 -m modern_http._selfcheck`` to verify the library works in this
checkout.
"""

from __future__ import annotations

from .client import DEFAULT_TIMEOUT, ClientSession
from .errors import (ClientError, ConfigurationError, ConnectError,
                     ConnectTimeout, DecodeError, HTTPStatusError,
                     ModernHTTPError, NotFound, PoolTimeout, ProtocolError,
                     ReadTimeout, ServerError, TooManyRequests, TransportError,
                     Unauthorized, for_status)
from .hooks import add_request_hook, clear_request_hooks, remove_request_hook
from .models import Limits, Request, Response, StreamingResponse, Timeout

__all__ = [
    "ClientSession",
    "DEFAULT_TIMEOUT",
    "Timeout",
    "Limits",
    "Request",
    "Response",
    "StreamingResponse",
    "ModernHTTPError",
    "ConfigurationError",
    "DecodeError",
    "TransportError",
    "ConnectError",
    "ConnectTimeout",
    "ReadTimeout",
    "PoolTimeout",
    "ProtocolError",
    "HTTPStatusError",
    "ClientError",
    "NotFound",
    "Unauthorized",
    "TooManyRequests",
    "ServerError",
    "for_status",
    "add_request_hook",
    "remove_request_hook",
    "clear_request_hooks",
]

__version__ = "2.3.0"
