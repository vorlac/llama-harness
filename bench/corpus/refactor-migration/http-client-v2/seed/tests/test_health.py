"""Health probes, and the timeout budget they are given."""

from __future__ import annotations

import unittest

from feedservice import testing

from .base import FeedTestCase

# media.internal answers correctly, but takes 0.4s to connect and 0.8s to
# respond. Neither half exceeds the 1.0s budget configured for it; the two
# together do. A client that is given "1 second" and spends 1.2 has blown its
# budget, and the health check has to say so.
MEDIA_URL = "http://media.internal/healthz"


class HealthStateTests(FeedTestCase):
    def test_every_upstream_reports_a_state(self):
        states = self.make_app().health()
        self.assertEqual(states, {
            "catalog": "ok",
            "inventory": "ok",
            "media": "timeout",
            "pricing": "ok",
            "search": "protocol",
        })

    def test_health_probes_are_not_retried(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.health()
        self.assertEqual(len(records), 5)
        self.assertCounter(app, "retries", 0)

    def test_probes_use_the_configured_budget(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.health()
        budgets = dict((r.url.split("//")[1].split("/")[0], r.timeout_seconds)
                       for r in records)
        self.assertEqual(budgets["media.internal"], 1.0)
        self.assertEqual(budgets["catalog.internal"], 2.0)
        self.assertEqual(budgets["pricing.internal"], 2.5)


class TimeoutBudgetTests(FeedTestCase):
    def test_a_one_second_budget_does_not_cover_a_1_2_second_request(self):
        self.assertEqual(testing.probe_url(MEDIA_URL, 1.0),
                         {"ok": False, "status": None, "failure": "timeout"})

    def test_a_two_second_budget_does(self):
        self.assertEqual(testing.probe_url(MEDIA_URL, 2.0),
                         {"ok": True, "status": 200, "failure": None})

    def test_raising_the_budget_changes_the_health_state(self):
        app = self.make_app(self.config().with_upstream("media",
                                                        timeout_seconds=2.0))
        self.assertEqual(app.health()["media"], "ok")


if __name__ == "__main__":
    unittest.main()
