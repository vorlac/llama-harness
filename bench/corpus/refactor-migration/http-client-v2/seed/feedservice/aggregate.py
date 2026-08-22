"""Join catalog, pricing and inventory into one report.

Failure policy, which the test suite pins:

* the catalog is load-bearing - if it cannot be read, the whole build fails;
* pricing and inventory are degradable - a failure there produces a warning, a
  degraded-upstream entry and a report with the missing fields left empty;
* a truncated live-price stream is a warning, never a failure.

Every list in the report is sorted, so two runs against the same upstreams
produce byte-identical output.
"""

from __future__ import annotations

from .errors import FeedError

STATUS_AVAILABLE = "available"
STATUS_OUT_OF_STOCK = "out-of-stock"
STATUS_UNKNOWN_STOCK = "unknown-stock"
STATUS_UNPRICED = "unpriced"


class ReportBuilder(object):
    def __init__(self, config, metrics, catalog, pricing, inventory):
        self.config = config
        self.metrics = metrics
        self.catalog = catalog
        self.pricing = pricing
        self.inventory = inventory

    def build(self, live: bool = False) -> dict:
        warnings = []
        degraded = []
        sources = {}

        catalog_result = self.catalog.items()      # fatal on failure, by design
        items = catalog_result.value
        sources["catalog"] = catalog_result.source
        ids = [item["id"] for item in items]

        try:
            pricing_result = self.pricing.prices_for(ids)
            prices = pricing_result.value
            sources["pricing"] = pricing_result.source
        except FeedError as exc:
            prices = {}
            sources["pricing"] = "unavailable"
            degraded.append("pricing")
            warnings.append("pricing unavailable (%s)" % type(exc).__name__)

        try:
            inventory_result = self.inventory.levels()
            levels = inventory_result.value
            sources["inventory"] = inventory_result.source
        except FeedError as exc:
            levels = {}
            sources["inventory"] = "unavailable"
            degraded.append("inventory")
            warnings.append("inventory unavailable (%s)" % type(exc).__name__)

        rows = []
        for item in items:
            item_id = item["id"]
            price = prices.get(item_id)
            on_hand = levels.get(item_id)
            if price is None:
                status = STATUS_UNPRICED
                warnings.append("no price for %s" % item_id)
            elif on_hand is None:
                status = STATUS_UNKNOWN_STOCK
            elif on_hand > 0:
                status = STATUS_AVAILABLE
            else:
                status = STATUS_OUT_OF_STOCK
            rows.append({
                "id": item_id,
                "name": item["name"],
                "category": item["category"],
                "amount": None if price is None else price["amount"],
                "currency": None if price is None else price["currency"],
                "on_hand": on_hand,
                "status": status,
            })
        rows.sort(key=lambda row: row["id"])

        report = {
            "items": rows,
            "item_count": len(rows),
            "sources": sources,
            "degraded_upstreams": sorted(degraded),
        }

        if live:
            try:
                live_prices, truncated = self.pricing.live_prices()
            except FeedError as exc:
                report["live_prices"] = {}
                report["live_truncated"] = False
                if "pricing" not in degraded:
                    degraded.append("pricing")
                warnings.append("live prices unavailable (%s)" % type(exc).__name__)
            else:
                report["live_prices"] = live_prices
                report["live_truncated"] = truncated
                if truncated:
                    warnings.append("live price stream truncated after %d records"
                                    % len(live_prices))
            report["degraded_upstreams"] = sorted(degraded)

        report["warnings"] = sorted(warnings)
        return report
