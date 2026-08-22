"""The report a dashboard build produces."""

from __future__ import annotations

import unittest

from feedservice.errors import UpstreamUnavailable

from .base import FeedTestCase


class ReportContentTests(FeedTestCase):
    def test_report_joins_catalog_pricing_and_inventory(self):
        report = self.make_app().dashboard()
        self.assertEqual(report["item_count"], 4)
        self.assertEqual([row["id"] for row in report["items"]],
                         ["SKU-1", "SKU-2", "SKU-3", "SKU-4"])
        by_id = dict((row["id"], row) for row in report["items"])
        self.assertEqual(by_id["SKU-1"]["amount"], 1299)
        self.assertEqual(by_id["SKU-1"]["currency"], "USD")
        self.assertEqual(by_id["SKU-1"]["on_hand"], 12)
        self.assertEqual(by_id["SKU-1"]["status"], "available")
        self.assertEqual(by_id["SKU-2"]["status"], "out-of-stock")
        self.assertEqual(by_id["SKU-3"]["name"], "Copper Sprocket")

    def test_unpriced_items_are_flagged_not_dropped(self):
        report = self.make_app().dashboard()
        by_id = dict((row["id"], row) for row in report["items"])
        self.assertEqual(by_id["SKU-4"]["amount"], None)
        self.assertEqual(by_id["SKU-4"]["status"], "unpriced")
        self.assertIn("no price for SKU-4", report["warnings"])

    def test_healthy_report_has_no_degraded_upstreams(self):
        report = self.make_app().dashboard()
        self.assertEqual(report["degraded_upstreams"], [])
        self.assertEqual(report["sources"],
                         {"catalog": "loaded", "pricing": "loaded",
                          "inventory": "loaded"})

    def test_two_runs_produce_identical_reports(self):
        first = self.make_app().dashboard()
        second = self.make_app().dashboard()
        self.assertEqual(first, second)

    def test_cold_build_issues_exactly_five_requests(self):
        # catalog index, pricing batch, three inventory pages.
        app = self.make_app()
        report = app.dashboard()
        self.assertCounter(app, "upstream_requests", 5)
        self.assertEqual(report["upstream_calls"], 5)

    def test_a_live_build_reads_the_stream_as_well(self):
        report = self.make_app().dashboard(live=True)
        self.assertEqual(report["upstream_calls"], 6)

    def test_second_build_is_served_from_cache(self):
        app = self.make_app()
        app.dashboard()
        report = app.dashboard()
        self.assertCounter(app, "upstream_requests", 5)
        self.assertEqual(report["upstream_calls"], 0)
        self.assertEqual(set(report["sources"].values()), {"fresh"})


class DegradedReportTests(FeedTestCase):
    def test_pricing_rejection_degrades_the_report(self):
        self.install("reject-pricing")
        report = self.make_app().dashboard()
        self.assertEqual(report["degraded_upstreams"], ["pricing"])
        self.assertEqual(report["item_count"], 4)
        self.assertEqual(report["sources"]["pricing"], "unavailable")
        self.assertIn("pricing unavailable (UpstreamRejected)", report["warnings"])
        self.assertTrue(all(row["amount"] is None for row in report["items"]))
        self.assertEqual(report["items"][0]["on_hand"], 12)

    def test_inventory_page_failure_degrades_the_report(self):
        self.install("bad-inventory-page")
        report = self.make_app().dashboard()
        self.assertEqual(report["degraded_upstreams"], ["inventory"])
        self.assertIn("inventory unavailable (UpstreamRejected)", report["warnings"])
        self.assertTrue(all(row["on_hand"] is None for row in report["items"]))
        self.assertEqual(report["items"][0]["amount"], 1299)

    def test_catalog_failure_fails_the_whole_build(self):
        self.install("catalog-offline")
        with self.assertRaises(UpstreamUnavailable) as caught:
            self.make_app().dashboard()
        self.assertEqual(caught.exception.upstream, "catalog")


if __name__ == "__main__":
    unittest.main()
