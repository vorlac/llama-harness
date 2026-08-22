"""Session scoping: nesting is free, and scopes clean up after themselves."""

from __future__ import annotations

import unittest

from feedservice import session

from .base import FeedTestCase


class ScopeTests(FeedTestCase):
    def test_a_dashboard_build_opens_one_pool(self):
        # The build nests scopes several deep (application, then each client).
        # Only the outermost may create a pool.
        app = self.make_app()
        app.dashboard()
        self.assertCounter(app, "pools_opened", 1)
        self.assertCounter(app, "sessions_opened", 3)

    def test_parallel_refreshes_share_the_callers_pool(self):
        app = self.make_app()
        app.refresh_many(["catalog", "pricing", "inventory"])
        self.assertCounter(app, "pools_opened", 1)
        self.assertCounter(app, "sessions_opened", 3)

    def test_repeated_builds_open_one_pool_each(self):
        app = self.make_app()
        app.dashboard()
        app.dashboard()
        self.assertCounter(app, "pools_opened", 2)

    def test_no_scope_leaks_out_of_a_call(self):
        app = self.make_app()
        self.assertIsNone(session.current_pool())
        app.dashboard()
        self.assertIsNone(session.current_pool())
        app.health()
        self.assertIsNone(session.current_pool())

    def test_health_checks_use_their_own_pool(self):
        app = self.make_app()
        app.health()
        self.assertCounter(app, "pools_opened", 1)
        self.assertCounter(app, "sessions_opened", 5)


if __name__ == "__main__":
    unittest.main()
