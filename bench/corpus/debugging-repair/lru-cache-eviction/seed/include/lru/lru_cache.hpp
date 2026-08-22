// Weight-bounded LRU cache with per-entry time-to-live.
//
// Layout
// ------
// Entries live in heap-allocated nodes owned by an open-addressed slot table
// (linear probing, power-of-two slot count, tombstones on erase). Every node is
// also a member of one intrusive doubly linked list ordered by recency, newest
// first. The table answers "where is key K", the list answers "what is the
// coldest entry".
//
// Node addresses are stable for the lifetime of an entry, so the list may hold
// raw pointers into the table. Slot indices are not stable: rehashing moves
// entries between slots and rewrites Node::slot.
//
// Bounds
// ------
// Occupancy is measured in caller-supplied weight, not entry count. An insert
// that would push the total past CacheConfig::weight_capacity reclaims space
// first: timed-out entries are dropped, then the coldest entries are evicted
// until the incoming entry fits. An entry heavier than the whole capacity is
// rejected outright.
//
// Threading
// ---------
// Not thread-safe. One cache, one thread, or wrap it yourself.
#ifndef LRU_LRU_CACHE_HPP
#define LRU_LRU_CACHE_HPP

#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "lru/clock.hpp"
#include "lru/stats.hpp"

namespace lru {

struct CacheConfig {
  // Maximum total weight of resident entries.
  std::size_t weight_capacity = 1024;
  // Applied by put() when the caller does not give an explicit TTL.
  // Zero means "never expires".
  Millis default_ttl_ms = 0;
  // Initial slot count. Rounded up to a power of two, minimum 8.
  std::size_t initial_slots = 16;
  // Table grows when (entries + tombstones + 1) exceeds this share of slots.
  double max_load_factor = 0.7;
};

template <class Key,
          class Value,
          class Hash = std::hash<Key>,
          class KeyEqual = std::equal_to<Key>>
class LruCache {
 public:
  using key_type = Key;
  using mapped_type = Value;

  explicit LruCache(CacheConfig config = CacheConfig(),
                    const Clock* clock = &system_clock());

  LruCache(const LruCache& other);
  LruCache(LruCache&& other) noexcept;
  LruCache& operator=(const LruCache& other);
  LruCache& operator=(LruCache&& other) noexcept;
  ~LruCache();

  // Inserts key, or replaces the value/weight/TTL of an existing key and marks
  // it as most recently used. Returns true when a new entry was created.
  // Applies CacheConfig::default_ttl_ms.
  bool put(const Key& key, Value value, std::size_t weight = 1);

  // As put(), with an explicit lifetime. ttl_ms == 0 means "never expires".
  bool put_with_ttl(const Key& key, Value value, std::size_t weight, Millis ttl_ms);

  // Returns the value and marks the entry as most recently used. A timed-out
  // entry is dropped and reported as a miss.
  std::optional<Value> get(const Key& key);

  // Reads without touching recency. Returns nullptr for absent or timed-out
  // entries. Does not update hit/miss counters.
  const Value* peek(const Key& key) const;

  // True when the key is resident and has not timed out.
  bool contains(const Key& key) const;

  // Drops the entry if present. Returns true when something was removed.
  bool erase(const Key& key);

  // Drops every entry whose lifetime has elapsed. Returns how many went.
  std::size_t purge_expired();

  // Drops every entry. Keeps configuration, slot count and statistics.
  void clear();

  std::size_t size() const noexcept { return entry_count_; }
  std::size_t weight() const noexcept { return total_weight_; }
  std::size_t weight_capacity() const noexcept { return config_.weight_capacity; }
  std::size_t slot_count() const noexcept { return slots_.size(); }
  bool empty() const noexcept { return entry_count_ == 0; }

  const CacheConfig& config() const noexcept { return config_; }
  const CacheStats& stats() const noexcept { return stats_; }
  void reset_stats() noexcept { stats_.reset(); }

  // Resident keys, most recently used first. Includes entries that have timed
  // out but have not been reclaimed yet.
  std::vector<Key> keys_mru_first() const;

  void swap(LruCache& other) noexcept;

 private:
  static constexpr Millis kNever = std::numeric_limits<Millis>::max();
  static constexpr std::size_t npos = static_cast<std::size_t>(-1);

  enum class SlotState : std::uint8_t { kEmpty = 0, kOccupied = 1, kTombstone = 2 };

  struct Node {
    Node(const Key& k, Value&& v, std::size_t w, Millis exp, std::uint64_t h)
        : key(k), value(std::move(v)), weight(w), expires_at(exp), hash(h) {}

    Key key;
    Value value;
    std::size_t weight = 0;
    Millis expires_at = kNever;
    std::uint64_t hash = 0;
    std::size_t slot = npos;
    Node* newer = nullptr;
    Node* older = nullptr;
  };

  struct Slot {
    SlotState state = SlotState::kEmpty;
    std::unique_ptr<Node> node;
  };

  // --- hashing / probing -----------------------------------------------
  static std::uint64_t mix(std::uint64_t x) noexcept;
  std::uint64_t hash_key(const Key& key) const;
  std::size_t bucket_index(std::uint64_t h) const noexcept;
  std::size_t next_index(std::size_t index) const noexcept;
  std::size_t find_occupied(const Key& key, std::uint64_t h, std::size_t start) const;
  std::size_t free_slot_for(std::size_t start) const;
  bool should_grow() const noexcept;
  void rehash(std::size_t new_slot_count);
  static std::size_t round_up_slots(std::size_t requested) noexcept;

  // --- recency list -----------------------------------------------------
  void link_newest(Node* node) noexcept;
  void unlink(Node* node) noexcept;
  void promote(Node* node) noexcept;

  // --- lifetime ---------------------------------------------------------
  bool is_expired(const Node* node, Millis now) const noexcept;
  void remove_node(Node* node);
  std::size_t drop_expired(Millis now);
  void make_room(std::size_t incoming_weight, Millis now);
  void copy_entries_from(const LruCache& other);

  CacheConfig config_;
  const Clock* clock_;
  Hash hasher_;
  KeyEqual equal_;
  std::vector<Slot> slots_;
  std::size_t mask_ = 0;
  std::size_t entry_count_ = 0;
  std::size_t tombstones_ = 0;
  std::size_t total_weight_ = 0;
  Node* newest_ = nullptr;
  Node* oldest_ = nullptr;
  CacheStats stats_;
};

// ======================================================================
// construction
// ======================================================================

template <class Key, class Value, class Hash, class KeyEqual>
LruCache<Key, Value, Hash, KeyEqual>::LruCache(CacheConfig config, const Clock* clock)
    : config_(config),
      clock_(clock != nullptr ? clock : &system_clock()),
      slots_(round_up_slots(config.initial_slots)) {
  mask_ = slots_.size() - 1;
  if (!(config_.max_load_factor > 0.05) || !(config_.max_load_factor < 0.95)) {
    config_.max_load_factor = 0.7;
  }
}

template <class Key, class Value, class Hash, class KeyEqual>
LruCache<Key, Value, Hash, KeyEqual>::LruCache(const LruCache& other)
    : config_(other.config_),
      clock_(other.clock_),
      hasher_(other.hasher_),
      equal_(other.equal_),
      slots_(other.slots_.size()) {
  mask_ = slots_.size() - 1;
  copy_entries_from(other);
}

template <class Key, class Value, class Hash, class KeyEqual>
LruCache<Key, Value, Hash, KeyEqual>::LruCache(LruCache&& other) noexcept
    : config_(other.config_),
      clock_(other.clock_),
      hasher_(std::move(other.hasher_)),
      equal_(std::move(other.equal_)),
      slots_(std::move(other.slots_)),
      mask_(other.mask_),
      entry_count_(other.entry_count_),
      tombstones_(other.tombstones_),
      total_weight_(other.total_weight_),
      newest_(other.newest_),
      oldest_(other.oldest_),
      stats_(other.stats_) {
  other.slots_ = std::vector<Slot>(round_up_slots(other.config_.initial_slots));
  other.mask_ = other.slots_.size() - 1;
  other.entry_count_ = 0;
  other.tombstones_ = 0;
  other.total_weight_ = 0;
  other.newest_ = nullptr;
  other.oldest_ = nullptr;
}

template <class Key, class Value, class Hash, class KeyEqual>
LruCache<Key, Value, Hash, KeyEqual>&
LruCache<Key, Value, Hash, KeyEqual>::operator=(const LruCache& other) {
  clear();
  config_ = other.config_;
  clock_ = other.clock_;
  hasher_ = other.hasher_;
  equal_ = other.equal_;
  slots_ = std::vector<Slot>(other.slots_.size());
  mask_ = slots_.size() - 1;
  copy_entries_from(other);
  return *this;
}

template <class Key, class Value, class Hash, class KeyEqual>
LruCache<Key, Value, Hash, KeyEqual>&
LruCache<Key, Value, Hash, KeyEqual>::operator=(LruCache&& other) noexcept {
  swap(other);
  return *this;
}

template <class Key, class Value, class Hash, class KeyEqual>
LruCache<Key, Value, Hash, KeyEqual>::~LruCache() {
  clear();
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::swap(LruCache& other) noexcept {
  std::swap(config_, other.config_);
  std::swap(clock_, other.clock_);
  std::swap(hasher_, other.hasher_);
  std::swap(equal_, other.equal_);
  slots_.swap(other.slots_);
  std::swap(mask_, other.mask_);
  std::swap(entry_count_, other.entry_count_);
  std::swap(tombstones_, other.tombstones_);
  std::swap(total_weight_, other.total_weight_);
  std::swap(newest_, other.newest_);
  std::swap(oldest_, other.oldest_);
  std::swap(stats_, other.stats_);
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::copy_entries_from(const LruCache& other) {
  for (const Node* source = other.oldest_; source != nullptr; source = source->newer) {
    Value value(source->value);
    auto node = std::make_unique<Node>(source->key, std::move(value), source->weight,
                                       source->expires_at, source->hash);
    const std::size_t target = free_slot_for(bucket_index(source->hash));
    node->slot = target;
    Node* raw = node.get();
    slots_[target].state = SlotState::kOccupied;
    slots_[target].node = std::move(node);
    ++entry_count_;
    total_weight_ += raw->weight;
    link_newest(raw);
  }
  stats_ = other.stats_;
}

// ======================================================================
// hashing and probing
// ======================================================================

template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::round_up_slots(
    std::size_t requested) noexcept {
  std::size_t slots = 8;
  while (slots < requested) {
    slots *= 2;
  }
  return slots;
}

// splitmix64 finaliser. std::hash is the identity for integral keys on the
// implementations we build against, which clusters badly under linear probing.
template <class Key, class Value, class Hash, class KeyEqual>
std::uint64_t LruCache<Key, Value, Hash, KeyEqual>::mix(std::uint64_t x) noexcept {
  x ^= x >> 30;
  x *= 0xbf58476d1ce4e5b9ULL;
  x ^= x >> 27;
  x *= 0x94d049bb133111ebULL;
  x ^= x >> 31;
  return x;
}

template <class Key, class Value, class Hash, class KeyEqual>
std::uint64_t LruCache<Key, Value, Hash, KeyEqual>::hash_key(const Key& key) const {
  return mix(static_cast<std::uint64_t>(hasher_(key)));
}

template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::bucket_index(
    std::uint64_t h) const noexcept {
  return static_cast<std::size_t>(h) & mask_;
}

template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::next_index(
    std::size_t index) const noexcept {
  return (index + 1) & mask_;
}

// Walks the probe chain that starts at `start`. A kEmpty slot terminates the
// chain; tombstones do not, since a live entry may sit past one.
template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::find_occupied(
    const Key& key, std::uint64_t h, std::size_t start) const {
  std::size_t index = start;
  for (std::size_t probe = 0; probe <= mask_; ++probe) {
    const Slot& slot = slots_[index];
    if (slot.state == SlotState::kEmpty) {
      return npos;
    }
    if (slot.state == SlotState::kOccupied && slot.node->hash == h &&
        equal_(slot.node->key, key)) {
      return index;
    }
    index = next_index(index);
  }
  return npos;
}

// First slot at or after `start` that can hold a new entry. Tombstones are
// reusable. The load factor guarantees at least one such slot exists.
template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::free_slot_for(std::size_t start) const {
  std::size_t index = start;
  while (slots_[index].state == SlotState::kOccupied) {
    index = next_index(index);
  }
  return index;
}

template <class Key, class Value, class Hash, class KeyEqual>
bool LruCache<Key, Value, Hash, KeyEqual>::should_grow() const noexcept {
  const double occupied = static_cast<double>(entry_count_ + tombstones_ + 1);
  return occupied > static_cast<double>(slots_.size()) * config_.max_load_factor;
}

// Moves every live entry into a fresh table and forgets the tombstones. Nodes
// are not reallocated, so the recency list is unaffected; only Node::slot and
// the slot indices change.
template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::rehash(std::size_t new_slot_count) {
  const std::size_t count = round_up_slots(new_slot_count);
  std::vector<Slot> fresh(count);
  const std::size_t new_mask = count - 1;

  for (Slot& slot : slots_) {
    if (slot.state != SlotState::kOccupied) {
      continue;
    }
    std::size_t index = static_cast<std::size_t>(slot.node->hash) & new_mask;
    while (fresh[index].state == SlotState::kOccupied) {
      index = (index + 1) & new_mask;
    }
    slot.node->slot = index;
    fresh[index].state = SlotState::kOccupied;
    fresh[index].node = std::move(slot.node);
  }

  slots_ = std::move(fresh);
  mask_ = new_mask;
  tombstones_ = 0;
}

// ======================================================================
// recency list
// ======================================================================

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::link_newest(Node* node) noexcept {
  node->newer = nullptr;
  node->older = newest_;
  if (newest_ != nullptr) {
    newest_->newer = node;
  }
  newest_ = node;
  if (oldest_ == nullptr) {
    oldest_ = node;
  }
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::unlink(Node* node) noexcept {
  if (node->newer != nullptr) {
    node->newer->older = node->older;
  } else {
    newest_ = node->older;
  }
  if (node->older != nullptr) {
    node->older->newer = node->newer;
  } else {
    oldest_ = node->newer;
  }
  node->newer = nullptr;
  node->older = nullptr;
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::promote(Node* node) noexcept {
  if (node == newest_) {
    return;
  }
  unlink(node);
  link_newest(node);
}

// ======================================================================
// lifetime and reclamation
// ======================================================================

template <class Key, class Value, class Hash, class KeyEqual>
bool LruCache<Key, Value, Hash, KeyEqual>::is_expired(const Node* node,
                                                      Millis now) const noexcept {
  return node->expires_at != kNever && node->expires_at <= now;
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::remove_node(Node* node) {
  const std::size_t index = node->slot;
  unlink(node);
  total_weight_ -= node->weight;
  --entry_count_;
  slots_[index].state = SlotState::kTombstone;
  slots_[index].node.reset();
  ++tombstones_;
}

// Reclaims timed-out entries from the cold end of the recency list. Returns
// how many entries were released.
template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::drop_expired(Millis now) {
  std::size_t removed = 0;
  while (oldest_ != nullptr && is_expired(oldest_, now)) {
    remove_node(oldest_);
    ++stats_.expirations;
    ++removed;
  }
  return removed;
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::make_room(std::size_t incoming_weight,
                                                     Millis now) {
  if (total_weight_ + incoming_weight <= config_.weight_capacity) {
    return;
  }
  drop_expired(now);
  while (total_weight_ + incoming_weight > config_.weight_capacity &&
         oldest_ != nullptr) {
    remove_node(oldest_);
    ++stats_.evictions;
  }
}

// ======================================================================
// public operations
// ======================================================================

template <class Key, class Value, class Hash, class KeyEqual>
bool LruCache<Key, Value, Hash, KeyEqual>::put(const Key& key, Value value,
                                               std::size_t weight) {
  return put_with_ttl(key, std::move(value), weight, config_.default_ttl_ms);
}

template <class Key, class Value, class Hash, class KeyEqual>
bool LruCache<Key, Value, Hash, KeyEqual>::put_with_ttl(const Key& key, Value value,
                                                        std::size_t weight,
                                                        Millis ttl_ms) {
  const Millis now = clock_->now_ms();
  const std::uint64_t h = hash_key(key);
  const std::size_t home = bucket_index(h);
  const Millis expires_at = (ttl_ms == 0) ? kNever : now + ttl_ms;

  const std::size_t existing = find_occupied(key, h, home);
  if (existing != npos) {
    Node* node = slots_[existing].node.get();
    node->value = std::move(value);
    node->expires_at = expires_at;
    total_weight_ += weight;
    node->weight = weight;
    promote(node);
    ++stats_.updates;
    make_room(0, now);
    return false;
  }

  if (weight > config_.weight_capacity) {
    ++stats_.rejections;
    return false;
  }

  make_room(weight, now);
  if (should_grow()) {
    // A table that is mostly tombstones needs cleaning, not enlarging: an
    // eviction-heavy workload would otherwise grow the table without bound.
    const std::size_t wanted = (entry_count_ + 1) * 2;
    rehash(wanted > slots_.size() ? slots_.size() * 2 : slots_.size());
  }

  auto node = std::make_unique<Node>(key, std::move(value), weight, expires_at, h);
  const std::size_t target = free_slot_for(home);
  node->slot = target;
  Node* raw = node.get();
  slots_[target].state = SlotState::kOccupied;
  slots_[target].node = std::move(node);
  ++entry_count_;
  total_weight_ += weight;
  link_newest(raw);
  ++stats_.insertions;
  return true;
}

template <class Key, class Value, class Hash, class KeyEqual>
std::optional<Value> LruCache<Key, Value, Hash, KeyEqual>::get(const Key& key) {
  const Millis now = clock_->now_ms();
  const std::uint64_t h = hash_key(key);
  const std::size_t index = find_occupied(key, h, bucket_index(h));
  if (index == npos) {
    ++stats_.misses;
    return std::nullopt;
  }

  Node* node = slots_[index].node.get();
  if (is_expired(node, now)) {
    remove_node(node);
    ++stats_.expirations;
    ++stats_.misses;
    return std::nullopt;
  }

  promote(node);
  ++stats_.hits;
  return node->value;
}

template <class Key, class Value, class Hash, class KeyEqual>
const Value* LruCache<Key, Value, Hash, KeyEqual>::peek(const Key& key) const {
  const std::uint64_t h = hash_key(key);
  const std::size_t index = find_occupied(key, h, bucket_index(h));
  if (index == npos) {
    return nullptr;
  }
  const Node* node = slots_[index].node.get();
  if (is_expired(node, clock_->now_ms())) {
    return nullptr;
  }
  return &node->value;
}

template <class Key, class Value, class Hash, class KeyEqual>
bool LruCache<Key, Value, Hash, KeyEqual>::contains(const Key& key) const {
  return peek(key) != nullptr;
}

template <class Key, class Value, class Hash, class KeyEqual>
bool LruCache<Key, Value, Hash, KeyEqual>::erase(const Key& key) {
  const std::uint64_t h = hash_key(key);
  const std::size_t index = find_occupied(key, h, bucket_index(h));
  if (index == npos) {
    return false;
  }
  remove_node(slots_[index].node.get());
  return true;
}

template <class Key, class Value, class Hash, class KeyEqual>
std::size_t LruCache<Key, Value, Hash, KeyEqual>::purge_expired() {
  return drop_expired(clock_->now_ms());
}

template <class Key, class Value, class Hash, class KeyEqual>
void LruCache<Key, Value, Hash, KeyEqual>::clear() {
  for (Slot& slot : slots_) {
    slot.state = SlotState::kEmpty;
    slot.node.reset();
  }
  entry_count_ = 0;
  tombstones_ = 0;
  total_weight_ = 0;
  newest_ = nullptr;
  oldest_ = nullptr;
}

template <class Key, class Value, class Hash, class KeyEqual>
std::vector<Key> LruCache<Key, Value, Hash, KeyEqual>::keys_mru_first() const {
  std::vector<Key> keys;
  keys.reserve(entry_count_);
  for (const Node* node = newest_; node != nullptr; node = node->older) {
    keys.push_back(node->key);
  }
  return keys;
}

template <class Key, class Value, class Hash, class KeyEqual>
void swap(LruCache<Key, Value, Hash, KeyEqual>& lhs,
          LruCache<Key, Value, Hash, KeyEqual>& rhs) noexcept {
  lhs.swap(rhs);
}

}  // namespace lru

#endif  // LRU_LRU_CACHE_HPP
