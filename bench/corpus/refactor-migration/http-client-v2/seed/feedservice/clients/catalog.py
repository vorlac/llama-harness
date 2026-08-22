"""Catalog upstream: the product index, revalidated with an ETag."""

from __future__ import annotations

from ..cache import NOT_MODIFIED, Loaded
from ..errors import MalformedUpstreamPayload
from ..retry import with_retries
from ..session import session_scope
from .base import BaseClient

CACHE_KEY = "catalog:index"
REQUIRED_FIELDS = ("id", "name", "category")


class CatalogClient(BaseClient):
    upstream = "catalog"

    def items(self):
        """Cached list of catalog items. Returns a CacheResult."""
        return self.cache.get_or_load(CACHE_KEY, self._load, self.ttl)

    def _load(self, entry):
        result = self._fetch_index(entry.etag if entry is not None else None)
        if result.not_modified:
            # The upstream says nothing changed: keep what we have, reset its age.
            return NOT_MODIFIED
        payload = result.payload or {}
        rows = payload.get("items")
        if not isinstance(rows, list):
            raise MalformedUpstreamPayload(self.upstream,
                                           "payload has no 'items' array")
        items = []
        for row in rows:
            if not all(field in row for field in REQUIRED_FIELDS):
                raise MalformedUpstreamPayload(
                    self.upstream, "item is missing one of %s"
                    % (", ".join(REQUIRED_FIELDS),))
            items.append({"id": row["id"], "name": row["name"],
                          "category": row["category"]})
        items.sort(key=lambda item: item["id"])
        return Loaded(items, etag=result.etag)

    @with_retries
    def _fetch_index(self, etag):
        # A nested scope: free when the caller already opened one, and it keeps
        # this client usable on its own from a script or the poller.
        with session_scope(self.config, self.metrics):
            return self.gateway.fetch_json(self.upstream, "/catalog/index",
                                           etag=etag)
