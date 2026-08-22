"""legacy_http - DEPRECATED synchronous HTTP client.

This library is frozen. It is kept in the tree only until every caller has been
moved to ``modern_http``. Its defining traits:

* synchronous, blocking calls;
* failures are reported as ``Response.status_code == 0`` plus an
  ``error_kind`` string, not as exceptions;
* a single float timeout covering the whole request;
* manual session lifecycle (``close()``, no context manager);
* streaming reads that stop silently on a mid-stream failure.

Do not add features here.
"""

from __future__ import annotations

from .errors import ConfigError, DecodeError, LegacyHTTPError
from .hooks import (RequestRecord, add_request_hook, clear_request_hooks,
                    remove_request_hook)
from .response import TRANSPORT_KINDS, Response, StreamHandle
from .session import DEFAULT_POOL_SIZE, DEFAULT_TIMEOUT, Session

__all__ = [
    "ConfigError",
    "DecodeError",
    "LegacyHTTPError",
    "RequestRecord",
    "add_request_hook",
    "clear_request_hooks",
    "remove_request_hook",
    "Response",
    "StreamHandle",
    "TRANSPORT_KINDS",
    "Session",
    "DEFAULT_TIMEOUT",
    "DEFAULT_POOL_SIZE",
]

__version__ = "0.9.14"
__deprecated__ = True
