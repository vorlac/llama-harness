// =============================================================================
// Task 11.8 — llama-router CLI: the pure argument parse behind src/main.cpp.
//
// The surface is pinned by docs/build/CORRECTIONS.md C-041 and spec row
// 11.8-cli-contract (docs/build/specs/task-11.8.assertions.json, SG-A / SG-B /
// SG-I): `--config <path>` and `--schema <path>` are both REQUIRED — the schema
// has no default and no search path, because a second way to locate the config
// shape is exactly what the exported-schema design exists to prevent — while
// `--help` and `--version` are accepted alone and set only their own bool.
//
// parseCli is a PURE function of its argument span, which EXCLUDES argv[0]:
// no filesystem access, no getenv, no globals — the same argument vector
// yields the same CliParse every call. Neither path is opened or checked for
// existence here; that happens in main, after the parse. The pure/adapter
// split is what keeps the parse doctest-reachable while the parts that need a
// config file or a live socket stay in main and the 11.8 live artifact.
//
// The refusal contract, verdict by verdict:
//   * a missing required flag is refused naming that exact flag;
//   * a flag with no following value is refused naming that flag — a token
//     that itself starts with "--" is never consumed as a value;
//   * an unknown flag or a bare positional is refused quoting the token
//     verbatim (so an accidentally included argv[0] reads as a positional);
//   * a repeated --config or --schema is refused by name, never last-wins;
//   * every refusal carries a non-empty usage text naming both required
//     flags, and the SAME text rides along on --help, whose only consumer is
//     main printing it.
//
// main maps these verdicts to the C-041 exit codes: refusal -> 2 (stderr gets
// the error then the usage), --help / --version -> 0. Header-only, matching
// config.hpp / router.hpp / admission.hpp / affinity.hpp.
// =============================================================================

#pragma once

#include <optional>
#include <span>
#include <string>
#include <string_view>

namespace conductor::router {

    struct CliOptions {
        std::string configPath;     // value of the REQUIRED --config <path>
        std::string schemaPath;     // value of the REQUIRED --schema <path> (SG-B: no default, no search path)
        bool showHelp{ false };     // --help, accepted alone
        bool showVersion{ false };  // --version, accepted alone
    };

    struct CliParse {
        std::optional<CliOptions> options;  // engaged iff the parse succeeded
        std::string error;                  // empty on success; a refusal NAMES the offending or missing flag, or quotes the offending token verbatim
        std::string usage;                  // non-empty on every refusal and on --help; names both required flags
    };

    namespace detail {

        inline constexpr std::string_view kConfigFlag = "--config";
        inline constexpr std::string_view kSchemaFlag = "--schema";
        inline constexpr std::string_view kHelpFlag = "--help";
        inline constexpr std::string_view kVersionFlag = "--version";

        inline std::string cliUsageText() {
            return "usage: llama-router --config <path> --schema <path>\n"
                   "       llama-router --help | --version\n"
                   "\n"
                   "  --config <path>   router config JSON document (required)\n"
                   "  --schema <path>   RouterConfig JSON Schema file the config is validated\n"
                   "                    against (required; no default and no search path)\n"
                   "  --help            print this usage text and exit\n"
                   "  --version         print the router version and exit\n";
        }

    }  // namespace detail

    // Parses the argument span, which EXCLUDES argv[0]. Pure: no filesystem
    // access, no getenv, no globals — repeated calls over the same span yield
    // field-identical verdicts, and neither path is opened or checked here.
    [[nodiscard]] inline CliParse parseCli(std::span<const std::string_view> args) {
        CliParse verdict;
        verdict.usage = detail::cliUsageText();

        const auto refuse = [&verdict](std::string message) {
            verdict.options.reset();
            verdict.error = std::move(message);
            return verdict;
        };

        CliOptions options;
        bool haveConfig = false;
        bool haveSchema = false;

        for (std::size_t i = 0; i < args.size(); ++i) {
            const std::string_view token = args[i];

            if (token == detail::kConfigFlag || token == detail::kSchemaFlag) {
                bool& seen = (token == detail::kConfigFlag) ? haveConfig : haveSchema;
                if (seen)
                    return refuse("repeated flag " + std::string(token) + ": it may be given only once");

                // The next token is this flag's value only when one exists and
                // is not itself a flag: eating "--schema" as a config path would
                // turn one operator mistake into a misleading second refusal.
                if (i + 1 >= args.size() || args[i + 1].starts_with("--"))
                    return refuse("flag " + std::string(token) + " requires a <path> value");

                seen = true;
                std::string& slot = (token == detail::kConfigFlag) ? options.configPath : options.schemaPath;
                slot = std::string(args[++i]);
                continue;
            }

            if (token == detail::kHelpFlag) {
                options.showHelp = true;
                continue;
            }

            if (token == detail::kVersionFlag) {
                options.showVersion = true;
                continue;
            }

            if (token.starts_with("--"))
                return refuse("unknown flag '" + std::string(token) + "'");

            return refuse("unexpected argument '" + std::string(token) + "'");
        }

        // --help / --version are accepted ALONE: combining either with any
        // other argument is a refusal naming it, not a partial obedience.
        if (options.showHelp && args.size() > 1)
            return refuse("flag --help must be given alone");

        if (options.showVersion && args.size() > 1)
            return refuse("flag --version must be given alone");

        if (!options.showHelp && !options.showVersion) {
            if (!haveConfig)
                return refuse("missing required flag --config <path>");

            if (!haveSchema)
                return refuse("missing required flag --schema <path>");
        }

        verdict.options = std::move(options);
        return verdict;
    }

}  // namespace conductor::router
