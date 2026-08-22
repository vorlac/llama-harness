"""The entire exception surface of legacy_http.

There are exactly two. Everything else - connection failures, timeouts, HTTP
error statuses - is reported through ``Response.status_code`` and
``Response.error_kind``, never by raising.
"""

from __future__ import annotations


class LegacyHTTPError(Exception):
    """Base class for the two errors this library raises."""


class DecodeError(LegacyHTTPError):
    """Raised by Response.json() when the body is empty or not valid JSON."""


class ConfigError(LegacyHTTPError):
    """Raised for programmer error: bad timeout, use of a closed session."""
