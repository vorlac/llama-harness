// =============================================================================
// Task 11.6 — llama-router `schema-observer`: request-side schema presence
// observation, plus response conformance implemented for completeness.
//
// The §4.4 observe-not-enforce slice. A request tagged `X-Conductor-Schema:
// required` (through 11.3's ALREADY-NORMALIZED RequestTags — no header is
// re-read here) is expected to declare a schema in its body; one that does not
// is counted `schemaMissing` and proxied unchanged. G5 fail-soft governs every
// verdict below: observation can never turn a request the direct path to
// llama-server would have served into an error. The one 400 this module's
// constants name is the OPT-IN schema.rejectOnMissing posture, wired in
// router.hpp, POST-only, and false in the shipped config.
//
// Scope is SHRUNK per branch-b-plan.md lines 91-94 + wire-notes DISCOVERY (i):
// fan-out responses STREAM and fan-out requests carry NO schema'd body field,
// so the load-bearing deliverable is the request-side schemaMissing counter.
// observe_response validates NON-STREAM bodies only, is exercised against stub
// traffic, and its inertness on real fan-out traffic is recorded in
// docs/build/honest-limits-pending.md. No SSE is parsed, buffered or
// reassembled anywhere in this header.
//
// Both observe_* functions are PURE: no I/O, no clock, no socket, no config
// file — which is what makes them doctest-reachable without a live server and
// lets Task 11.7 consume the same SchemaObservation per metrics line.
//
// Header-only, matching config.hpp / router.hpp / admission.hpp / affinity.hpp.
// =============================================================================

#pragma once

#include <nlohmann/json-schema.hpp>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <optional>
#include <string>

namespace conductor::router {

    // The opt-in 400's envelope constants, following 11.4's string-code
    // convention (kAdmissionErrorType / kQueueTimeoutCode), not 11.3's
    // integer 502.
    inline constexpr const char* kSchemaErrorType = "invalid_request_error";
    inline constexpr const char* kSchemaMissingCode = "schema_missing";

    // Defined in router/router.hpp, included below. This header and router.hpp
    // include each other — Router stores a SchemaObservation while
    // observe_request consumes 11.3's RequestTags — so everything class Router
    // needs (the struct and the two declarations) sits ABOVE the router.hpp
    // include and the RequestTags-consuming definitions sit BELOW it. Either
    // header can then be included first.
    struct RequestTags;

    // ONE request's schema observation — the value Task 11.7 emits per JSONL
    // metrics line and aggregates for /conductor/metrics.
    struct SchemaObservation {
        // RequestTags.schema is engaged AND equals "required"
        // case-insensitively — the only value inject.ts headersFor ever
        // mints. Any other engaged value is logged at debug and observed
        // UNTAGGED: it declares nothing 11.6 knows how to observe, and the
        // narrow reading is the G5-safe one under rejectOnMissing:true.
        bool tagged{ false };
        // tagged AND the FORWARDED (post-x_conductor-strip) body declares no
        // schema by the presence predicate on observe_request. An untagged
        // request is never "missing".
        bool schemaMissing{ false };
        // The declared JSON Schema when one is extractable: arm (a)'s
        // response_format.json_schema.schema, or arm (c)'s top-level
        // json_schema. Arm (b) (grammar) declares GBNF, which the JSON
        // validator cannot check, so it leaves this empty.
        std::optional<nlohmann::json> declaredSchema;
        // true/false for a validated non-stream response; empty when
        // unobservable — untagged, no declared schema, grammar-only,
        // validateResponses:false, streamed, no extractable output text, or
        // a declared schema the validator cannot compile.
        std::optional<bool> schemaConformed;
    };

    [[nodiscard]] SchemaObservation observe_request(const RequestTags& tags,
                                                    const std::string& body);

    [[nodiscard]] std::optional<bool> observe_response(const SchemaObservation& observation,
                                                       bool validateResponses, bool isStream,
                                                       const std::string& body);

}  // namespace conductor::router

#include "router/router.hpp"  // RequestTags — 11.3's normalized tag seam.

namespace conductor::router {

    namespace detail {

        // Arm (a): `response_format` is an object whose `type` == "json_schema"
        // and whose `json_schema.schema` is a non-empty object. Returns that
        // schema object, or nullptr when the arm is not satisfied —
        // response_format json_object, an empty schema object, and null or
        // wrong-typed values all fall through.
        [[nodiscard]] inline const nlohmann::json* responseFormatSchema(const nlohmann::json& body) {
            const auto responseFormat = body.find("response_format");
            if (responseFormat == body.end() || !responseFormat->is_object())
                return nullptr;

            const auto type = responseFormat->find("type");
            if (type == responseFormat->end() || !type->is_string() ||
                type->get_ref<const std::string&>() != "json_schema") {
                return nullptr;
            }

            const auto wrapper = responseFormat->find("json_schema");
            if (wrapper == responseFormat->end() || !wrapper->is_object())
                return nullptr;

            const auto schema = wrapper->find("schema");
            if (schema == wrapper->end() || !schema->is_object() || schema->empty())
                return nullptr;

            return &*schema;
        }

        // Arm (b): top-level `grammar` is a non-empty string. GBNF is a
        // declared constraint but not a JSON Schema, so this arm never yields
        // a declaredSchema.
        [[nodiscard]] inline bool declaresGrammar(const nlohmann::json& body) {
            const auto grammar = body.find("grammar");
            return grammar != body.end() && grammar->is_string() &&
                   !grammar->get_ref<const std::string&>().empty();
        }

        // Arm (c): top-level `json_schema` is a non-empty object.
        [[nodiscard]] inline const nlohmann::json* topLevelJsonSchema(const nlohmann::json& body) {
            const auto schema = body.find("json_schema");
            if (schema == body.end() || !schema->is_object() || schema->empty())
                return nullptr;

            return &*schema;
        }

        // The model's output text inside a BUFFERED response envelope: the
        // FIRST of choices[0].message.content (chat completions) or
        // choices[0].text (legacy completions) that is present and is a
        // string. Empty when neither is — an embeddings body, an error body,
        // an empty choices array — which is "unobservable", never an error.
        [[nodiscard]] inline std::optional<std::string> extractOutputText(const nlohmann::json& envelope) {
            const auto choices = envelope.find("choices");
            if (choices == envelope.end() || !choices->is_array() || choices->empty())
                return std::nullopt;

            const nlohmann::json& first = choices->front();
            if (!first.is_object())
                return std::nullopt;

            const auto message = first.find("message");
            if (message != first.end() && message->is_object()) {
                const auto content = message->find("content");
                if (content != message->end() && content->is_string())
                    return content->get<std::string>();
            }

            const auto text = first.find("text");
            if (text != first.end() && text->is_string())
                return text->get<std::string>();

            return std::nullopt;
        }

    }  // namespace detail

    /**
     * PURE presence observation over 11.3's ALREADY-NORMALIZED RequestTags and
     * the forwarded body: no header is re-read, no config file is opened, no
     * socket exists here. schemaConformed is left unset — that verdict is
     * observe_response's.
     *
     * The §4.4 presence predicate: the body parses as a JSON object AND one of
     *   (a) `response_format` is an object whose `type` == "json_schema" and
     *       whose `json_schema.schema` is a non-empty object
     *       (declaredSchema = that schema object);
     *   (b) top-level `grammar` is a non-empty string (declaredSchema EMPTY);
     *   (c) top-level `json_schema` is a non-empty object
     *       (declaredSchema = that object).
     * Everything else is missing: no body, a non-JSON body, non-object JSON,
     * response_format json_object, empty schema objects, empty grammar
     * strings, and null / wrong-typed values under any of the three keys.
     *
     * @param tags 11.3's normalized tag seam; only tags.schema is read.
     * @param body the FORWARDED (post-x_conductor-strip) body bytes.
     */
    [[nodiscard]] inline SchemaObservation observe_request(const RequestTags& tags,
                                                           const std::string& body) {
        SchemaObservation observation;
        if (!tags.schema)
            return observation;

        if (!detail::equalsIgnoreCase(*tags.schema, "required")) {
            spdlog::debug(
                "router: schema tag value '{}' declares nothing the observer recognizes — "
                "observed untagged",
                *tags.schema);

            return observation;
        }

        observation.tagged = true;
        observation.schemaMissing = true;

        if (body.empty())
            return observation;

        const nlohmann::json parsed =
            nlohmann::json::parse(body, nullptr, /*allow_exceptions=*/false);
        if (parsed.is_discarded() || !parsed.is_object())
            return observation;

        if (const nlohmann::json* declared = detail::responseFormatSchema(parsed)) {
            observation.schemaMissing = false;
            observation.declaredSchema = *declared;
            return observation;
        }

        if (detail::declaresGrammar(parsed))
            observation.schemaMissing = false;

        if (const nlohmann::json* declared = detail::topLevelJsonSchema(parsed)) {
            observation.schemaMissing = false;
            observation.declaredSchema = *declared;
        }

        return observation;
    }

    /**
     * The response half, applied to a BUFFERED (non-stream) response body.
     * Extracts the output text (detail::extractOutputText), parses THAT text
     * as JSON, and validates the value against declaredSchema with the linked
     * nlohmann json-schema-validator.
     *
     * Verdicts: conforming ⇒ true; output text unparseable as JSON, or
     * rejected by the validator ⇒ false (both genuine model non-conformance);
     * envelope unparseable, no extractable field, no declared schema,
     * untagged, validateResponses false, isStream true, or a declared schema
     * the validator cannot COMPILE ⇒ empty (unobservable — never an error,
     * never a touched relay). The uncompilable-schema case is load-bearing
     * G5: a malformed request-embedded schema is logged and observed as
     * unobservable, and can never fail the request that carried it.
     */
    [[nodiscard]] inline std::optional<bool> observe_response(const SchemaObservation& observation,
                                                              bool validateResponses, bool isStream,
                                                              const std::string& body) {
        if (!observation.tagged || !observation.declaredSchema || !validateResponses || isStream)
            return std::nullopt;

        const nlohmann::json envelope =
            nlohmann::json::parse(body, nullptr, /*allow_exceptions=*/false);
        if (envelope.is_discarded() || !envelope.is_object())
            return std::nullopt;

        const std::optional<std::string> outputText = detail::extractOutputText(envelope);
        if (!outputText)
            return std::nullopt;

        nlohmann::json_schema::json_validator validator;
        try {
            validator.set_root_schema(*observation.declaredSchema);
        } catch (const std::exception& failure) {
            spdlog::warn(
                "router: the declared schema does not compile ({}) — conformance unobservable",
                failure.what());

            return std::nullopt;
        }

        const nlohmann::json value =
            nlohmann::json::parse(*outputText, nullptr, /*allow_exceptions=*/false);
        if (value.is_discarded()) {
            // The request declared a JSON Schema and the model produced text
            // that is not JSON at all: genuine non-conformance.
            return false;
        }

        try {
            validator.validate(value);
            return true;
        } catch (const std::exception&) {
            return false;
        }
    }

}  // namespace conductor::router
