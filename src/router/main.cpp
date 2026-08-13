#include <iostream>

#include "version.hpp"

// Task 11.1 scaffold entry point. The real CLI (config load, server start,
// supervisor loop) lands in Tasks 11.2-11.7; for now main proves the target
// links and runs.
int main() {
  std::cout << "conductor llama-router " << conductor::router::router_version()
            << " (scaffold)\n";
  return 0;
}
