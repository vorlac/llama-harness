"""The live price stream, including the case where it dies part-way."""

from __future__ import annotations

import unittest

from feedservice import testing

from .base import FeedTestCase


class LiveStreamTests(FeedTestCase):
    def test_complete_stream_yields_every_record(self):
        report = self.make_app().dashboard(live=True)
        self.assertEqual(report["live_truncated"], False)
        self.assertEqual(report["live_prices"],
                         {"SKU-1": 1301, "SKU-2": 448, "SKU-3": 8710,
                          "SKU-4": 199})
        self.assertEqual(report["warnings"], ["no price for SKU-4"])


class TruncatedStreamTests(FeedTestCase):
    scenario = "truncated-stream"

    def test_records_read_before_the_break_are_kept(self):
        # The connection dies mid-body. The two records that did arrive are
        # real data and must survive; the caller is told the read was short.
        app = self.make_app()
        report = app.dashboard(live=True)
        self.assertEqual(report["live_prices"], {"SKU-1": 1301, "SKU-2": 448})
        self.assertEqual(report["live_truncated"], True)
        self.assertIn("live price stream truncated after 2 records",
                      report["warnings"])
        self.assertCounter(app, "stream_truncations", 1)

    def test_truncation_is_a_warning_not_a_degradation(self):
        report = self.make_app().dashboard(live=True)
        self.assertEqual(report["degraded_upstreams"], [])
        self.assertEqual(report["item_count"], 4)
        self.assertEqual(report["items"][0]["amount"], 1299)

    def test_a_truncated_stream_is_not_retried(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.dashboard(live=True)
        streams = [r for r in records if r.path.startswith("/pricing/live")]
        self.assertEqual(len(streams), 1)
        self.assertCounter(app, "retries", 0)


if __name__ == "__main__":
    unittest.main()
