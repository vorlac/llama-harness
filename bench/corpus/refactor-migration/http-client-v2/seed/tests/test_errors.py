"""Error taxonomy as seen from outside the service."""

from __future__ import annotations

import unittest

from feedservice.errors import (FeedError, MalformedUpstreamPayload,
                                UpstreamRejected, UpstreamUnavailable)

from .base import FeedTestCase


class ErrorTranslationTests(FeedTestCase):
    def test_unreachable_host_is_a_connect_failure(self):
        self.install("catalog-offline")
        with self.assertRaises(UpstreamUnavailable) as caught:
            self.make_app().refresh("catalog")
        self.assertEqual(caught.exception.cause_kind, "connect")
        self.assertEqual(caught.exception.upstream, "catalog")

    def test_garbage_on_the_wire_is_a_protocol_failure(self):
        self.install("protocol-catalog")
        with self.assertRaises(UpstreamUnavailable) as caught:
            self.make_app().refresh("catalog")
        self.assertEqual(caught.exception.cause_kind, "protocol")

    def test_blown_timeout_budget_is_a_timeout_failure(self):
        # media.internal takes 0.4s to connect and 0.8s to answer. Point the
        # catalog at it with a 1s budget: 1.2s of work does not fit in 1s, so
        # this must fail as a timeout. (If it does not time out, media answers
        # 200 with a body that is not a catalog, and the error would be a
        # payload error instead - which is how a mis-mapped budget shows up.)
        config = self.config().with_upstream("catalog",
                                             base_url="http://media.internal",
                                             timeout_seconds=1.0)
        app = self.make_app(config)
        with self.assertRaises(UpstreamUnavailable) as caught:
            app.refresh("catalog")
        self.assertEqual(caught.exception.cause_kind, "timeout")

    def test_undecodable_body_is_a_payload_error(self):
        self.install("garbage-catalog")
        with self.assertRaises(MalformedUpstreamPayload) as caught:
            self.make_app().refresh("catalog")
        self.assertEqual(caught.exception.upstream, "catalog")

    def test_four_hundred_is_a_rejection(self):
        self.install("reject-pricing")
        with self.assertRaises(UpstreamRejected) as caught:
            self.make_app().refresh("pricing")
        self.assertEqual(caught.exception.status, 422)

    def test_every_service_error_is_a_feed_error(self):
        self.install("catalog-offline")
        with self.assertRaises(FeedError):
            self.make_app().refresh("catalog")


class LinkHeaderTests(unittest.TestCase):
    def test_next_cursor_parsing(self):
        from feedservice.clients.inventory import next_cursor
        header = '<http://inventory.internal/inventory?cursor=p2>; rel="next"'
        self.assertEqual(next_cursor(header), "p2")
        self.assertEqual(next_cursor(None), None)
        self.assertEqual(next_cursor('<http://x/y>; rel="prev"'), None)
        self.assertEqual(
            next_cursor('<http://x/y?cursor=a>; rel="prev", '
                        '<http://x/y?cursor=b>; rel="next"'), "b")


if __name__ == "__main__":
    unittest.main()
