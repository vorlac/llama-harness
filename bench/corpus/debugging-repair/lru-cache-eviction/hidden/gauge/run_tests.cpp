#include "harness.hpp"

// Usage: lru_tests [name-substring]
int main(int argc, char** argv) {
  const char* filter = (argc > 1) ? argv[1] : "";
  return harness::run_all(filter) == 0 ? 0 : 1;
}
