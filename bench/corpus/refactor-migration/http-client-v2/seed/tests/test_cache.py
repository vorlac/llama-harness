"""Caching: freshness, revalidation, single flight and stale-on-error."""

from __future__ import annotations

import unittest

from feedservice.errors import MalformedUpstreamPayload

from .base import FeedTestCase


class FreshnessTests(FeedTestCase):
    def test_fresh_entries_are_not_refetched(self):
        app = self.make_app()
        self.assertEqual(app.refresh("catalog"), "loaded")
        self.assertEqual(app.refresh("catalog"), "fresh")
        self.assertCounter(app, "upstream_requests", 1)
        self.assertCounter(app, "cache_hits", 1)

    def test_expired_entries_revalidate_with_an_etag(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        self.assertEqual(app.refresh("catalog"), "loaded")
        self.assertEqual(app.refresh("catalog"), "revalidated")
        self.assertEqual(app.refresh("catalog"), "revalidated")
        self.assertCounter(app, "upstream_requests", 3)
        self.assertCounter(app, "conditional_hits", 2)

    def test_revalidated_entries_keep_their_value(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        first = app.dashboard()
        second = app.dashboard()
        self.assertEqual(first["items"], second["items"])
        self.assertEqual(second["sources"]["catalog"], "revalidated")


class SingleFlightTests(FeedTestCase):
    scenario = "slow-catalog"

    def test_concurrent_loads_of_one_key_make_one_request(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        sources = app.refresh_many(["catalog"] * 4)
        self.assertEqual(sorted(sources), ["coalesced"] * 3 + ["loaded"])
        self.assertCounter(app, "upstream_requests", 1)
        self.assertCounter(app, "cache_coalesced", 3)

    def test_coalesced_callers_see_the_leaders_value(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        app.refresh_many(["catalog"] * 4)
        report = app.dashboard()
        self.assertEqual(report["item_count"], 4)


class StaleOnErrorTests(FeedTestCase):
    def test_transient_failure_serves_the_stale_entry(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        self.assertEqual(app.refresh("catalog"), "loaded")
        self.install("catalog-offline")
        self.assertEqual(app.refresh("catalog"), "stale")
        self.assertCounter(app, "stale_served", 1)
        self.assertEqual(app.dashboard()["item_count"], 4)

    def test_fatal_failure_does_not_serve_the_stale_entry(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        self.assertEqual(app.refresh("catalog"), "loaded")
        self.install("garbage-catalog")
        with self.assertRaises(MalformedUpstreamPayload):
            app.refresh("catalog")
        self.assertCounter(app, "stale_served", 0)

    def test_stale_window_is_bounded_by_the_grace_setting(self):
        config = self.config().with_cache_ttl(0.0).with_settings(
            stale_grace_seconds=0.0)
        app = self.make_app(config)
        self.assertEqual(app.refresh("catalog"), "loaded")
        self.install("catalog-offline")
        with self.assertRaises(Exception):
            app.refresh("catalog")
        self.assertCounter(app, "stale_served", 0)


if __name__ == "__main__":
    unittest.main()
