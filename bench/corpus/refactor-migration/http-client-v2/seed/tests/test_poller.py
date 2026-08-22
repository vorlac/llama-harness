"""The background poller."""

from __future__ import annotations

import unittest

from .base import FeedTestCase


class PollerLifecycleTests(FeedTestCase):
    def test_it_ticks_and_then_stops(self):
        app = self.make_app()
        app.start_poller(interval=0.01)
        self.assertTrue(app.wait_for_poll_ticks(2, timeout=10.0))
        self.assertTrue(app.poller_running)
        self.assertTrue(app.stop_poller(timeout=5.0))
        self.assertFalse(app.poller_running)
        self.assertGreaterEqual(app.stats()["poller_ticks"], 2)

    def test_stopping_twice_is_harmless(self):
        app = self.make_app()
        app.start_poller(interval=0.01)
        self.assertTrue(app.wait_for_poll_ticks(1, timeout=10.0))
        self.assertTrue(app.stop_poller(timeout=5.0))
        self.assertTrue(app.stop_poller(timeout=5.0))

    def test_starting_twice_does_not_start_two_pollers(self):
        app = self.make_app()
        app.start_poller(interval=0.01)
        app.start_poller(interval=0.01)
        self.assertTrue(app.wait_for_poll_ticks(2, timeout=10.0))
        app.stop_poller(timeout=5.0)
        self.assertLessEqual(app.stats()["upstream_requests"], 5)


class PollerCacheTests(FeedTestCase):
    def test_the_poller_warms_the_cache_the_foreground_reads(self):
        app = self.make_app()
        app.start_poller(interval=0.01)
        self.assertTrue(app.wait_for_poll_ticks(3, timeout=10.0))
        app.stop_poller(timeout=5.0)
        # First tick loaded everything; later ticks found it fresh.
        self.assertCounter(app, "upstream_requests", 5)
        report = app.dashboard()
        self.assertEqual(set(report["sources"].values()), {"fresh"})
        self.assertCounter(app, "upstream_requests", 5)

    def test_the_foreground_still_works_while_the_poller_runs(self):
        app = self.make_app(self.config().with_cache_ttl(0.0))
        app.start_poller(interval=0.01)
        try:
            for _ in range(3):
                report = app.dashboard()
                self.assertEqual(report["item_count"], 4)
                self.assertEqual(report["degraded_upstreams"], [])
        finally:
            self.assertTrue(app.stop_poller(timeout=5.0))


class PollerFailureTests(FeedTestCase):
    scenario = "catalog-offline"

    def test_a_failing_upstream_does_not_kill_the_poller(self):
        app = self.make_app()
        app.start_poller(interval=0.01)
        self.assertTrue(app.wait_for_poll_ticks(2, timeout=10.0))
        self.assertTrue(app.poller_running)
        self.assertGreaterEqual(app.stats()["poller_errors"], 1)
        self.assertTrue(app.stop_poller(timeout=5.0))


if __name__ == "__main__":
    unittest.main()
