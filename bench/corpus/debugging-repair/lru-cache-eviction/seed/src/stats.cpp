#include "lru/stats.hpp"

#include <cstdio>

namespace lru {

double CacheStats::hit_rate() const {
  const std::uint64_t total = lookups();
  if (total == 0) {
    return 0.0;
  }
  return static_cast<double>(hits) / static_cast<double>(total);
}

std::string CacheStats::to_string() const {
  char buffer[256];
  const int written = std::snprintf(
      buffer, sizeof(buffer),
      "hits=%llu misses=%llu insertions=%llu updates=%llu "
      "evictions=%llu expirations=%llu rejections=%llu hit_rate=%.4f",
      static_cast<unsigned long long>(hits),
      static_cast<unsigned long long>(misses),
      static_cast<unsigned long long>(insertions),
      static_cast<unsigned long long>(updates),
      static_cast<unsigned long long>(evictions),
      static_cast<unsigned long long>(expirations),
      static_cast<unsigned long long>(rejections),
      hit_rate());
  if (written <= 0) {
    return std::string();
  }
  return std::string(buffer, static_cast<std::size_t>(written));
}

}  // namespace lru
