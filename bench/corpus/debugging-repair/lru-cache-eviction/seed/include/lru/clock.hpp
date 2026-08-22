// Time source used by the cache for TTL bookkeeping.
//
// The cache never calls a global clock directly: every entry point takes its
// reading from the Clock it was constructed with. Production code uses
// system_clock(); tests drive ManualClock so that expiry is reproducible.
#ifndef LRU_CLOCK_HPP
#define LRU_CLOCK_HPP

#include <cstdint>

namespace lru {

// Milliseconds since an unspecified but monotonic epoch.
using Millis = std::uint64_t;

class Clock {
 public:
  Clock() = default;
  Clock(const Clock&) = default;
  Clock(Clock&&) = default;
  Clock& operator=(const Clock&) = default;
  Clock& operator=(Clock&&) = default;
  virtual ~Clock();

  virtual Millis now_ms() const = 0;
};

// Monotonic wall clock, backed by std::chrono::steady_clock.
class SystemClock final : public Clock {
 public:
  Millis now_ms() const override;
};

// Process-wide SystemClock instance. Safe to take the address of; it outlives
// every cache built against it.
const Clock& system_clock();

// Clock whose reading only changes when a test moves it.
class ManualClock final : public Clock {
 public:
  ManualClock() = default;
  explicit ManualClock(Millis start) : now_(start) {}

  Millis now_ms() const override { return now_; }

  void advance(Millis delta) { now_ += delta; }
  void set(Millis value) { now_ = value; }

 private:
  Millis now_ = 0;
};

}  // namespace lru

#endif  // LRU_CLOCK_HPP
