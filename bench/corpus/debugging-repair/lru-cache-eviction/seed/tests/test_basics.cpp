// Store, read, replace, erase. Nothing here depends on eviction or on time.
#include <string>

#include "harness.hpp"
#include "lru/lru_cache.hpp"

namespace {

using Cache = lru::LruCache<int, std::string>;

lru::CacheConfig roomy() {
  lru::CacheConfig config;
  config.weight_capacity = 1000;
  return config;
}

std::string value_of(Cache& cache, int key) {
  return cache.get(key).value_or("<absent>");
}

}  // namespace

TEST(test_put_then_get_returns_stored_value) {
  Cache cache(roomy());
  CHECK(cache.put(1, "alpha", 4));
  CHECK_EQ(cache.size(), std::size_t{1});
  CHECK_EQ(cache.weight(), std::size_t{4});
  CHECK_EQ(value_of(cache, 1), std::string("alpha"));
}

TEST(test_get_of_absent_key_reports_a_miss) {
  Cache cache(roomy());
  cache.put(1, "alpha", 4);
  CHECK(!cache.get(2).has_value());
  CHECK_EQ(cache.stats().misses, std::uint64_t{1});
  CHECK_EQ(cache.stats().hits, std::uint64_t{0});
}

TEST(test_second_put_of_same_key_replaces_the_value) {
  Cache cache(roomy());
  CHECK(cache.put(7, "first", 3));
  CHECK(!cache.put(7, "second", 3));
  CHECK_EQ(cache.size(), std::size_t{1});
  CHECK_EQ(value_of(cache, 7), std::string("second"));
  CHECK_EQ(cache.stats().insertions, std::uint64_t{1});
  CHECK_EQ(cache.stats().updates, std::uint64_t{1});
}

TEST(test_erase_removes_the_entry_and_releases_its_weight) {
  Cache cache(roomy());
  cache.put(1, "alpha", 6);
  cache.put(2, "beta", 9);
  CHECK(cache.erase(1));
  CHECK(!cache.erase(1));
  CHECK_EQ(cache.size(), std::size_t{1});
  CHECK_EQ(cache.weight(), std::size_t{9});
  CHECK(!cache.contains(1));
  CHECK(cache.contains(2));
}

TEST(test_clear_empties_the_cache_but_keeps_counters) {
  Cache cache(roomy());
  cache.put(1, "alpha", 6);
  cache.put(2, "beta", 9);
  cache.get(1);
  const std::uint64_t hits = cache.stats().hits;
  cache.clear();
  CHECK(cache.empty());
  CHECK_EQ(cache.size(), std::size_t{0});
  CHECK_EQ(cache.weight(), std::size_t{0});
  CHECK_EQ(cache.stats().hits, hits);
  CHECK(cache.put(3, "gamma", 2));
  CHECK_EQ(value_of(cache, 3), std::string("gamma"));
}

TEST(test_peek_reads_without_changing_recency) {
  Cache cache(roomy());
  cache.put(1, "alpha", 1);
  cache.put(2, "beta", 1);
  cache.put(3, "gamma", 1);
  const std::string* found = cache.peek(1);
  CHECK(found != nullptr);
  if (found != nullptr) {
    CHECK_EQ(*found, std::string("alpha"));
  }
  const std::vector<int> order = cache.keys_mru_first();
  CHECK_EQ(order.size(), std::size_t{3});
  CHECK_EQ(order.front(), 3);
  CHECK_EQ(order.back(), 1);
  CHECK_EQ(cache.stats().hits, std::uint64_t{0});
}

TEST(test_keys_are_listed_most_recently_used_first) {
  Cache cache(roomy());
  cache.put(1, "alpha", 1);
  cache.put(2, "beta", 1);
  cache.put(3, "gamma", 1);
  cache.get(1);
  const std::vector<int> order = cache.keys_mru_first();
  CHECK_EQ(order.size(), std::size_t{3});
  CHECK_EQ(order[0], 1);
  CHECK_EQ(order[1], 3);
  CHECK_EQ(order[2], 2);
}

TEST(test_entry_heavier_than_the_whole_capacity_is_refused) {
  lru::CacheConfig config;
  config.weight_capacity = 16;
  Cache cache(config);
  cache.put(1, "alpha", 8);
  CHECK(!cache.put(2, "enormous", 64));
  CHECK(!cache.contains(2));
  CHECK(cache.contains(1));
  CHECK_EQ(cache.size(), std::size_t{1});
  CHECK_EQ(cache.weight(), std::size_t{8});
  CHECK_EQ(cache.stats().rejections, std::uint64_t{1});
}

TEST(test_hit_and_miss_counters_follow_lookups) {
  Cache cache(roomy());
  cache.put(1, "alpha", 1);
  cache.get(1);
  cache.get(1);
  cache.get(2);
  CHECK_EQ(cache.stats().hits, std::uint64_t{2});
  CHECK_EQ(cache.stats().misses, std::uint64_t{1});
  CHECK_EQ(cache.stats().lookups(), std::uint64_t{3});
  CHECK(cache.stats().hit_rate() > 0.66);
  CHECK(cache.stats().hit_rate() < 0.67);
}
