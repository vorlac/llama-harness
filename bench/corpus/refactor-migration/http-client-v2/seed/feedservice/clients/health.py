"""Health probes.

Probes deliberately bypass the cache and the retry decorator: a health check
that retries is measuring the retry policy, not the upstream. Each probe uses
that upstream's own configured timeout.
"""

from __future__ import annotations

from ..session import session_scope


class HealthClient(object):
    def __init__(self, config, gateway, metrics):
        self.config = config
        self.gateway = gateway
        self.metrics = metrics

    def check(self, upstream) -> str:
        with session_scope(self.config, self.metrics):
            return self.gateway.probe(upstream)

    def check_all(self):
        """Probe every configured upstream. Returns {name: state}."""
        states = {}
        with session_scope(self.config, self.metrics):
            for name in self.config.names():
                states[name] = self.gateway.probe(name)
        return states

    def degraded(self, states=None):
        states = states if states is not None else self.check_all()
        return sorted(name for name, state in states.items() if state != "ok")
