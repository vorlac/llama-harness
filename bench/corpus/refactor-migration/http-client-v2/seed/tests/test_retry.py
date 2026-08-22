"""Retry policy: what gets retried, what does not, and how often."""

from __future__ import annotations

import unittest

from feedservice import testing
from feedservice.errors import (UpstreamRejected, UpstreamUnavailable)

from .base import FeedTestCase


class RetriedFailureTests(FeedTestCase):
    def test_server_errors_are_retried_until_they_succeed(self):
        self.install("flaky-catalog")     # 503, 503, then 200
        app = self.make_app()
        with testing.capture_requests() as records:
            report = app.dashboard()
        self.assertEqual(report["item_count"], 4)
        self.assertEqual(len(self.paths_for(records, "catalog.internal")), 3)
        self.assertCounter(app, "retries", 2)

    def test_throttling_is_retried(self):
        self.install("throttled-pricing")   # 429 once, then 200
        app = self.make_app()
        with testing.capture_requests() as records:
            report = app.dashboard()
        self.assertEqual(report["degraded_upstreams"], [])
        self.assertEqual(report["items"][0]["amount"], 1299)
        self.assertEqual(len(self.paths_for(records, "pricing.internal")), 2)
        self.assertCounter(app, "retries", 1)

    def test_the_retry_budget_is_finite(self):
        self.install("flaky-catalog")
        app = self.make_app(self.config().with_retries(1, names=["catalog"]))
        with testing.capture_requests() as records:
            with self.assertRaises(UpstreamUnavailable):
                app.dashboard()
        self.assertEqual(len(self.paths_for(records, "catalog.internal")), 2)


class NotRetriedFailureTests(FeedTestCase):
    def test_protocol_failures_are_not_retried(self):
        # A peer that speaks garbage will speak garbage again; hammering it has
        # caused outages before. This must stay at exactly one attempt.
        self.install("protocol-catalog")
        app = self.make_app()
        with testing.capture_requests() as records:
            with self.assertRaises(UpstreamUnavailable) as caught:
                app.dashboard()
        self.assertEqual(caught.exception.cause_kind, "protocol")
        self.assertEqual(len(self.paths_for(records, "catalog.internal")), 1)
        self.assertCounter(app, "retries", 0)

    def test_client_errors_are_not_retried(self):
        self.install("reject-pricing")
        app = self.make_app()
        with testing.capture_requests() as records:
            app.dashboard()
        self.assertEqual(len(self.paths_for(records, "pricing.internal")), 1)
        self.assertCounter(app, "retries", 0)

    def test_rejections_surface_their_status(self):
        self.install("reject-pricing")
        app = self.make_app()
        with self.assertRaises(UpstreamRejected) as caught:
            app.refresh("pricing")
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.upstream, "pricing")


class RetryHelperTests(unittest.TestCase):
    def test_classification(self):
        from feedservice.errors import (MalformedUpstreamPayload,
                                        UpstreamThrottled)
        from feedservice.retry import is_retryable
        self.assertTrue(is_retryable(UpstreamThrottled("pricing", 1.0)))
        self.assertTrue(is_retryable(UpstreamUnavailable("a", "timeout")))
        self.assertTrue(is_retryable(UpstreamUnavailable("a", "connect")))
        self.assertTrue(is_retryable(UpstreamUnavailable("a", "server")))
        self.assertFalse(is_retryable(UpstreamUnavailable("a", "protocol")))
        self.assertFalse(is_retryable(UpstreamRejected("a", 404)))
        self.assertFalse(is_retryable(MalformedUpstreamPayload("a", "bad")))

    def test_backoff_grows_and_is_capped(self):
        from feedservice.config import RetryPolicy
        from feedservice.retry import backoff_delay
        policy = RetryPolicy(retries=5, backoff_base_seconds=0.1,
                             max_delay_seconds=0.25)
        self.assertAlmostEqual(backoff_delay(1, policy), 0.1)
        self.assertAlmostEqual(backoff_delay(2, policy), 0.2)
        self.assertAlmostEqual(backoff_delay(3, policy), 0.25)
        self.assertAlmostEqual(backoff_delay(9, policy), 0.25)


if __name__ == "__main__":
    unittest.main()
