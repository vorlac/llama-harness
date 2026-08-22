#include "lru/clock.hpp"

#include <chrono>

namespace lru {

Clock::~Clock() = default;

Millis SystemClock::now_ms() const {
  const auto tp = std::chrono::steady_clock::now().time_since_epoch();
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(tp).count();
  return static_cast<Millis>(ms);
}

const Clock& system_clock() {
  static const SystemClock instance;
  return instance;
}

}  // namespace lru
