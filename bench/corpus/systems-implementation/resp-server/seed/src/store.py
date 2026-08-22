# The keyspace: sixteen independent databases, their values and their expiries.
#
# Expiry is absolute, in milliseconds, on a monotonic clock. Every lookup goes
# through `alive`, so section 6.2's lazy rule holds for every command without
# any command having to remember it, and `size` deliberately does not, because
# section 11.9 makes DBSIZE the observable for the active cycle of section 6.3.

import time
import zlib

STRING = "string"
LIST = "list"
HASH = "hash"
SET = "set"

DATABASE_COUNT = 16

# SCAN buckets. The count is constant, so a key present for a whole iteration is
# in the same bucket throughout and is returned when that bucket is visited.
SCAN_BUCKETS = 1024
# Visiting at least this many buckets per call bounds a full iteration at
# SCAN_BUCKETS / SCAN_BUCKET_STRIDE calls, which is what section 7.4's
# max(64, 4 * ceil(N / count)) floor requires when N is small.
SCAN_BUCKET_STRIDE = 16


def now_ms() -> int:
    return int(time.monotonic() * 1000)


class Database:
    """One database's values and expiries."""

    def __init__(self):
        self.values = {}
        self.expiry = {}

    def alive(self, key: bytes) -> bool:
        """Whether the key exists, dropping it first if it has expired."""
        if key not in self.values:
            return False
        deadline = self.expiry.get(key)
        if deadline is not None and deadline <= now_ms():
            del self.values[key]
            del self.expiry[key]
            return False
        return True

    def entry(self, key: bytes):
        """`(kind, value)` for a live key, or None."""
        return self.values[key] if self.alive(key) else None

    def kind(self, key: bytes):
        entry = self.entry(key)
        return entry[0] if entry is not None else None

    def store(self, key: bytes, kind: str, value, keep_ttl: bool = False) -> None:
        self.values[key] = (kind, value)
        if not keep_ttl:
            self.expiry.pop(key, None)

    def drop(self, key: bytes) -> bool:
        """Remove a live key. An already-expired key is not a removal."""
        if not self.alive(key):
            return False
        del self.values[key]
        self.expiry.pop(key, None)
        return True

    def live_keys(self):
        return [key for key in list(self.values) if self.alive(key)]

    def size(self) -> int:
        """Keys physically present, expired or not."""
        return len(self.values)

    def flush(self) -> list:
        removed = self.live_keys()
        self.values.clear()
        self.expiry.clear()
        return removed

    def set_expiry(self, key: bytes, deadline: int) -> None:
        self.expiry[key] = deadline

    def clear_expiry(self, key: bytes) -> bool:
        return self.expiry.pop(key, None) is not None

    def deadline(self, key: bytes):
        return self.expiry.get(key)

    def sweep(self) -> list:
        """Every key whose deadline has passed, removed. Section 6.3."""
        cutoff = now_ms()
        doomed = [key for key, when in self.expiry.items() if when <= cutoff]
        for key in doomed:
            self.values.pop(key, None)
            self.expiry.pop(key, None)
        return doomed

    def scan(self, cursor: int, count: int):
        """`(next cursor, keys)` for one SCAN call, per section 7.4."""
        if cursor >= SCAN_BUCKETS:
            return 0, []
        buckets = {}
        for key in self.live_keys():
            buckets.setdefault(zlib.crc32(key) % SCAN_BUCKETS, []).append(key)
        found = []
        visited = 0
        while cursor < SCAN_BUCKETS:
            found.extend(buckets.get(cursor, ()))
            cursor += 1
            visited += 1
            if visited >= SCAN_BUCKET_STRIDE and len(found) >= count:
                break
        return (0 if cursor >= SCAN_BUCKETS else cursor), found


class Keyspace:
    """The sixteen databases a connection selects between."""

    def __init__(self):
        self.databases = [Database() for _ in range(DATABASE_COUNT)]

    def __getitem__(self, index: int) -> Database:
        return self.databases[index]

    def sweep(self) -> None:
        for database in self.databases:
            database.sweep()
