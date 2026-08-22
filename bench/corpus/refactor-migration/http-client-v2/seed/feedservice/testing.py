"""Test support shipped with the package.

This module is imported by the test suite (and by anyone writing a test against
a service that embeds feedservice), so its surface is a public contract:

* ``install_upstreams(scenario)`` installs the fake world. Library-agnostic.
* ``capture_requests()`` is a SYNCHRONOUS context manager yielding a list that
  fills with RequestRecord objects, one per request the HTTP client library
  issues, in order.
* ``RequestRecord`` exposes ``method``, ``url``, ``timeout_seconds`` (a float of
  seconds - the whole-request budget the client was given) and ``attempt``.
* ``probe_url(url, timeout_seconds)`` performs one request outside the service
  and returns ``{"ok": bool, "status": int or None, "failure": str or None}``
  where failure is one of None, "timeout", "connect", "protocol".

Those four signatures and their return shapes must not change: tests depend on
them, and the tests are frozen.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Dict, List, Optional

import legacy_http

from . import demo_upstreams


class RequestRecord(object):
    __slots__ = ("method", "url", "timeout_seconds", "attempt")

    def __init__(self, method, url, timeout_seconds, attempt):
        self.method = method
        self.url = url
        self.timeout_seconds = timeout_seconds
        self.attempt = attempt

    @property
    def path(self) -> str:
        without_scheme = self.url.split("://", 1)[-1]
        slash = without_scheme.find("/")
        return without_scheme[slash:] if slash >= 0 else "/"

    def __repr__(self):
        return "<RequestRecord %s %s timeout=%r>" % (
            self.method, self.url, self.timeout_seconds)


def install_upstreams(scenario: str = "default") -> Dict[str, int]:
    """Install the fake upstream world. Returns its call-counter dict."""
    return demo_upstreams.install(scenario)


@contextmanager
def capture_requests():
    """Record every request the client library issues while the block runs."""
    records = []  # type: List[RequestRecord]

    def hook(record):
        records.append(RequestRecord(record.method, record.url,
                                     record.timeout_seconds, record.attempt))

    legacy_http.add_request_hook(hook)
    try:
        yield records
    finally:
        legacy_http.remove_request_hook(hook)


def probe_url(url: str, timeout_seconds: float = 1.0) -> Dict[str, Optional[object]]:
    """One-off request outside the service, for probing a URL directly."""
    session = legacy_http.Session(timeout=timeout_seconds)
    try:
        response = session.get(url)
        if response.status_code == 0:
            return {"ok": False, "status": None,
                    "failure": response.error_kind or "connect"}
        return {"ok": response.ok, "status": response.status_code,
                "failure": None}
    finally:
        session.close()
