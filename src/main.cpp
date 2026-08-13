// =============================================================================
// Task 11.8 — llama-router entry point: a thin adapter over the pure CLI parse.
//
// Everything decidable without a socket lives in router/cli.hpp's parseCli,
// which is what makes it doctest-reachable (src/tests/cli_test.cpp); this file
// only maps verdicts onto the C-041 / SG-I exit codes:
//   0  clean shutdown after SIGINT/SIGTERM (Router::stop() ran), and the
//      --help / --version paths;
//   2  usage error — stderr carries the parse error naming the offending or
//      missing flag, then the usage text;
//   3  ConfigError — stderr carries ConfigError::field() verbatim (what()
//      contains it structurally); an unreadable config file lands here too,
//      named by path;
//   4  listen bind failure — stderr carries host:port (Router::start()'s
//      runtime_error message names both).
//
// Signal handling is minimal and async-signal-safe: the handler only sets a
// volatile sig_atomic_t flag, and the main thread observes it and calls
// Router::stop() itself — nothing allocating runs inside the handler.
// =============================================================================

#include <chrono>
#include <csignal>
#include <cstddef>
#include <exception>
#include <fstream>
#include <iterator>
#include <print>
#include <span>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "router/cli.hpp"
#include "router/config.hpp"
#include "router/router.hpp"
#include "router/version.hpp"

namespace {

    volatile std::sig_atomic_t g_signalCaught = 0;

    void handleSignal(int /*signum*/) {
        g_signalCaught = 1;
    }

}  // namespace

int main(int argc, char** argv) {
    std::vector<std::string_view> args;
    args.reserve(argc > 0 ? static_cast<std::size_t>(argc - 1) : 0);
    for (int i = 1; i < argc; ++i)
        args.emplace_back(argv[i]);

    const conductor::router::CliParse verdict =
        conductor::router::parseCli(std::span<const std::string_view>(args.data(), args.size()));

    if (!verdict.options.has_value()) {
        std::println(stderr, "{}", verdict.error);
        std::print(stderr, "{}", verdict.usage);
        return 2;
    }

    if (verdict.options->showHelp) {
        std::print("{}", verdict.usage);
        return 0;
    }

    if (verdict.options->showVersion) {
        std::println("llama-router {}", conductor::router::router_version());
        return 0;
    }

    std::string configText;
    {
        std::ifstream in(verdict.options->configPath, std::ios::binary);
        if (!in.is_open()) {
            std::println(stderr, "llama-router: cannot read router config file: {}",
                         verdict.options->configPath);
            return 3;
        }

        configText.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }

    conductor::router::RouterConfig config;
    try {
        config = conductor::router::parseRouterConfig(configText, verdict.options->schemaPath);
        conductor::router::applyLoggingLevel(config);
    } catch (const conductor::router::ConfigError& failure) {
        // what() contains field() verbatim by ConfigError's own invariant.
        std::println(stderr, "llama-router: {}", failure.what());
        return 3;
    }

    conductor::router::Router router{ config };

    // Installed before start() so a Ctrl-C from the first moment the process
    // is observable runs the clean-shutdown path rather than the default kill.
    std::signal(SIGINT, handleSignal);
    std::signal(SIGTERM, handleSignal);

    try {
        router.start();
    } catch (const std::exception& failure) {
        // Router::start()'s bind failure names host:port in its message.
        std::println(stderr, "llama-router: {}", failure.what());
        return 4;
    }

    // start() returns once the listener accepts, so main parks here; the
    // handler only sets the flag, and stop() runs on this thread.
    while (g_signalCaught == 0)
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

    router.stop();
    return 0;
}
