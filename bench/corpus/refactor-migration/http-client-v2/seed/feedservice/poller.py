"""Background refresher.

Keeps the hot cache entries warm so a foreground request rarely pays for an
upstream round trip. It runs on its own worker, ticks on a fixed interval, and
must stop promptly when asked - the process will not exit while it is running.

The tick itself is decorated with @with_retries, which is why the poller has to
expose ``retry_policy`` and ``metrics`` like a client does.
"""

from __future__ import annotations

import threading
import time

from .config import DATA_UPSTREAMS, RetryPolicy
from .errors import FeedError
from .retry import with_retries


class Poller(object):
    def __init__(self, config, metrics, refresh, keys=None, interval=None,
                 retry_policy=None):
        self.config = config
        self.metrics = metrics
        self._refresh = refresh
        self.keys = tuple(keys if keys is not None else DATA_UPSTREAMS)
        self.interval = (interval if interval is not None
                         else config.poll_interval_seconds)
        self.retry_policy = (retry_policy if retry_policy is not None
                             else RetryPolicy(retries=1, backoff_base_seconds=0.0,
                                              max_delay_seconds=0.05))
        self.ticks = 0
        self.last_error = None
        self.running = False
        self._stop = threading.Event()
        self._worker = None
        self._condition = threading.Condition()

    # ------------------------------------------------------------ control

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self.running = True
        self._worker = threading.Thread(target=self._run, name="feed-poller",
                                        daemon=True)
        self._worker.start()

    def stop(self, timeout: float = 2.0) -> bool:
        """Ask the poller to stop and wait for it. True if it actually stopped."""
        if not self.running:
            return True
        self._stop.set()
        worker, self._worker = self._worker, None
        if worker is not None:
            worker.join(timeout)
            stopped = not worker.is_alive()
        else:
            stopped = True
        self.running = False
        return stopped

    def wait_for_ticks(self, count: int, timeout: float = 5.0) -> bool:
        """Block until at least ``count`` ticks have completed."""
        deadline = time.monotonic() + timeout
        with self._condition:
            while self.ticks < count:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return True

    # --------------------------------------------------------------- loop

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick()
            except FeedError as exc:
                self.last_error = exc
                self.metrics.incr("poller_errors")
            except Exception as exc:                # a poller must never die
                self.last_error = exc
                self.metrics.incr("poller_errors")
            self.metrics.incr("poller_ticks")
            with self._condition:
                self.ticks += 1
                self._condition.notify_all()
            if self._stop.wait(self.interval):
                break

    @with_retries
    def _tick(self) -> None:
        for key in self.keys:
            self._refresh(key)
