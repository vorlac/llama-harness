// Counters maintained by LruCache.
//
// Every counter is monotonic for the lifetime of the cache unless
// reset_stats() is called. They are plain integers: the cache is not
// thread-safe and the counters make no attempt to be either.
#ifndef LRU_STATS_HPP
#define LRU_STATS_HPP

#include <cstddef>
#include <cstdint>
#include <string>

namespace lru {

struct CacheStats {
  std::uint64_t hits = 0;
  std::uint64_t misses = 0;
  std::uint64_t insertions = 0;
  std::uint64_t updates = 0;
  std::uint64_t evictions = 0;
  std::uint64_t expirations = 0;
  std::uint64_t rejections = 0;

  std::uint64_t lookups() const { return hits + misses; }

  // Fraction of lookups served from the cache, 0.0 when nothing was looked up.
  double hit_rate() const;

  // Single-line, stable field order. Intended for logs, not for parsing.
  std::string to_string() const;

  void reset() { *this = CacheStats(); }
};

}  // namespace lru

#endif  // LRU_STATS_HPP
