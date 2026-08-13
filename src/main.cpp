#include <print>

#include "version.hpp"

// Task 11.1 scaffold entry point for the conductor llama-router. The real CLI
// (config load, server start, supervisor loop) lands in Tasks 11.2-11.7; for now
// main proves the target links and runs. "version.hpp" resolves via the target's
// src/router include directory (where the router headers live).
int main() {
    std::println("conductor llama-router {} (scaffold)",
                 conductor::router::router_version());

    return 0;
}
