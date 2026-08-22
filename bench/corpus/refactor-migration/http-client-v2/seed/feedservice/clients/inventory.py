"""Inventory upstream: cursor pagination driven by the Link header."""

from __future__ import annotations

import re

from ..cache import Loaded
from ..errors import MalformedUpstreamPayload
from ..retry import with_retries
from .base import BaseClient

CACHE_KEY = "inventory:levels"
MAX_PAGES = 20
_NEXT = re.compile(r"<([^>]+)>\s*;\s*rel=\"?next\"?")
_CURSOR = re.compile(r"[?&]cursor=([^&]+)")


def next_cursor(link_header):
    """Pull the cursor out of a Link header, or None when there is no next page."""
    if not link_header:
        return None
    for part in link_header.split(","):
        match = _NEXT.search(part)
        if not match:
            continue
        cursor = _CURSOR.search(match.group(1))
        return cursor.group(1) if cursor else None
    return None


class InventoryClient(BaseClient):
    upstream = "inventory"

    def levels(self):
        """Cached map of item id -> quantity on hand. Returns a CacheResult."""
        return self.cache.get_or_load(CACHE_KEY, self._load, self.ttl)

    def _load(self, entry):
        levels = {}
        cursor = None
        pages = 0
        while True:
            result = self._fetch_page(cursor)
            rows = (result.payload or {}).get("levels")
            if not isinstance(rows, list):
                raise MalformedUpstreamPayload(self.upstream,
                                               "page has no 'levels' array")
            for row in rows:
                if "id" not in row or "on_hand" not in row:
                    raise MalformedUpstreamPayload(
                        self.upstream, "level row missing id/on_hand")
                levels[row["id"]] = row["on_hand"]
            pages += 1
            cursor = next_cursor(result.header("link"))
            if cursor is None or pages >= MAX_PAGES:
                break
        return Loaded(levels)

    @with_retries
    def _fetch_page(self, cursor):
        params = {"cursor": cursor} if cursor else None
        return self.gateway.fetch_json(self.upstream, "/inventory",
                                       params=params)
