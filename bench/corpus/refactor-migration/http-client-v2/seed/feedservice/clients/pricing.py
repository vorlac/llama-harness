"""Pricing upstream: batch lookups by POST, plus a live NDJSON price stream."""

from __future__ import annotations

from ..cache import Loaded
from ..errors import MalformedUpstreamPayload
from ..retry import with_retries
from ..session import session_scope
from .base import BaseClient


def cache_key(ids) -> str:
    return "pricing:" + ",".join(sorted(ids))


class PricingClient(BaseClient):
    upstream = "pricing"

    def prices_for(self, ids):
        """Cached batch price lookup. Returns a CacheResult."""
        ids = list(ids)

        def loader(entry):
            return Loaded(self._fetch_batch(ids))

        return self.cache.get_or_load(cache_key(ids), loader, self.ttl)

    @with_retries
    def _fetch_batch(self, ids):
        with session_scope(self.config, self.metrics):
            result = self.gateway.post_json(self.upstream, "/pricing/batch",
                                            {"ids": sorted(ids)})
        prices = (result.payload or {}).get("prices")
        if not isinstance(prices, dict):
            raise MalformedUpstreamPayload(self.upstream,
                                           "payload has no 'prices' object")
        out = {}
        for item_id, row in prices.items():
            if "amount" not in row:
                raise MalformedUpstreamPayload(
                    self.upstream, "price for %s has no amount" % (item_id,))
            out[item_id] = {"amount": row["amount"],
                            "currency": row.get("currency", "USD")}
        return out

    def live_prices(self, limit=None):
        """Read the live price stream. Returns (prices, truncated).

        Never retried and never cached: a live feed that dies is reported as
        truncated, not replayed. Whatever arrived before the stream died is
        good data and is kept.
        """
        cap = limit if limit is not None else self.config.live_price_limit
        with session_scope(self.config, self.metrics):
            records, truncated = self.gateway.stream_records(
                self.upstream, "/pricing/live", limit=cap)
        prices = {}
        for record in records:
            if "id" not in record or "amount" not in record:
                raise MalformedUpstreamPayload(
                    self.upstream, "live record missing id/amount")
            prices[record["id"]] = record["amount"]
        return prices, truncated
