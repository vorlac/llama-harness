"""The feedservice.testing helpers are themselves a contract.

Anyone writing tests against a service that embeds feedservice uses these, so
their signatures, their synchronous surface and the shape of what they return
are all fixed.
"""

from __future__ import annotations

import unittest

from feedservice import testing

from .base import FeedTestCase


class CaptureRequestsTests(FeedTestCase):
    def test_every_request_is_recorded_in_order(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.dashboard()
        self.assertEqual([r.method for r in records],
                         ["GET", "POST", "GET", "GET", "GET"])
        self.assertEqual(records[0].path, "/catalog/index")
        self.assertEqual(records[1].path, "/pricing/batch")
        self.assertEqual([r.path.split("?")[0] for r in records[2:]],
                         ["/inventory", "/inventory", "/inventory"])

    def test_records_carry_the_timeout_budget_as_seconds(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.dashboard()
        self.assertEqual(records[0].timeout_seconds, 2.0)
        self.assertEqual(records[1].timeout_seconds, 2.5)
        self.assertTrue(all(isinstance(r.timeout_seconds, float)
                            for r in records))

    def test_recording_stops_at_the_end_of_the_block(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.dashboard()
        before = len(records)
        self.make_app().dashboard()
        self.assertEqual(len(records), before)

    def test_attempt_numbers_increase_within_a_session(self):
        app = self.make_app()
        with testing.capture_requests() as records:
            app.dashboard()
        inventory = [r for r in records if "inventory.internal" in r.url]
        self.assertEqual([r.attempt for r in inventory], [1, 2, 3])


class ProbeUrlTests(FeedTestCase):
    def test_success(self):
        self.assertEqual(testing.probe_url("http://catalog.internal/healthz"),
                         {"ok": True, "status": 200, "failure": None})

    def test_http_error_is_not_a_failure(self):
        self.assertEqual(testing.probe_url("http://inventory.internal/nope"),
                         {"ok": False, "status": 404, "failure": None})

    def test_protocol_failure(self):
        self.assertEqual(testing.probe_url("http://search.internal/healthz"),
                         {"ok": False, "status": None, "failure": "protocol"})

    def test_unreachable_host(self):
        self.assertEqual(testing.probe_url("http://nowhere.internal/healthz"),
                         {"ok": False, "status": None, "failure": "connect"})


class InstallUpstreamsTests(FeedTestCase):
    def test_installing_returns_the_call_counters(self):
        calls = testing.install_upstreams("default")
        self.assertEqual(calls, {"catalog": 0, "pricing": 0, "inventory": 0,
                                 "live": 0})
        self.make_app().dashboard()
        self.assertEqual(calls["catalog"], 1)
        self.assertEqual(calls["inventory"], 3)

    def test_unknown_scenario_is_rejected(self):
        with self.assertRaises(ValueError):
            testing.install_upstreams("no-such-scenario")


if __name__ == "__main__":
    unittest.main()
