// =============================================================================
// Task 11.8 — llama-router CLI: the pure argument parse behind router/main.cpp.
//
// The surface below is pinned by docs/build/CORRECTIONS.md C-041 and by spec row
// 11.8-cli-contract (docs/build/specs/task-11.8.assertions.json, resolutions
// SG-A / SG-B / SG-I); the cases in this file assert it name by name.
//
// THE TARGET SURFACE (HEADER-ONLY, matching config.hpp / router.hpp /
// admission.hpp / affinity.hpp):
//
//   // router/cli.hpp
//   #pragma once
//
//   #include <optional>
//   #include <span>
//   #include <string>
//   #include <string_view>
//
//   namespace conductor::router {
//
//   struct CliOptions {
//       std::string configPath;     // value of the REQUIRED --config <path>
//       std::string schemaPath;     // value of the REQUIRED --schema <path>
//                                   // (SG-B: no default, no search path)
//       bool showHelp{ false };     // --help, accepted alone
//       bool showVersion{ false };  // --version, accepted alone
//   };
//
//   struct CliParse {
//       std::optional<CliOptions> options;  // engaged iff the parse succeeded
//       std::string error;  // empty on success; a refusal NAMES the offending
//                           // or missing flag, or quotes the offending token
//                           // verbatim
//       std::string usage;  // non-empty on every refusal (and rides along on
//                           // --help, whose only consumer is main printing
//                           // it); names both required flags
//   };
//
//   // PURE function of its argument span, which EXCLUDES argv[0]: no
//   // filesystem access, no getenv, no globals — the same argument vector
//   // yields the same CliParse every call. Neither path is opened or checked
//   // for existence here; that happens in main, after the parse.
//   [[nodiscard]] CliParse parseCli(std::span<const std::string_view> args);
//
//   }  // namespace conductor::router
//
// THE ADAPTER SEAM (router/main.cpp, NOT exercised by this suite): main maps a
// refusal here to the pinned exit code 2 — stderr carries the error naming the
// flag, then the usage text. The exit-0/3/4 family (clean signal shutdown,
// ConfigError with field() verbatim, bind failure with host:port) involves the
// filesystem, parseRouterConfig and a live socket, and is recorded by the 11.8
// live-smoke artifact, not by doctests — SG-I pins that split.
//
// cli.hpp is header-only and needs no source-list entry.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
// =============================================================================

#include <doctest/doctest.h>

#include <initializer_list>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "router/cli.hpp"

namespace {

    using conductor::router::CliParse;

    // Paths handed to --config / --schema throughout. Deliberately paths where
    // no file lives: the parse is pure and must never open, stat or otherwise
    // notice the filesystem, so a nonexistent path parses exactly like a real
    // one. (The real invocation passes .data/configs/conductor-router.json and
    // router/tests/schemas/RouterConfig.schema.json; the parse cannot tell.)
    constexpr std::string_view kConfigPath = "no/such/dir/conductor-router.json";
    constexpr std::string_view kSchemaPath = "no/such/dir/RouterConfig.schema.json";

    CliParse parse(std::initializer_list<std::string_view> args) {
        const std::vector<std::string_view> argv(args);
        return conductor::router::parseCli(std::span<const std::string_view>(argv.data(), argv.size()));
    }

    bool mentions(std::string_view haystack, std::string_view needle) {
        return haystack.find(needle) != std::string_view::npos;
    }

    // A refusal is only useful if it says WHAT was wrong: disengaged options, an
    // error naming the offending or missing token, and a usage text naming both
    // required flags so the operator can repair the invocation without reading
    // the source. Exit code 2's stderr is exactly `error` then `usage`.
    void checkRefusalNames(const CliParse& verdict, std::string_view offendingToken) {
        INFO("error='", verdict.error, "' usage='", verdict.usage, "'");
        CHECK_FALSE(verdict.options.has_value());
        REQUIRE_FALSE(verdict.error.empty());
        CHECK(mentions(verdict.error, offendingToken));
        REQUIRE_FALSE(verdict.usage.empty());
        CHECK(mentions(verdict.usage, "--config"));
        CHECK(mentions(verdict.usage, "--schema"));
    }

}  // namespace

TEST_CASE(
    "[11.8-cli-contract] --config and --schema together yield engaged options carrying both "
    "paths, in either flag order") {
    SUBCASE("--config first") {
        const CliParse verdict = parse({ "--config", kConfigPath, "--schema", kSchemaPath });
        INFO("error='", verdict.error, "'");
        REQUIRE(verdict.options.has_value());
        CHECK(verdict.options->configPath == kConfigPath);
        CHECK(verdict.options->schemaPath == kSchemaPath);
        CHECK_FALSE(verdict.options->showHelp);
        CHECK_FALSE(verdict.options->showVersion);
        CHECK(verdict.error.empty());
    }

    SUBCASE("--schema first") {
        const CliParse verdict = parse({ "--schema", kSchemaPath, "--config", kConfigPath });
        INFO("error='", verdict.error, "'");
        REQUIRE(verdict.options.has_value());
        CHECK(verdict.options->configPath == kConfigPath);
        CHECK(verdict.options->schemaPath == kSchemaPath);
        CHECK_FALSE(verdict.options->showHelp);
        CHECK_FALSE(verdict.options->showVersion);
        CHECK(verdict.error.empty());
    }
}

TEST_CASE("[11.8-cli-contract] a missing required flag is refused naming that exact flag") {
    SUBCASE("missing --config") {
        checkRefusalNames(parse({ "--schema", kSchemaPath }), "--config");
    }

    SUBCASE("missing --schema") {
        checkRefusalNames(parse({ "--config", kConfigPath }), "--schema");
    }

    SUBCASE("empty argument list: both are missing and the refusal names a required flag") {
        const CliParse verdict = parse({});
        INFO("error='", verdict.error, "' usage='", verdict.usage, "'");
        CHECK_FALSE(verdict.options.has_value());
        REQUIRE_FALSE(verdict.error.empty());
        CHECK((mentions(verdict.error, "--config") || mentions(verdict.error, "--schema")));
        REQUIRE_FALSE(verdict.usage.empty());
        CHECK(mentions(verdict.usage, "--config"));
        CHECK(mentions(verdict.usage, "--schema"));
    }
}

TEST_CASE(
    "[11.8-cli-contract] a flag with no following value is refused naming that flag, never "
    "consuming the next flag as its value") {
    SUBCASE("--config as the final token") {
        checkRefusalNames(parse({ "--schema", kSchemaPath, "--config" }), "--config");
    }

    SUBCASE("--schema as the final token") {
        checkRefusalNames(parse({ "--config", kConfigPath, "--schema" }), "--schema");
    }

    SUBCASE("--config directly followed by --schema: the refusal names --config") {
        // A value-eating parse would take "--schema" as the config path and then
        // refuse for a missing --schema (or trip over the stranded path token);
        // the pinned rule is that the refusal names the flag whose value is
        // missing.
        checkRefusalNames(parse({ "--config", "--schema", kSchemaPath }), "--config");
    }
}

TEST_CASE(
    "[11.8-cli-contract] unknown flags and bare positionals are refused quoting the token "
    "verbatim") {
    SUBCASE("unknown flag alongside an otherwise complete invocation") {
        checkRefusalNames(
            parse({ "--config", kConfigPath, "--schema", kSchemaPath, "--verbose" }),
            "--verbose");
    }

    SUBCASE("unknown flag alone") {
        checkRefusalNames(parse({ "--bogus" }), "--bogus");
    }

    SUBCASE("bare positional argument") {
        checkRefusalNames(
            parse({ "--config", kConfigPath, "--schema", kSchemaPath, "stray.json" }),
            "stray.json");
    }

    SUBCASE("args EXCLUDE argv[0]: a leading program name is just a bare positional") {
        checkRefusalNames(
            parse({ "llama-router", "--config", kConfigPath, "--schema", kSchemaPath }),
            "llama-router");
    }
}

TEST_CASE("[11.8-cli-contract] a repeated flag is refused by name, never last-wins") {
    SUBCASE("repeated --config") {
        checkRefusalNames(
            parse({ "--config", "first.json", "--config", "second.json", "--schema", kSchemaPath }),
            "--config");
    }

    SUBCASE("repeated --schema") {
        checkRefusalNames(
            parse({ "--config", kConfigPath, "--schema", "first.json", "--schema", "second.json" }),
            "--schema");
    }
}

TEST_CASE(
    "[11.8-cli-contract] --help and --version are accepted alone and set exactly their own "
    "bool") {
    SUBCASE("--help alone: no --config required, showHelp set, usage carried") {
        const CliParse verdict = parse({ "--help" });
        INFO("error='", verdict.error, "'");
        REQUIRE(verdict.options.has_value());
        CHECK(verdict.options->showHelp);
        CHECK_FALSE(verdict.options->showVersion);
        CHECK(verdict.options->configPath.empty());
        CHECK(verdict.options->schemaPath.empty());
        CHECK(verdict.error.empty());
        // showHelp's only consumer is main printing the usage text, and the
        // parse is pure, so the text must ride along on the verdict itself.
        REQUIRE_FALSE(verdict.usage.empty());
        CHECK(mentions(verdict.usage, "--config"));
        CHECK(mentions(verdict.usage, "--schema"));
    }

    SUBCASE("--version alone: no --config required, showVersion set") {
        const CliParse verdict = parse({ "--version" });
        INFO("error='", verdict.error, "'");
        REQUIRE(verdict.options.has_value());
        CHECK(verdict.options->showVersion);
        CHECK_FALSE(verdict.options->showHelp);
        CHECK(verdict.options->configPath.empty());
        CHECK(verdict.options->schemaPath.empty());
        CHECK(verdict.error.empty());
    }

    // ORCHESTRATOR ADDITION (C-051). "Accepted ALONE" was asserted only in its
    // positive half: every subcase above passes the flag by itself, so deleting
    // the alone-ness refusal outright left all 73 cases green. The word "alone"
    // in this case's own name was doing no work.
    //
    // The behaviour is the implementer's invention — C-041 pins the exit codes
    // and the required flags but says nothing about combining --help with real
    // arguments. It is RATIFIED here rather than silently inherited, because
    // partial obedience is the bad outcome: a caller who writes
    // `--help --config x` means one of two incompatible things, and printing
    // usage while ALSO accepting a config would obey neither reading.
    SUBCASE("--help combined with real arguments is REFUSED, not partially obeyed") {
        const CliParse verdict = parse({ "--help", "--config", "/nonexistent/c.json" });
        CHECK_FALSE(verdict.options.has_value());
        CHECK_FALSE(verdict.error.empty());
        CHECK(mentions(verdict.error, "--help"));
        CHECK_FALSE(verdict.usage.empty());
    }

    SUBCASE("--version combined with real arguments is REFUSED too") {
        const CliParse verdict = parse({ "--config", "/nonexistent/c.json", "--version" });
        CHECK_FALSE(verdict.options.has_value());
        CHECK_FALSE(verdict.error.empty());
        CHECK(mentions(verdict.error, "--version"));
        CHECK_FALSE(verdict.usage.empty());
    }
}

TEST_CASE(
    "[11.8-cli-contract] parseCli is a pure function of its span: repeated calls agree and no "
    "file needs to exist") {
    SUBCASE("a successful parse repeats identically") {
        const std::vector<std::string_view> argv{ "--config", kConfigPath, "--schema",
                                                  kSchemaPath };
        const std::span<const std::string_view> args(argv.data(), argv.size());

        const CliParse first = conductor::router::parseCli(args);
        const CliParse second = conductor::router::parseCli(args);

        REQUIRE(first.options.has_value());
        REQUIRE(second.options.has_value());
        CHECK(first.options->configPath == second.options->configPath);
        CHECK(first.options->schemaPath == second.options->schemaPath);
        CHECK(first.options->showHelp == second.options->showHelp);
        CHECK(first.options->showVersion == second.options->showVersion);
        CHECK(first.error == second.error);
        CHECK(first.usage == second.usage);
    }

    SUBCASE("a refusal repeats identically") {
        const std::vector<std::string_view> argv{ "--bogus" };
        const std::span<const std::string_view> args(argv.data(), argv.size());

        const CliParse first = conductor::router::parseCli(args);
        const CliParse second = conductor::router::parseCli(args);

        CHECK_FALSE(first.options.has_value());
        CHECK_FALSE(second.options.has_value());
        CHECK(first.error == second.error);
        CHECK(first.usage == second.usage);
    }
}
