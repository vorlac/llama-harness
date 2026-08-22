// Small demonstration workload: fills a cache from a synthetic key stream and
// prints the resulting counters. Deterministic, no arguments, no input files.
#include <cstdio>
#include <string>

#include "lru/clock.hpp"
#include "lru/lru_cache.hpp"

namespace {

// Deterministic pseudo-random stream; no dependency on <random> defaults.
class KeyStream {
 public:
  explicit KeyStream(std::uint64_t seed) : state_(seed) {}

  int next(int modulus) {
    state_ = state_ * 6364136223846793005ULL + 1442695040888963407ULL;
    const std::uint64_t bits = (state_ >> 33);
    return static_cast<int>(bits % static_cast<std::uint64_t>(modulus));
  }

 private:
  std::uint64_t state_;
};

}  // namespace

int main() {
  lru::ManualClock clock;
  lru::CacheConfig config;
  config.weight_capacity = 512;
  config.default_ttl_ms = 2000;
  config.initial_slots = 32;

  lru::LruCache<int, std::string> cache(config, &clock);
  KeyStream stream(20240817);

  for (int step = 0; step < 20000; ++step) {
    const int key = stream.next(400);
    if (!cache.get(key).has_value()) {
      cache.put(key, "record-" + std::to_string(key), 8);
    }
    if (step % 100 == 99) {
      clock.advance(50);
    }
  }

  std::printf("entries: %zu\n", cache.size());
  std::printf("weight:  %zu / %zu\n", cache.weight(), cache.weight_capacity());
  std::printf("slots:   %zu\n", cache.slot_count());
  std::printf("stats:   %s\n", cache.stats().to_string().c_str());
  return 0;
}
