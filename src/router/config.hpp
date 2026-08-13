// =============================================================================
// Task 11.2 — llama-router config + logging.
//
// Parses and validates the §2.2 router config document
// (docs/plans/2026-08-07-conductor-harness-plan.md, lines 636-670). The shape is
// owned by the exported JSON Schema file (src/tests/schemas/
// RouterConfig.schema.json, regenerated from the single source by
// conductor/tools/export-schemas.ts); the parser validates against whatever
// schema FILE it is handed, never a copy of the shape baked in here.
//
// Parse order (see parseRouterConfig):
//   1. parse the input text as JSON;
//   2. fill the three documented-optional keys with their §2.2 defaults —
//      logging.level "info", schema.rejectOnMissing false,
//      affinity.contiguousDequeue true — so the completed document satisfies
//      the exported schema, which marks every key required;
//   3. validate the completed document against the schema read from schemaPath
//      (nlohmann_json_schema_validator);
//   4. range-check both ports: 1..65535 inclusive (the schema types them as
//      plain numbers; the range is the parser's job);
//   5. reconcile admission.maxQueued with the listener's fixed thread budget
//      (SG-2): an over-budget value is clamped and the clamp logged at warn,
//      and a budget that cannot pay for a single queue slot is refused.
// Any violation throws ConfigError naming the offending field.
// =============================================================================

#pragma once

#include <nlohmann/json-schema.hpp>
#include <nlohmann/json.hpp>
#include <spdlog/common.h>
#include <spdlog/spdlog.h>

#include <cstdint>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>

namespace conductor::router {

    struct Endpoint {
        std::string host;
        int port{};
    };

    struct Admission {
        int maxInflightPerModel{};
        int maxQueued{};
        std::int64_t queueTimeoutMs{};
    };

    struct Priorities {
        int interactive{};
        int review{};
        int batch{};
    };

    struct Affinity {
        std::string header;
        bool contiguousDequeue{ true };
    };

    struct SchemaObserve {
        std::string observeHeader;
        bool validateResponses{};
        bool rejectOnMissing{ false };
    };

    struct Metrics {
        std::string ledgerPath;
    };

    struct Logging {
        std::string level{ "info" };
    };

    struct RouterConfig {
        int version{};
        Endpoint listen;
        Endpoint upstream;
        Admission admission;
        Priorities priorities;
        Affinity affinity;
        SchemaObserve schema;
        Metrics metrics;
        Logging logging;
    };

    // The single failure mode of this module.
    //   field()  — dotted path naming the offending field: "listen.port",
    //              "admission.bogus", "logging.level", "batching". Empty only when
    //              the schema file itself could not be read or parsed, in which
    //              case what() names the offending path.
    //   what()   — human message that ALWAYS contains field() verbatim.
    class ConfigError : public std::runtime_error {
    public:
        ConfigError(std::string field, const std::string& message)
            : std::runtime_error(withField(field, message))
            , field_(std::move(field)) {
        }

        [[nodiscard]] const std::string& field() const noexcept {
            return field_;
        }

    private:
        // Guarantees the what()-contains-field() invariant structurally, whatever
        // the throw site composed.
        static std::string withField(const std::string& field, const std::string& message) {
            if (field.empty() || message.find(field) != std::string::npos) {
                return message;
            }
            return field + ": " + message;
        }

        std::string field_;
    };

    namespace detail {

        // "/admission/bogus" -> "admission.bogus". The input is a serialized RFC 6901
        // JSON Pointer ("" for the document root), so segments are '/'-separated with
        // "~1" escaping '/' and "~0" escaping '~'.
        inline std::string dottedPointerPath(const std::string& pointer) {
            std::string dotted;
            std::size_t i = 0;
            while (i < pointer.size()) {
                ++i;  // Every segment starts with '/'.
                std::string segment;
                while (i < pointer.size() && pointer[i] != '/') {
                    if (pointer[i] == '~' && i + 1 < pointer.size() &&
                        (pointer[i + 1] == '0' || pointer[i + 1] == '1')) {
                        segment += (pointer[i + 1] == '0') ? '~' : '/';
                        i += 2;
                    }
                    else {
                        segment += pointer[i++];
                    }
                }

                if (!dotted.empty())
                    dotted += '.';

                dotted += segment;
            }

            return dotted;
        }

        // The validator names the offending property only inside its message for the
        // property-shaped violations — "required property 'listen' not found in
        // object", "validation failed for additional property 'batching': …" — while
        // its pointer stops at the enclosing object. Pull that quoted name out so the
        // dotted path can reach the real leaf.
        inline std::string quotedPropertyName(const std::string& message) {
            static constexpr const char* kMarker = "property '";
            const std::size_t at = message.find(kMarker);
            if (at == std::string::npos)
                return {};

            const std::size_t begin = at + std::string(kMarker).size();
            const std::size_t end = message.find('\'', begin);
            if (end == std::string::npos)
                return {};

            return message.substr(begin, end - begin);
        }

        // Dotted path of the offending field for one validator diagnostic: the
        // instance pointer, extended by the property name the message carries when the
        // pointer stops at the enclosing object.
        inline std::string offendingField(const nlohmann::json::json_pointer& pointer,
                                          const std::string& message) {
            std::string field = dottedPointerPath(pointer.to_string());
            const std::string leaf = quotedPropertyName(message);
            if (!leaf.empty()) {
                field = field.empty() ? leaf : field + "." + leaf;
            }
            return field;
        }

        // The §2.2 logging.level vocabulary. spdlog names the last one `err`.
        inline std::optional<spdlog::level::level_enum> spdlogLevelFor(const std::string& name) {
            if (name == "trace")
                return spdlog::level::trace;
            if (name == "debug")
                return spdlog::level::debug;
            if (name == "info")
                return spdlog::level::info;
            if (name == "warn")
                return spdlog::level::warn;
            if (name == "error")
                return spdlog::level::err;

            return std::nullopt;
        }

        // Collects the first violation the validator reports; the first one names the
        // offender, and one named offender is what ConfigError carries.
        struct FirstViolation final : nlohmann::json_schema::error_handler {
            bool failed{ false };
            std::string field;
            std::string message;

            void error(const nlohmann::json::json_pointer& pointer, const nlohmann::json& /*instance*/, const std::string& validatorMessage) override {
                if (failed)
                    return;

                failed = true;
                field = offendingField(pointer, validatorMessage);
                message = validatorMessage;
            }
        };

        // Reads and compiles the schema FILE on every parse. Failures here are the one
        // place ConfigError carries an empty field(); what() names the path instead.
        inline nlohmann::json_schema::json_validator loadSchemaValidator(const std::string& schemaPath) {
            nlohmann::json schemaJson;
            {
                std::ifstream in(schemaPath, std::ios::binary);
                if (!in.is_open()) {
                    throw ConfigError(
                        "", "cannot read router config schema file: " +
                                schemaPath);
                }

                try {
                    schemaJson = nlohmann::json::parse(in);
                } catch (const nlohmann::json::parse_error& error) {
                    throw ConfigError("", "router config schema file " + schemaPath +
                                              " is not valid JSON: " + error.what());
                }
            }
            nlohmann::json_schema::json_validator validator;
            try {
                validator.set_root_schema(std::move(schemaJson));
            } catch (const std::exception& error) {
                throw ConfigError(
                    "", "router config schema file " + schemaPath +
                            " is not a usable JSON Schema: " + error.what());
            }
            return validator;
        }

        // SG-2's fixed thread budget for the router listener, and the margin of
        // the plan's threads >= maxQueued + sum(maxInflightPerModel) + 8. Every
        // in-flight and every queued request parks one handler thread, so the
        // admission block sizes the pool; these primitives live here because the
        // clamp below is part of this module's validation path, and Task 11.4's
        // admission.hpp republishes them as kAdmissionThreadBudget /
        // kTaskQueueThreadMargin alongside computeTaskQueueThreads.
        inline constexpr int kAdmissionThreadBudget = 256;
        inline constexpr int kTaskQueueThreadMargin = 8;

        [[nodiscard]] inline constexpr int taskQueueThreadsFor(const Admission& admission) {
            return admission.maxQueued + admission.maxInflightPerModel + kTaskQueueThreadMargin;
        }

        // SG-2: a maxQueued the thread budget cannot pay for is reduced to the one
        // it can, announced at warn naming BOTH values — a silent clamp is
        // indistinguishable from a bug. When the arithmetic cannot reach a single
        // queue slot the config is refused by name instead of being repaired into
        // something the operator never asked for.
        inline void clampMaxQueuedToThreadBudget(RouterConfig& config) {
            if (taskQueueThreadsFor(config.admission) <= kAdmissionThreadBudget)
                return;

            const int effective = kAdmissionThreadBudget -
                                  config.admission.maxInflightPerModel -
                                  kTaskQueueThreadMargin;
            if (effective < 1) {
                throw ConfigError(
                    "admission.maxQueued",
                    "router config field 'admission.maxQueued' cannot be satisfied within the " +
                        std::to_string(kAdmissionThreadBudget) +
                        "-thread budget: admission.maxInflightPerModel " +
                        std::to_string(config.admission.maxInflightPerModel) + " plus the " +
                        std::to_string(kTaskQueueThreadMargin) +
                        "-thread margin leaves room for " + std::to_string(effective) +
                        " queued requests");
            }

            spdlog::warn(
                "router config: admission.maxQueued {} exceeds the {}-thread budget with "
                "admission.maxInflightPerModel {}; using an effective admission.maxQueued of {}",
                config.admission.maxQueued, kAdmissionThreadBudget,
                config.admission.maxInflightPerModel, effective);

            config.admission.maxQueued = effective;
        }

        inline void checkPort(const nlohmann::json& document, const std::string& block) {
            const std::string field = block + ".port";
            const nlohmann::json& port = document.at(block).at("port");
            if (!port.is_number_integer()) {
                throw ConfigError(
                    field,
                    "router config field '" + field +
                        "' must be an integer TCP port in 1..65535");
            }

            const auto value = port.get<std::int64_t>();
            if (value < 1 || value > 65535) {
                throw ConfigError(
                    field,
                    "router config field '" + field +
                        "' must be in 1..65535, got " + std::to_string(value));
            }
        }

    }  // namespace detail

    inline RouterConfig parseRouterConfig(const std::string& json, const std::string& schemaPath) {
        // 1. Parse the input text as JSON.
        nlohmann::json document;
        try {
            document = nlohmann::json::parse(json);
        } catch (const nlohmann::json::parse_error& error) {
            throw ConfigError(
                "", std::string("router config is not valid JSON: ") +
                        error.what());
        }

        // 2. Fill the three documented-optional keys with their §2.2 defaults, so
        //    the completed document can satisfy the exported schema (which marks
        //    every key required). Blocks of the wrong type are left for the schema
        //    to reject by name.
        if (document.is_object()) {
            if (!document.contains("logging"))
                document["logging"] = nlohmann::json{ { "level", "info" } };

            if (document.contains("schema") && document["schema"].is_object() &&
                !document["schema"].contains("rejectOnMissing")) {
                document["schema"]["rejectOnMissing"] = false;
            }

            if (document.contains("affinity") && document["affinity"].is_object() &&
                !document["affinity"].contains("contiguousDequeue")) {
                document["affinity"]["contiguousDequeue"] = true;
            }
        }

        // 3. Validate the completed document against the schema file it was handed.
        const nlohmann::json_schema::json_validator validator = detail::loadSchemaValidator(schemaPath);
        detail::FirstViolation violation;
        validator.validate(document, violation);
        if (violation.failed) {
            if (violation.field.empty()) {
                throw ConfigError(
                    "", "router config failed schema validation: " +
                            violation.message);
            }

            throw ConfigError(
                violation.field,
                "router config field '" + violation.field +
                    "' rejected: " + violation.message);
        }

        // 4. Range-check both ports; the schema types them as bare numbers.
        detail::checkPort(document, "listen");
        detail::checkPort(document, "upstream");

        // logging.level must be a level this router can actually apply — never a
        // silent fallback. Checked here at parse time; the schema only constrains
        // the value's type.
        const nlohmann::json& level = document.at("logging").at("level");
        if (!level.is_string() || !detail::spdlogLevelFor(level.get<std::string>())) {
            throw ConfigError(
                "logging.level",
                "router config field 'logging.level' must be one of trace, debug, "
                "info, warn, error; got " +
                    level.dump());
        }

        RouterConfig config;
        config.version = document.at("version").get<int>();
        config.listen.host = document.at("listen").at("host").get<std::string>();
        config.listen.port = document.at("listen").at("port").get<int>();
        config.upstream.host = document.at("upstream").at("host").get<std::string>();
        config.upstream.port = document.at("upstream").at("port").get<int>();
        config.admission.maxInflightPerModel = document.at("admission").at("maxInflightPerModel").get<int>();
        config.admission.maxQueued = document.at("admission").at("maxQueued").get<int>();
        config.admission.queueTimeoutMs = document.at("admission").at("queueTimeoutMs").get<std::int64_t>();
        config.priorities.interactive = document.at("priorities").at("interactive").get<int>();
        config.priorities.review = document.at("priorities").at("review").get<int>();
        config.priorities.batch = document.at("priorities").at("batch").get<int>();
        config.affinity.header = document.at("affinity").at("header").get<std::string>();
        config.affinity.contiguousDequeue = document.at("affinity").at("contiguousDequeue").get<bool>();
        config.schema.observeHeader = document.at("schema").at("observeHeader").get<std::string>();
        config.schema.validateResponses = document.at("schema").at("validateResponses").get<bool>();
        config.schema.rejectOnMissing = document.at("schema").at("rejectOnMissing").get<bool>();
        config.metrics.ledgerPath = document.at("metrics").at("ledgerPath").get<std::string>();
        config.logging.level = level.get<std::string>();

        // 5. Reconcile the admission block with the listener's thread budget: the
        //    parse yields the maxQueued the router will actually run with.
        detail::clampMaxQueuedToThreadBudget(config);
        return config;
    }

    // Applies cfg.logging.level to spdlog so that spdlog::default_logger()->level()
    // reports it: "trace"->trace, "debug"->debug, "info"->info, "warn"->warn,
    // "error"->err. parseRouterConfig has already vetted the string; an
    // unrecognised one reaching this point is still refused by name rather than
    // silently ignored.
    inline void applyLoggingLevel(const RouterConfig& cfg) {
        const std::optional<spdlog::level::level_enum> level =
            detail::spdlogLevelFor(cfg.logging.level);
        if (!level) {
            throw ConfigError(
                "logging.level",
                "router config field 'logging.level' must be one of trace, debug, "
                "info, warn, error; got \"" +
                    cfg.logging.level + "\"");
        }

        spdlog::set_level(*level);
    }

}  // namespace conductor::router
