"""Shared fixtures for the suite."""

from __future__ import annotations

import os
import sys
import unittest

# This copy sits at gauge/frozen/, two directories below the project root
# the suite drives, so the walk up is one level longer than the original.
_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import wirenet                                            # noqa: E402
from feedservice import testing                           # noqa: E402
from feedservice.app import Application                   # noqa: E402
from feedservice.config import demo_config                # noqa: E402


class FeedTestCase(unittest.TestCase):
    """Installs a fake upstream world and hands out Applications."""

    scenario = "default"

    def setUp(self):
        self.calls = testing.install_upstreams(self.scenario)
        self.addCleanup(wirenet.reset)

    def install(self, scenario):
        """Swap in a different world part-way through a test."""
        self.calls = testing.install_upstreams(scenario)
        return self.calls

    def make_app(self, config=None):
        app = Application(config if config is not None else demo_config())
        self.addCleanup(app.close)
        return app

    def config(self):
        return demo_config()

    def assertCounter(self, app, name, expected):
        actual = app.stats()[name]
        self.assertEqual(
            actual, expected,
            "counter %r was %d, expected %d (all counters: %r)"
            % (name, actual, expected, app.stats()))

    def paths_for(self, records, host):
        return [r.path for r in records if ("://" + host) in r.url]
