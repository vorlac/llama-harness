// Capacity pressure, recency order and entry lifetimes.
//
// Every test that involves time drives a ManualClock, so no test here depends
// on how long it takes to run.
#include <string>

#include "harness.hpp"
#include "lru/clock.hpp"
#include "lru/lru_cache.hpp"

namespace {

using Cache = lru::LruCache<int, std::string>;

lru::CacheConfig with_capacity(std::size_t capacity) {
  lru::CacheConfig config;
  config.weight_capacity = capacity;
  return config;
}

}  // namespace

TEST(test_coldest_entry_is_dropped_when_capacity_is_exceeded) {
  Cache cache(with_capacity(30));
  cache.put(1, "alpha", 10);
  cache.put(2, "beta", 10);
  cache.put(3, "gamma", 10);
  cache.put(4, "delta", 10);
  CHECK_EQ(cache.size(), std::size_t{3});
  CHECK_EQ(cache.weight(), std::size_t{30});
  CHECK(!cache.contains(1));
  CHECK(cache.contains(2));
  CHECK(cache.contains(3));
  CHECK(cache.contains(4));
  CHECK_EQ(cache.stats().evictions, std::uint64_t{1});
}

TEST(test_recently_read_entry_outlives_an_untouched_one) {
  Cache cache(with_capacity(30));
  cache.put(1, "alpha", 10);
  cache.put(2, "beta", 10);
  cache.put(3, "gamma", 10);
  CHECK(cache.get(1).has_value());
  cache.put(4, "delta", 10);
  CHECK(cache.contains(1));
  CHECK(!cache.contains(2));
  CHECK_EQ(cache.size(), std::size_t{3});
}

TEST(test_resident_weight_stays_within_capacity) {
  Cache cache(with_capacity(35));
  for (int key = 1; key <= 8; ++key) {
    cache.put(key, "payload", 7);
    CHECK(cache.weight() <= std::size_t{35});
  }
  CHECK_EQ(cache.size(), std::size_t{5});
  CHECK_EQ(cache.weight(), std::size_t{35});
  CHECK_EQ(cache.stats().evictions, std::uint64_t{3});
}

TEST(test_timed_out_entry_is_not_returned) {
  lru::ManualClock clock;
  Cache cache(with_capacity(100), &clock);
  cache.put_with_ttl(1, "alpha", 10, 50);
  CHECK(cache.get(1).has_value());
  clock.advance(60);
  CHECK(!cache.get(1).has_value());
  CHECK(!cache.contains(1));
  CHECK_EQ(cache.size(), std::size_t{0});
  CHECK_EQ(cache.weight(), std::size_t{0});
  CHECK_EQ(cache.stats().expirations, std::uint64_t{1});
}

TEST(test_entry_without_a_lifetime_never_times_out) {
  lru::ManualClock clock;
  Cache cache(with_capacity(100), &clock);
  cache.put_with_ttl(1, "alpha", 10, 0);
  clock.advance(1000000);
  CHECK(cache.contains(1));
  CHECK_EQ(cache.purge_expired(), std::size_t{0});
  CHECK_EQ(cache.size(), std::size_t{1});
}

TEST(test_purge_drops_the_coldest_timed_out_entry) {
  lru::ManualClock clock;
  Cache cache(with_capacity(100), &clock);
  cache.put_with_ttl(1, "alpha", 10, 50);
  cache.put_with_ttl(2, "beta", 10, 0);
  clock.advance(60);
  CHECK_EQ(cache.purge_expired(), std::size_t{1});
  CHECK_EQ(cache.size(), std::size_t{1});
  CHECK(cache.contains(2));
  CHECK_EQ(cache.weight(), std::size_t{10});
}

TEST(test_purge_accounts_for_every_timed_out_entry) {
  lru::ManualClock clock;
  Cache cache(with_capacity(100), &clock);
  cache.put_with_ttl(1, "alpha", 10, 50);
  cache.put_with_ttl(2, "beta", 10, 0);
  cache.put_with_ttl(3, "gamma", 10, 50);
  clock.advance(60);
  CHECK_EQ(cache.purge_expired(), std::size_t{2});
  CHECK_EQ(cache.size(), std::size_t{1});
  CHECK_EQ(cache.weight(), std::size_t{10});
  CHECK(cache.contains(2));
  CHECK(!cache.contains(1));
  CHECK(!cache.contains(3));
}

TEST(test_timed_out_entry_yields_capacity_before_a_live_one) {
  lru::ManualClock clock;
  Cache cache(with_capacity(20), &clock);
  cache.put_with_ttl(1, "alpha", 10, 50);
  cache.put_with_ttl(2, "beta", 10, 0);
  CHECK(cache.get(1).has_value());
  clock.advance(100);
  cache.put_with_ttl(3, "gamma", 10, 0);
  CHECK(cache.contains(2));
  CHECK(cache.contains(3));
  CHECK(!cache.contains(1));
  CHECK_EQ(cache.size(), std::size_t{2});
  CHECK_EQ(cache.weight(), std::size_t{20});
  CHECK_EQ(cache.stats().evictions, std::uint64_t{0});
  CHECK_EQ(cache.stats().expirations, std::uint64_t{1});
}

TEST(test_resident_weight_matches_entries_after_repeated_writes) {
  Cache cache(with_capacity(1000));
  cache.put(1, "alpha", 8);
  cache.put(2, "beta", 8);
  CHECK_EQ(cache.weight(), std::size_t{16});
  for (int round = 0; round < 4; ++round) {
    cache.put(1, "alpha-rewritten", 8);
  }
  CHECK_EQ(cache.size(), std::size_t{2});
  CHECK_EQ(cache.weight(), std::size_t{16});
  cache.put(1, "alpha-grown", 12);
  CHECK_EQ(cache.size(), std::size_t{2});
  CHECK_EQ(cache.weight(), std::size_t{20});
}

TEST(test_rewriting_one_key_leaves_the_other_entries_resident) {
  Cache cache(with_capacity(40));
  cache.put(1, "alpha", 10);
  cache.put(2, "beta", 10);
  cache.put(3, "gamma", 10);
  cache.put(4, "delta", 10);
  CHECK_EQ(cache.weight(), std::size_t{40});
  for (int round = 0; round < 10; ++round) {
    cache.put(4, "delta-rewritten", 10);
  }
  CHECK_EQ(cache.size(), std::size_t{4});
  CHECK_EQ(cache.weight(), std::size_t{40});
  CHECK(cache.contains(1));
  CHECK(cache.contains(2));
  CHECK(cache.contains(3));
  CHECK(cache.contains(4));
  CHECK_EQ(cache.stats().evictions, std::uint64_t{0});
}
