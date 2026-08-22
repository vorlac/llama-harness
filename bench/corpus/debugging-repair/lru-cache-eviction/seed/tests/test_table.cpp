// Slot table behaviour under growth, and the cache's value semantics.
#include <string>
#include <vector>

#include "harness.hpp"
#include "lru/lru_cache.hpp"

namespace {

using Cache = lru::LruCache<int, std::string>;

// Big enough that nothing is ever evicted: these tests are about the table,
// not about capacity pressure.
lru::CacheConfig unbounded() {
  lru::CacheConfig config;
  config.weight_capacity = 100000;
  config.initial_slots = 16;
  return config;
}

std::string payload(int key) { return "value-" + std::to_string(key); }

}  // namespace

TEST(test_small_working_set_is_fully_readable) {
  Cache cache(unbounded());
  for (int key = 1; key <= 8; ++key) {
    cache.put(key, payload(key), 1);
  }
  CHECK_EQ(cache.size(), std::size_t{8});
  for (int key = 1; key <= 8; ++key) {
    CHECK_EQ(cache.get(key).value_or("<absent>"), payload(key));
  }
}

TEST(test_erased_keys_do_not_block_later_lookups) {
  Cache cache(unbounded());
  for (int key = 1; key <= 6; ++key) {
    cache.put(key, payload(key), 1);
  }
  CHECK(cache.erase(3));
  CHECK(cache.erase(4));
  cache.put(3, "back", 1);
  CHECK_EQ(cache.get(3).value_or("<absent>"), std::string("back"));
  CHECK(!cache.contains(4));
  CHECK_EQ(cache.get(6).value_or("<absent>"), payload(6));
  CHECK_EQ(cache.size(), std::size_t{5});
}

TEST(test_copy_constructed_cache_is_independent_of_its_source) {
  Cache cache(unbounded());
  cache.put(1, "alpha", 3);
  cache.put(2, "beta", 3);
  cache.put(3, "gamma", 3);

  Cache copy(cache);
  CHECK_EQ(copy.size(), std::size_t{3});
  CHECK_EQ(copy.weight(), std::size_t{9});
  CHECK_EQ(copy.keys_mru_first(), cache.keys_mru_first());

  copy.erase(2);
  copy.put(4, "delta", 3);
  CHECK_EQ(cache.size(), std::size_t{3});
  CHECK(cache.contains(2));
  CHECK(!cache.contains(4));
  CHECK_EQ(copy.get(1).value_or("<absent>"), std::string("alpha"));
}

TEST(test_copy_assignment_replaces_the_destination_contents) {
  Cache source(unbounded());
  source.put(1, "alpha", 3);
  source.put(2, "beta", 3);

  Cache destination(unbounded());
  destination.put(9, "stale", 5);
  destination.put(8, "older", 5);

  destination = source;
  CHECK_EQ(destination.size(), std::size_t{2});
  CHECK_EQ(destination.weight(), std::size_t{6});
  CHECK(destination.contains(1));
  CHECK(destination.contains(2));
  CHECK(!destination.contains(8));
  CHECK(!destination.contains(9));
}

TEST(test_move_assignment_hands_the_entries_over) {
  Cache source(unbounded());
  source.put(1, "alpha", 3);
  source.put(2, "beta", 3);

  Cache destination(unbounded());
  destination.put(9, "stale", 5);

  destination = std::move(source);
  CHECK_EQ(destination.size(), std::size_t{2});
  CHECK_EQ(destination.weight(), std::size_t{6});
  CHECK_EQ(destination.get(1).value_or("<absent>"), std::string("alpha"));
  CHECK(!destination.contains(9));
}

TEST(test_moved_construction_leaves_a_usable_source) {
  Cache source(unbounded());
  source.put(1, "alpha", 3);
  source.put(2, "beta", 3);

  Cache destination(std::move(source));
  CHECK_EQ(destination.size(), std::size_t{2});

  source.put(5, "fresh", 1);
  CHECK_EQ(source.size(), std::size_t{1});
  CHECK_EQ(source.get(5).value_or("<absent>"), std::string("fresh"));
}
