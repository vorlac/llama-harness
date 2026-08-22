"""Per-build request tracing.

The report says how many upstream requests the build it describes actually
issued. That number comes from here: a context manager that hangs a hook on the
HTTP client library for the duration of a block and counts what goes past.

The hook is process-wide, so a trace sees every request in flight while it is
open, not only the ones its own block caused. That is accepted: the number is
there to answer "did this build hit the network, and how hard", and the poller
being awake at the same moment does not change the answer usefully.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import List

import legacy_http


class Trace(object):
    __slots__ = ("count", "urls")

    def __init__(self):
        self.count = 0
        self.urls = []  # type: List[str]

    def hosts(self):
        seen = []
        for url in self.urls:
            host = url.split("://", 1)[-1].split("/", 1)[0]
            if host not in seen:
                seen.append(host)
        return seen

    def __repr__(self):
        return "<Trace %d requests>" % (self.count,)


@contextmanager
def trace_requests():
    """Count the requests the client library issues while the block runs."""
    trace = Trace()

    def hook(record):
        trace.count += 1
        trace.urls.append(record.url)

    legacy_http.add_request_hook(hook)
    try:
        yield trace
    finally:
        legacy_http.remove_request_hook(hook)
