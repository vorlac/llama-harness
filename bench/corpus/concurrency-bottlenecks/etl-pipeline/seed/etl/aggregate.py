"""Delta tracking and windowed aggregation (SPEC.md sections 5.7, 5.8).

Both stages see accepted records in input order, which is what `first_ts`,
`last_ts` and the per-key delta chain are defined against.
"""

from .config import WINDOWS_HEADER
from .timestamps import format_timestamp
from .units import rdiv


class DeltaTracker:
    """The previous accepted value of every `(device_id, metric)` pair."""

    def __init__(self):
        self._previous = {}

    def observe(self, device_id, metric, value):
        """Return abs(value - previous) for this key, or None if it is the
        first accepted record for it."""
        key = (device_id, metric)
        previous = self._previous.get(key)
        self._previous[key] = value
        if previous is None:
            return None
        return abs(value - previous)


class Window:
    """The running aggregate of one `(device_id, metric, window_start)` group."""

    __slots__ = ("site_id", "region", "count", "sum_milli", "min_milli",
                 "max_milli", "max_abs_delta", "first_ts", "last_ts", "tags")

    def __init__(self, site_id, region, value, delta, timestamp, tags):
        self.site_id = site_id
        self.region = region
        self.count = 1
        self.sum_milli = value
        self.min_milli = value
        self.max_milli = value
        self.max_abs_delta = delta
        self.first_ts = timestamp
        self.last_ts = timestamp
        self.tags = set(tags)

    def update(self, value, delta, timestamp, tags):
        self.count += 1
        self.sum_milli += value
        if value < self.min_milli:
            self.min_milli = value
        if value > self.max_milli:
            self.max_milli = value
        if delta is not None and (self.max_abs_delta is None
                                  or delta > self.max_abs_delta):
            self.max_abs_delta = delta
        self.last_ts = timestamp
        if tags:
            self.tags.update(tags)


class WindowStore:
    """Every open aggregation group, keyed by (device_id, metric, window)."""

    def __init__(self):
        self._windows = {}

    def __len__(self):
        return len(self._windows)

    def add(self, device_id, metric, window_start, device, value, delta,
            timestamp, tags):
        key = (device_id, metric, window_start)
        window = self._windows.get(key)
        if window is None:
            self._windows[key] = Window(device.site_id, device.region, value,
                                        delta, timestamp, tags)
        else:
            window.update(value, delta, timestamp, tags)

    def total_sum_milli(self):
        return sum(window.sum_milli for window in self._windows.values())

    def distinct_device_count(self):
        return len(set(key[0] for key in self._windows))

    def rows(self):
        """Yield the data rows of `windows.csv` in the order section 2.1.1
        defines: device_id, then metric, then window start.  The key is a
        total order, so this fully determines the file."""
        for key in sorted(self._windows):
            device_id, metric, window_start = key
            window = self._windows[key]
            yield ",".join((
                device_id,
                window.site_id,
                window.region,
                metric,
                format_timestamp(window_start),
                str(window.count),
                str(window.sum_milli),
                str(window.min_milli),
                str(window.max_milli),
                str(rdiv(window.sum_milli, window.count)),
                "" if window.max_abs_delta is None
                else str(window.max_abs_delta),
                window.first_ts,
                window.last_ts,
                ";".join(sorted(window.tags)),
            ))


assert WINDOWS_HEADER.count(",") == 13
