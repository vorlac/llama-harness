# lru — weight-bounded LRU cache with per-entry expiry

A small C++17 cache library. One header holds the cache template; the two
translation units under `src/` carry the non-template pieces (clock, counters)
plus a demonstration binary.

## Design

- **Slot table.** Open addressing, linear probing, power-of-two slot count,
  tombstones on erase. Growing the table moves entries between slots and
  rewrites `Node::slot`; it never moves a node itself.
- **Recency list.** Every entry is a member of one intrusive doubly linked
  list ordered newest-first. `get()` and a repeated `put()` move an entry to
  the hot end; eviction takes from the cold end.
- **Weight, not count.** Callers give each entry a weight and the cache keeps
  the resident total at or below `CacheConfig::weight_capacity`. An entry
  heavier than the whole capacity is refused.
- **Expiry.** `CacheConfig::default_ttl_ms` applies to `put()`;
  `put_with_ttl()` overrides it per entry. `0` means the entry never times
  out. Timed-out entries are reclaimed lazily on lookup, on `purge_expired()`,
  and when the cache needs room.
- **Clock injection.** Nothing calls a global clock. Production code gets
  `system_clock()`; tests construct a `ManualClock` and move it by hand, so
  expiry behaviour is reproducible.

Not thread-safe.

## Layout

```
include/lru/lru_cache.hpp   the cache template
include/lru/clock.hpp       Clock, SystemClock, ManualClock
include/lru/stats.hpp       CacheStats
src/clock.cpp               SystemClock, system_clock()
src/stats.cpp               CacheStats::hit_rate / to_string
src/main.cpp                demonstration workload
tests/harness.hpp/.cpp      TEST / CHECK / CHECK_EQ, no external framework
tests/test_basics.cpp       store, read, replace, erase
tests/test_eviction.cpp     capacity pressure, recency order, expiry
tests/test_table.cpp        table growth, copy and move semantics
BUGS.md                     the open field reports against this version
```

## Build and test

```sh
bash build.sh          # make clean && make all
bash run.sh            # demonstration workload, prints counters
bash test.sh           # whole suite; exit 0 only if every test passes
bash test.sh purge     # only tests whose name contains "purge"
```

`make test` does the same as `bash test.sh`. The build is expected to be free of
warnings under `-Wall -Wextra -Wpedantic -Wshadow -Wnon-virtual-dtor`.

## Usage

```cpp
#include "lru/lru_cache.hpp"

lru::CacheConfig config;
config.weight_capacity = 64 * 1024;
config.default_ttl_ms = 30000;

lru::LruCache<std::string, std::string> cache(config);
cache.put("session:1", payload, payload.size());

if (auto hit = cache.get("session:1")) {
  use(*hit);
}
```
