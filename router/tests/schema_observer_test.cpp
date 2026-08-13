// =============================================================================
// Task 11.6 — llama-router `schema-observer`: request-side schema presence
// observation, plus response conformance implemented for completeness.
//
// This suite is written RED: `router/schema-observer.hpp` does not exist yet,
// so this translation unit fails to COMPILE. That is the intended red shape.
// Everything else this file touches — config.hpp, router.hpp, admission.hpp —
// is committed code and must keep compiling verbatim. One TEST_CASE per
// assertion id from docs/build/specs/task-11.6.assertions.json (13 rows),
// named "[<id>] …".
//
// SCOPE, pinned by Task 0.2 before any C++ existed (branch-b-plan.md lines
// 91-94 + wire-notes DISCOVERY (i)): fan-out responses STREAM and fan-out
// requests carry NO schema'd body field, so the load-bearing deliverable is
// the request-side schemaMissing counter. Response validation is implemented
// for completeness, exercised against stub traffic only, and its inertness on
// real fan-out traffic is recorded in docs/build/honest-limits-pending.md
// (asserted by [11.6-shrunk-scope-note]).
//
// THE TARGET SURFACE
//
//   // router/schema-observer.hpp   (HEADER-ONLY, matching 11.2-11.5)
//   #pragma once
//
//   #include <nlohmann/json.hpp>
//
//   #include <optional>
//   #include <string>
//
//   #include "router/router.hpp"   // RequestTags — 11.3's normalized tag seam
//
//   namespace conductor::router {
//
//   // The opt-in 400's envelope constants, following 11.4's string-code
//   // convention (kAdmissionErrorType / kQueueTimeoutCode), not 11.3's
//   // integer 502.
//   inline constexpr const char* kSchemaErrorType   = "invalid_request_error";
//   inline constexpr const char* kSchemaMissingCode = "schema_missing";
//
//   // ONE request's schema observation — the value Task 11.7 emits per JSONL
//   // metrics line and aggregates for /conductor/metrics.
//   struct SchemaObservation {
//       // RequestTags.schema is engaged AND equals "required"
//       // case-insensitively — the only value inject.ts headersFor ever
//       // mints. Any other engaged value is logged at debug and observed
//       // UNTAGGED: it declares nothing 11.6 knows how to observe, and the
//       // narrow reading is the G5-safe one under rejectOnMissing:true.
//       bool tagged{ false };
//       // tagged AND the FORWARDED (post-x_conductor-strip) body declares no
//       // schema by the presence predicate below. An untagged request is
//       // never "missing".
//       bool schemaMissing{ false };
//       // The declared JSON Schema when one is extractable: arm (a)'s
//       // response_format.json_schema.schema, or arm (c)'s top-level
//       // json_schema. Arm (b) (grammar) declares GBNF, which the JSON
//       // validator cannot check, so it leaves this empty.
//       std::optional<nlohmann::json> declaredSchema;
//       // true/false for a validated non-stream response; empty when
//       // unobservable — untagged, no declared schema, grammar-only,
//       // validateResponses:false, streamed, no extractable output text, or
//       // a declared schema the validator cannot compile.
//       std::optional<bool> schemaConformed;
//   };
//
//   // PURE presence observation over 11.3's ALREADY-NORMALIZED RequestTags
//   // and the forwarded body: no header is re-read, no config file is
//   // opened, no socket exists here. schemaConformed is left unset. The §4.4
//   // presence predicate — the body parses as a JSON object AND one of:
//   //   (a) `response_format` is an object whose `type` == "json_schema" and
//   //       whose `json_schema.schema` is a non-empty object
//   //       (declaredSchema = that schema object);
//   //   (b) top-level `grammar` is a non-empty string (declaredSchema EMPTY);
//   //   (c) top-level `json_schema` is a non-empty object
//   //       (declaredSchema = that object).
//   // Everything else is missing: no body, a non-JSON body, non-object JSON,
//   // response_format json_object, empty schema objects, empty grammar
//   // strings, and null / wrong-typed values under any of the three keys.
//   [[nodiscard]] SchemaObservation observe_request(const RequestTags& tags,
//                                                   const std::string& body);
//
//   // The response half, applied to a BUFFERED (non-stream) response body.
//   // Extracts the output text as the FIRST of choices[0].message.content
//   // (chat completions) or choices[0].text (legacy completions) that is
//   // present and is a string, parses THAT text as JSON, and validates the
//   // value against declaredSchema with the linked
//   // nlohmann json-schema-validator. Verdicts: conforming ⇒ true; output
//   // text unparseable as JSON, or rejected by the validator ⇒ false (both
//   // genuine model non-conformance); envelope unparseable, no extractable
//   // field, no declared schema, untagged, validateResponses false, isStream
//   // true, or a declared schema the validator cannot COMPILE ⇒ empty
//   // (unobservable — never an error, never a touched relay).
//   [[nodiscard]] std::optional<bool> observe_response(
//       const SchemaObservation& observation, bool validateResponses,
//       bool isStream, const std::string& body);
//
//   }  // namespace conductor::router
//
// THE ROUTER SEAM (router/router.hpp, extended IN PLACE):
//   - handleProxy ordering: planForward → recordTags →
//     observe_request(plan.tags, plan.body) → counter/warn-log → the
//     rejectOnMissing check (POST /v1/* ONLY — no upstream contact, no
//     admission slot consumed, no queue entry) → admit → relayToUpstream.
//     Observation runs for EVERY /v1/* request, GET /v1/models included.
//   - two observers mirroring the committed last_request_tags():
//         [[nodiscard]] std::optional<SchemaObservation>
//         last_schema_observation() const;   // nullopt until one /v1/*
//                                            // request has been handled
//         [[nodiscard]] std::uint64_t schema_missing_count() const;
//                                            // monotonic since construction
//   - the counter increments on every tagged-and-missing request WHATEVER
//     rejectOnMissing says: the refusal is a posture, the count an
//     observation.
//   - the opt-in 400 (schema.rejectOnMissing:true, reachable by config change
//     and never the shipped default) reuses the committed envelope shape —
//     {"error":{"message":…,"type":kSchemaErrorType,
//               "code":kSchemaMissingCode}}, status 400, Content-Type
//     application/json — with a message naming the resolved observe-header
//     AND the literal "schema.rejectOnMissing".
//   - a tagged-schema-missing request is journaled as ONE spdlog::warn line
//     naming the request's role and group tags and the request path. That is
//     an implementation obligation, deliberately NOT asserted here: capturing
//     the process-global spdlog default logger beside threaded suites is
//     fragile apparatus, so schema_missing_count() and
//     last_schema_observation() are the tested surface.
//   - streamed responses relay EXACTLY as 11.3 ships them: no SSE parse, no
//     buffering, no reassembly, no validator; schemaConformed stays empty.
//
// This file's final home is router/tests/schema_test.cpp. CMake wiring is
// ORCHESTRATOR-ONLY: this file joins the router-tests target source list.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
//
// NO SLEEPS AS SYNCHRONIZATION anywhere below: the SSE case synchronizes on
// observed client-side state plus a condvar gate (the 11.3 idiom), the
// held-slot case on the stub's request log, and every deadline or timeout
// bounds a FAILING run only. The exported §2 schemas are read verbatim from
// router/tests/schemas/ (regenerated by conductor/tools/export-schemas.ts),
// never hand-copied — the plan's single-source/two-validators discipline
// (lines 2069-2075).
// =============================================================================

#include <doctest/doctest.h>
#include <httplib.h>
#include <nlohmann/json-schema.hpp>
#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#include "router/admission.hpp"
#include "router/config.hpp"
#include "router/router.hpp"
#include "router/schema-observer.hpp"

namespace {

    using conductor::router::observe_request;
    using conductor::router::observe_response;
    using conductor::router::RequestTags;
    using conductor::router::SchemaObservation;
    using nlohmann::json;

    constexpr const char* kHost = "127.0.0.1";
    constexpr const char* kChatPath = "/v1/chat/completions";
    constexpr const char* kModelsPath = "/v1/models";
    constexpr const char* kModel = "qwen3.6-27b";

    // The stub's canned answer for the request-side rows. Deliberately
    // NON-canonical whitespace: any parse→re-serialize on the return path
    // changes these bytes, so byte-equality client-side proves the verbatim
    // relay.
    constexpr const char* kUpstreamAnswer =
        "{ \"served\" : true ,\n\t\"note\" : \"upstream bytes — returned verbatim\" }";

    // A tagged request that declares NO schema — the §4.4 shape the whole task
    // exists for. Non-canonical whitespace: with no x_conductor key, 11.3
    // forwards the caller's exact bytes, so byte-equality at the stub proves
    // observation mutated nothing.
    constexpr const char* kSchemalessBody =
        "{ \"model\" : \"qwen3.6-27b\" ,\r\n"
        "\t\"messages\" : [ { \"role\" : \"user\" , \"content\" : \"no schema declared\" } ] }";

    // Arm (b): a grammar declares GBNF — a constraint, but not a JSON Schema.
    constexpr const char* kGrammarBody =
        "{ \"model\" : \"qwen3.6-27b\" ,\n"
        "  \"messages\" : [ { \"role\" : \"user\" , \"content\" : \"constrained\" } ] ,\n"
        "  \"grammar\" : \"root ::= \\\"yes\\\" | \\\"no\\\"\" }";

    // The stub upstream from Task 11.3's proxy_test.cpp: an in-process
    // httplib::Server on an ephemeral port, recording every request it serves
    // so the tests can assert exactly what crossed the proxy.
    struct CapturedRequest {
        std::string method;
        std::string path;
        std::string body;
        httplib::Headers headers;

        [[nodiscard]] std::string header(const std::string& name) const {
            const auto it = headers.find(name);
            return it == headers.end() ? std::string() : it->second;
        }
    };

    class StubUpstream {
    public:
        StubUpstream() = default;

        ~StubUpstream() {
            stop();
        }

        StubUpstream(const StubUpstream&) = delete;
        StubUpstream& operator=(const StubUpstream&) = delete;

        // Register handlers on server() BEFORE calling start().
        httplib::Server& server() {
            return server_;
        }

        void start() {
            port_ = server_.bind_to_any_port(kHost);
            REQUIRE(port_ > 0);
            listen_ = std::thread([this] {
                server_.listen_after_bind();
            });
            server_.wait_until_ready();
        }

        void stop() {
            if (listen_.joinable()) {
                server_.stop();
                listen_.join();
            }
        }

        [[nodiscard]] int port() const {
            return port_;
        }

        void record(const httplib::Request& request) {
            const std::lock_guard<std::mutex> lock(mutex_);
            requests_.push_back(
                CapturedRequest{
                    request.method,
                    request.path,
                    request.body,
                    request.headers,
                });
        }

        [[nodiscard]] std::size_t requestCount() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return requests_.size();
        }

        [[nodiscard]] CapturedRequest request(std::size_t index) const {
            const std::lock_guard<std::mutex> lock(mutex_);
            REQUIRE(index < requests_.size());
            return requests_[index];
        }

    private:
        httplib::Server server_;
        std::thread listen_;
        int port_{ 0 };
        mutable std::mutex mutex_;
        std::vector<CapturedRequest> requests_;
    };

    // Answers every POST /v1/* with `answer` (application/json, status 200),
    // recording what arrived. Registered before start().
    void answerWith(StubUpstream& upstream, std::string answer) {
        upstream.server().Post(
            "/v1/.*",
            [&upstream, answer = std::move(answer)](const httplib::Request& request,
                                                    httplib::Response& response) {
                upstream.record(request);
                response.set_content(answer, "application/json");
            });
    }

    // The Router consumes Task 11.2's PARSED RouterConfig, so the tests build
    // the struct directly (the 11.3/11.4/11.5 makeConfig idiom). listen.port 0
    // is the pinned test-only "bind an ephemeral port" construction. The
    // metrics ledger path points into the OS temp dir: unit tests must never
    // touch the repo's .data tree, and 11.6 writes no ledger anyway.
    conductor::router::RouterConfig makeConfig(int upstreamPort) {
        conductor::router::RouterConfig config;
        config.version = 1;
        config.listen = { kHost, 0 };
        config.upstream = { kHost, upstreamPort };
        config.admission = { 4, 64, 600000 };
        config.priorities = { 0, 1, 2 };
        config.affinity = { "X-Conductor-Group", true };
        config.schema = { "X-Conductor-Schema", true, false };
        config.metrics = {
            (std::filesystem::temp_directory_path() / "conductor-router-11.6" / "metrics.jsonl")
                .string()
        };
        config.logging = { "info" };
        return config;
    }

    void configureClient(httplib::Client& client) {
        client.set_connection_timeout(10, 0);
        client.set_read_timeout(10, 0);
    }

    bool mentions(std::string_view haystack, std::string_view needle) {
        return haystack.find(needle) != std::string_view::npos;
    }

    // Readiness poll on OBSERVABLE state (the 11.3 idiom): the predicate is
    // the synchronization, the 2ms interval is only poll granularity, and the
    // deadline bounds a FAILING run. No assertion rests on the deadline.
    bool waitUntil(const std::function<bool()>& ready,
                   std::chrono::milliseconds deadline = std::chrono::seconds{ 10 }) {
        const auto giveUp = std::chrono::steady_clock::now() + deadline;
        while (std::chrono::steady_clock::now() < giveUp) {
            if (ready())
                return true;

            std::this_thread::sleep_for(std::chrono::milliseconds{ 2 });
        }

        return ready();
    }

    // The exact header/value conductor/adapter/inject.ts headersFor mints —
    // the ONLY producer of the tag. Inventing a second value or a second
    // producer here would be a spec violation.
    httplib::Headers taggedHeaders() {
        return httplib::Headers{ { "X-Conductor-Schema", "required" } };
    }

    RequestTags taggedTags() {
        RequestTags tags;
        tags.schema = "required";
        return tags;
    }

    // Resolves a repo-relative path by walking up from this source file's
    // directory, then from the working directory — so the suite runs from the
    // build tree and from ctest alike (the config_test.cpp idiom, generalized
    // to reach docs/ as well as router/tests/schemas/).
    std::filesystem::path repoPath(const std::filesystem::path& relative) {
        std::error_code ec;

        std::filesystem::path dir = std::filesystem::path(__FILE__).parent_path();
        while (!dir.empty()) {
            if (std::filesystem::exists(dir / relative, ec))
                return dir / relative;

            const std::filesystem::path parent = dir.parent_path();
            if (parent == dir)
                break;

            dir = parent;
        }

        dir = std::filesystem::current_path(ec);
        while (!ec && !dir.empty()) {
            if (std::filesystem::exists(dir / relative, ec))
                return dir / relative;

            const std::filesystem::path parent = dir.parent_path();
            if (parent == dir)
                break;

            dir = parent;
        }

        return relative;  // Nothing found: the failure message names what was sought.
    }

    // An exported §2 schema, read VERBATIM from router/tests/schemas/
    // (regenerated by conductor/tools/export-schemas.ts). Hand-writing a copy
    // into this file would fork the single source the plan's 2069-2075
    // discipline exists to protect.
    json readExportedSchema(const char* fileName) {
        const std::filesystem::path path =
            repoPath(std::filesystem::path("router/tests/schemas") / fileName);
        INFO("exported schema: ", path.string());
        REQUIRE(std::filesystem::exists(path));

        std::ifstream in(path, std::ios::binary);
        REQUIRE(in.is_open());
        json schema = json::parse(in, nullptr, /*allow_exceptions=*/false);
        REQUIRE_FALSE(schema.is_discarded());
        return schema;
    }

    std::string readFileText(const std::filesystem::path& path) {
        std::ifstream in(path, std::ios::binary);
        REQUIRE(in.is_open());
        std::ostringstream buffer;
        buffer << in.rdbuf();
        return buffer.str();
    }

    // Arm (a): response_format.json_schema.schema carries the declared schema.
    // dump(2) keeps the bytes NON-canonical relative to nlohmann's default
    // dump(), so a parse→re-serialize anywhere on the path is detectable.
    std::string responseFormatBody(const json& schema) {
        json body;
        body["model"] = kModel;
        body["messages"] =
            json::array({ json{ { "role", "user" }, { "content", "structured output" } } });
        body["response_format"] =
            json{ { "type", "json_schema" },
                  { "json_schema", json{ { "name", "Verdict" }, { "schema", schema } } } };
        return body.dump(2);
    }

    // Arm (c): a top-level json_schema object.
    std::string topLevelJsonSchemaBody(const json& schema) {
        json body;
        body["model"] = kModel;
        body["messages"] =
            json::array({ json{ { "role", "user" }, { "content", "structured output" } } });
        body["json_schema"] = schema;
        return body.dump(2);
    }

    // A single non-stream chat.completion envelope whose output text is
    // `content` — the shape observe_response extracts choices[0].message.content
    // from.
    std::string chatCompletionBody(const std::string& content) {
        json envelope;
        envelope["id"] = "chatcmpl-1";
        envelope["object"] = "chat.completion";
        envelope["model"] = kModel;
        envelope["choices"] = json::array(
            { json{ { "index", 0 },
                    { "message", json{ { "role", "assistant" }, { "content", content } } },
                    { "finish_reason", "stop" } } });
        return envelope.dump(2);
    }

    // The legacy completions envelope: choices[0].text.
    std::string legacyCompletionBody(const std::string& text) {
        json envelope;
        envelope["id"] = "cmpl-1";
        envelope["object"] = "text_completion";
        envelope["model"] = kModel;
        envelope["choices"] = json::array(
            { json{ { "index", 0 }, { "text", text }, { "finish_reason", "stop" } } });
        return envelope.dump(2);
    }

    SchemaObservation lastObservation(const conductor::router::Router& router) {
        const std::optional<SchemaObservation> observation = router.last_schema_observation();
        REQUIRE(observation.has_value());
        return *observation;
    }

    // One request through the router with the byte-identity law asserted at
    // BOTH ends: the stub sees the caller's exact bytes (no fixture body
    // passed here carries an x_conductor key, so 11.3 forwards the original
    // bytes) and the caller sees the stub's answer verbatim with its status.
    // Returns the router's observation of that request.
    SchemaObservation proxiedUntouched(const conductor::router::Router& router,
                                       httplib::Client& client, StubUpstream& upstream,
                                       const httplib::Headers& headers, const std::string& body,
                                       const std::string& upstreamAnswer) {
        const std::size_t alreadySeen = upstream.requestCount();

        const auto result = client.Post(kChatPath, headers, body, "application/json");
        REQUIRE(result);
        CHECK(result->status == 200);
        CHECK(result->body == upstreamAnswer);
        CHECK(result->get_header_value("Content-Type") == "application/json");

        REQUIRE(upstream.requestCount() == alreadySeen + 1);
        const CapturedRequest seen = upstream.request(alreadySeen);
        CHECK(seen.method == "POST");
        CHECK(seen.path == kChatPath);
        CHECK(seen.body == body);

        return lastObservation(router);
    }

    // The §2.2 router config document (plan lines 636-670), verbatim — the
    // config_test.cpp fixture, reused rather than restated.
    constexpr const char* kSection22ConfigText = R"CONFIG({
        "version": 1,
        "listen": { "host": "127.0.0.1", "port": 8088 },
        "upstream": { "host": "127.0.0.1", "port": 8080 },
        "admission": {
            "maxInflightPerModel": 4,
            "maxQueued": 64,
            "queueTimeoutMs": 600000
        },
        "priorities": { "interactive": 0, "review": 1, "batch": 2 },
        "affinity": { "header": "X-Conductor-Group", "contiguousDequeue": true },
        "schema": {
            "observeHeader": "X-Conductor-Schema",
            "validateResponses": true,
            "rejectOnMissing": false
        },
        "metrics": { "ledgerPath": ".data/router/metrics.jsonl" },
        "logging": { "level": "info" }
    })CONFIG";

    // True when `value` satisfies the compiled schema — the validator's throw
    // is the reject verdict, nothing else.
    bool conforms(const nlohmann::json_schema::json_validator& validator, const json& value) {
        try {
            validator.validate(value);
            return true;
        } catch (const std::exception&) {
            return false;
        }
    }

}  // namespace

TEST_CASE(
    "[11.6-tagged-missing-observed-not-rejected] a tagged request with no schema field is "
    "proxied byte-identically, observed tagged+schemaMissing, counted exactly once, and NEVER "
    "rejected under the shipped default config") {
    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    // Zero before anything is handled, mirroring last_request_tags().
    CHECK(router.schema_missing_count() == 0);
    CHECK_FALSE(router.last_schema_observation().has_value());

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // The exact header/value inject.ts headersFor mints, alongside ordinary
    // end-to-end headers that must cross unchanged.
    const httplib::Headers headers = {
        { "X-Conductor-Schema", "required" },
        { "X-Conductor-Role", "reviewer" },
        { "Authorization", "Bearer conductor-test-token" },
    };

    const auto result = client.Post(kChatPath, headers, kSchemalessBody, "application/json");
    REQUIRE(result);
    // The whole point of the task (G5): observed, never rejected — the
    // upstream's status and body return verbatim.
    CHECK(result->status == 200);
    CHECK(result->body == kUpstreamAnswer);
    CHECK(result->get_header_value("Content-Type") == "application/json");

    // Exactly one hit, byte-identical: same method, same target, same body
    // bytes, end-to-end headers unchanged — the observation adds, strips and
    // rewrites nothing.
    REQUIRE(upstream.requestCount() == 1);
    const CapturedRequest seen = upstream.request(0);
    CHECK(seen.method == "POST");
    CHECK(seen.path == kChatPath);
    CHECK(seen.body == kSchemalessBody);
    CHECK(seen.header("X-Conductor-Schema") == "required");
    CHECK(seen.header("X-Conductor-Role") == "reviewer");
    CHECK(seen.header("Authorization") == "Bearer conductor-test-token");
    CHECK(seen.header("Content-Type") == "application/json");

    const SchemaObservation observation = lastObservation(router);
    CHECK(observation.tagged);
    CHECK(observation.schemaMissing);
    CHECK_FALSE(observation.declaredSchema.has_value());

    // Counted: the POC's headline number advances by exactly one.
    CHECK(router.schema_missing_count() == 1);
}

TEST_CASE(
    "[11.6-schema-present-arms] each accepted declaration shape observes schemaMissing:false — "
    "response_format json_schema and top-level json_schema extract the declared schema, grammar "
    "declares without one — and the body still crosses byte-identically") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    std::string body;
    std::optional<json> expectedDeclared;

    SUBCASE("(a) response_format json_schema") {
        body = responseFormatBody(verdictSchema);
        expectedDeclared = verdictSchema;
    }

    SUBCASE("(b) top-level non-empty grammar string") {
        body = kGrammarBody;
        expectedDeclared = std::nullopt;  // GBNF is not a JSON Schema.
    }

    SUBCASE("(c) top-level json_schema object") {
        body = topLevelJsonSchemaBody(verdictSchema);
        expectedDeclared = verdictSchema;
    }

    // The pure seam first: observe_request needs no server.
    const SchemaObservation pure = observe_request(taggedTags(), body);
    CHECK(pure.tagged);
    CHECK_FALSE(pure.schemaMissing);
    CHECK(pure.declaredSchema == expectedDeclared);
    // observe_request leaves the verdict unset — that is observe_response's.
    CHECK_FALSE(pure.schemaConformed.has_value());

    // End-to-end: the same body through the live Router, byte-identical.
    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const SchemaObservation observation =
        proxiedUntouched(router, client, upstream, taggedHeaders(), body, kUpstreamAnswer);
    CHECK(observation.tagged);
    CHECK_FALSE(observation.schemaMissing);
    CHECK(observation.declaredSchema == expectedDeclared);
    // A declared constraint is not "missing" — counting it would inflate the
    // POC's headline number.
    CHECK(router.schema_missing_count() == 0);
}

TEST_CASE(
    "[11.6-schema-missing-predicate-negatives] every non-declaration observes "
    "schemaMissing:true with no declared schema, and none of them is rejected or mutated under "
    "the default config") {
    std::string body;

    SUBCASE("empty body") {
        body = "";
    }

    SUBCASE("non-JSON body") {
        body = "this is { not JSON ,,, \"unterminated";
    }

    SUBCASE("JSON body that is not an object (an array)") {
        body = "[ \"not\" , \"an\" , \"object\" ]";
    }

    SUBCASE("response_format json_object with no json_schema.schema") {
        body =
            "{ \"model\" : \"qwen3.6-27b\" , \"response_format\" : "
            "{ \"type\" : \"json_object\" } }";
    }

    SUBCASE("response_format json_schema with an empty schema object") {
        body =
            "{ \"model\" : \"qwen3.6-27b\" , \"response_format\" : "
            "{ \"type\" : \"json_schema\" , \"json_schema\" : { \"schema\" : { } } } }";
    }

    SUBCASE("empty grammar string") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"grammar\" : \"\" }";
    }

    SUBCASE("empty json_schema object") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"json_schema\" : { } }";
    }

    SUBCASE("response_format null") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"response_format\" : null }";
    }

    SUBCASE("response_format of the wrong type") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"response_format\" : \"json_schema\" }";
    }

    SUBCASE("grammar null") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"grammar\" : null }";
    }

    SUBCASE("grammar of the wrong type") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"grammar\" : 42 }";
    }

    SUBCASE("json_schema null") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"json_schema\" : null }";
    }

    SUBCASE("json_schema of the wrong type") {
        body = "{ \"model\" : \"qwen3.6-27b\" , \"json_schema\" : [ \"array\" ] }";
    }

    // The pure predicate.
    const SchemaObservation pure = observe_request(taggedTags(), body);
    CHECK(pure.tagged);
    CHECK(pure.schemaMissing);
    CHECK_FALSE(pure.declaredSchema.has_value());
    CHECK_FALSE(pure.schemaConformed.has_value());

    // End-to-end under the shipped default config: proxied untouched — the
    // G5 law — and counted exactly once.
    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const SchemaObservation observation =
        proxiedUntouched(router, client, upstream, taggedHeaders(), body, kUpstreamAnswer);
    CHECK(observation.tagged);
    CHECK(observation.schemaMissing);
    CHECK_FALSE(observation.declaredSchema.has_value());
    CHECK(router.schema_missing_count() == 1);
}

TEST_CASE(
    "[11.6-untagged-untouched] an untagged request — absent header, empty header value, or a "
    "value other than 'required' — is proxied untouched, observed tagged:false and "
    "schemaMissing:false, never validated and never counted, under BOTH rejectOnMissing "
    "postures") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    // The tag-value predicate on the pure seam. "required" is the only value
    // the sole producer (inject.ts headersFor) ever mints.
    {
        const RequestTags untagged{};
        const SchemaObservation none = observe_request(untagged, kSchemalessBody);
        CHECK_FALSE(none.tagged);
        CHECK_FALSE(none.schemaMissing);

        const SchemaObservation withSchemaBody =
            observe_request(untagged, responseFormatBody(verdictSchema));
        CHECK_FALSE(withSchemaBody.tagged);
        CHECK_FALSE(withSchemaBody.schemaMissing);

        // Some OTHER engaged value declares nothing 11.6 knows how to
        // observe; the narrow reading keeps rejectOnMissing:true from ever
        // 400ing a value the producer never meant as a schema demand.
        RequestTags otherValue;
        otherValue.schema = "optional";
        const SchemaObservation other = observe_request(otherValue, kSchemalessBody);
        CHECK_FALSE(other.tagged);
        CHECK_FALSE(other.schemaMissing);

        // Case-insensitive comparison closes a proxy-normalization surprise
        // without widening the value set.
        RequestTags mixedCase;
        mixedCase.schema = "Required";
        CHECK(observe_request(mixedCase, kSchemalessBody).tagged);
    }

    // End-to-end under BOTH postures: the opt-in 400 applies ONLY to tagged
    // requests, so everything below behaves identically either way.
    //
    // The stub answers with a chat.completion whose output text would FAIL
    // validation — a router that validated an untagged response anyway would
    // engage schemaConformed, which is exactly what the row forbids.
    const std::string validatedAnswer =
        chatCompletionBody("not JSON output — this text would fail any validator");

    for (const bool rejectOnMissing : { false, true }) {
        INFO("schema.rejectOnMissing = ", rejectOnMissing);

        StubUpstream upstream;
        answerWith(upstream, validatedAnswer);
        upstream.start();

        conductor::router::RouterConfig config = makeConfig(upstream.port());
        config.schema.rejectOnMissing = rejectOnMissing;

        conductor::router::Router router(config);
        router.start();

        httplib::Client client(kHost, router.listen_port());
        configureClient(client);

        // (1) No header at all, but the body DOES carry a response_format
        // schema: untagged, unmissing, and NO response validation attempted.
        const SchemaObservation untagged = proxiedUntouched(
            router, client, upstream, httplib::Headers{}, responseFormatBody(verdictSchema),
            validatedAnswer);
        CHECK_FALSE(untagged.tagged);
        CHECK_FALSE(untagged.schemaMissing);
        CHECK_FALSE(untagged.schemaConformed.has_value());
        CHECK(router.schema_missing_count() == 0);

        // (2) The header present with an EMPTY value — the boundary 11.3's
        // readHeaderTag already drops.
        const SchemaObservation emptyValue = proxiedUntouched(
            router, client, upstream, httplib::Headers{ { "X-Conductor-Schema", "" } },
            kSchemalessBody, validatedAnswer);
        CHECK_FALSE(emptyValue.tagged);
        CHECK_FALSE(emptyValue.schemaMissing);
        CHECK(router.schema_missing_count() == 0);

        // (3) An engaged tag with some other value is observed untagged.
        const SchemaObservation otherValue = proxiedUntouched(
            router, client, upstream, httplib::Headers{ { "X-Conductor-Schema", "optional" } },
            kSchemalessBody, validatedAnswer);
        CHECK_FALSE(otherValue.tagged);
        CHECK_FALSE(otherValue.schemaMissing);
        CHECK(router.schema_missing_count() == 0);
    }
}

TEST_CASE(
    "[11.6-counter-discriminates] schema_missing_count() counts tagged-and-missing requests and "
    "nothing else, monotonically, per Router instance, while last_schema_observation() reflects "
    "the most recent request only") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    // Zero on a freshly constructed Router, and no observation before any
    // /v1/* request has been handled — mirroring last_request_tags().
    CHECK(router.schema_missing_count() == 0);
    CHECK_FALSE(router.last_schema_observation().has_value());

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const struct {
        const char* label;
        httplib::Headers headers;
        std::string body;
        std::uint64_t expectedCount;
    } sequence[] = {
        { "tagged + missing", taggedHeaders(), kSchemalessBody, 1 },
        { "tagged + response_format schema", taggedHeaders(), responseFormatBody(verdictSchema),
          1 },
        { "untagged + missing", httplib::Headers{}, kSchemalessBody, 1 },
        { "tagged + missing again", taggedHeaders(), kSchemalessBody, 2 },
        { "untagged + json_schema", httplib::Headers{}, topLevelJsonSchemaBody(verdictSchema),
          2 },
        { "tagged + grammar", taggedHeaders(), kGrammarBody, 2 },
    };

    std::uint64_t previous = 0;
    for (const auto& step : sequence) {
        INFO("step: ", step.label);
        const auto result = client.Post(kChatPath, step.headers, step.body, "application/json");
        REQUIRE(result);
        CHECK(result->status == 200);

        const std::uint64_t count = router.schema_missing_count();
        CHECK(count == step.expectedCount);
        // Monotonic: never decreased, never reset by any request.
        CHECK(count >= previous);
        previous = count;
    }

    // The LAST request only: tagged, grammar arm — a declared constraint, so
    // nothing is missing and no JSON Schema is extractable.
    const SchemaObservation last = lastObservation(router);
    CHECK(last.tagged);
    CHECK_FALSE(last.schemaMissing);
    CHECK_FALSE(last.declaredSchema.has_value());

    // Per-instance state, not process-global: a second Router starts at zero.
    conductor::router::Router fresh(makeConfig(upstream.port()));
    CHECK(fresh.schema_missing_count() == 0);
    CHECK_FALSE(fresh.last_schema_observation().has_value());
}

TEST_CASE(
    "[11.6-observe-header-from-config] the tag is read through 11.3's normalized "
    "RequestTags.schema under the CONFIGURED observe header, and the x_conductor body fallback "
    "observes against the post-strip body the upstream receives") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    // Phase 1: the deployment renamed the header. Only the configured name
    // tags; the shipped name under this config is just another header — the
    // proof that 11.6 consumes RequestTags rather than re-reading the wire.
    {
        StubUpstream upstream;
        answerWith(upstream, kUpstreamAnswer);
        upstream.start();

        conductor::router::RouterConfig config = makeConfig(upstream.port());
        config.schema.observeHeader = "X-Fleet-Schema";

        conductor::router::Router router(config);
        router.start();

        httplib::Client client(kHost, router.listen_port());
        configureClient(client);

        const SchemaObservation renamed = proxiedUntouched(
            router, client, upstream, httplib::Headers{ { "X-Fleet-Schema", "required" } },
            kSchemalessBody, kUpstreamAnswer);
        CHECK(renamed.tagged);
        CHECK(renamed.schemaMissing);
        CHECK(router.schema_missing_count() == 1);

        const SchemaObservation shippedName = proxiedUntouched(
            router, client, upstream, taggedHeaders(), kSchemalessBody, kUpstreamAnswer);
        CHECK_FALSE(shippedName.tagged);
        CHECK_FALSE(shippedName.schemaMissing);
        CHECK(router.schema_missing_count() == 1);
    }

    // Phase 2: the shipped config, with the tag arriving ONLY via the
    // x_conductor body fallback. The presence predicate runs against the
    // POST-STRIP body the upstream actually receives; the strip forces one
    // re-serialize, so the stub assertion is JSON-equality with (original
    // minus x_conductor) — the 11.3-xconductor-strip idiom.
    {
        StubUpstream upstream;
        answerWith(upstream, kUpstreamAnswer);
        upstream.start();

        conductor::router::Router router(makeConfig(upstream.port()));
        router.start();

        httplib::Client client(kHost, router.listen_port());
        configureClient(client);

        json declared;
        declared["model"] = kModel;
        declared["messages"] =
            json::array({ json{ { "role", "user" }, { "content", "fallback tagged" } } });
        declared["json_schema"] = verdictSchema;
        declared[conductor::router::kParamsFallbackField] = json{ { "schema", "required" } };

        const auto declaredResult =
            client.Post(kChatPath, httplib::Headers{}, declared.dump(), "application/json");
        REQUIRE(declaredResult);
        CHECK(declaredResult->status == 200);

        REQUIRE(upstream.requestCount() == 1);
        const json observedBody =
            json::parse(upstream.request(0).body, nullptr, /*allow_exceptions=*/false);
        REQUIRE_FALSE(observedBody.is_discarded());
        CHECK_FALSE(observedBody.contains(conductor::router::kParamsFallbackField));

        json expectedForward = declared;
        expectedForward.erase(conductor::router::kParamsFallbackField);
        CHECK(observedBody == expectedForward);

        const SchemaObservation declaredObservation = lastObservation(router);
        CHECK(declaredObservation.tagged);
        CHECK_FALSE(declaredObservation.schemaMissing);
        REQUIRE(declaredObservation.declaredSchema.has_value());
        CHECK(*declaredObservation.declaredSchema == verdictSchema);
        CHECK(router.schema_missing_count() == 0);

        // The same fallback tag with no declaration is tagged-and-missing.
        json bare;
        bare["model"] = kModel;
        bare["messages"] =
            json::array({ json{ { "role", "user" }, { "content", "fallback tagged" } } });
        bare[conductor::router::kParamsFallbackField] = json{ { "schema", "required" } };

        const auto bareResult =
            client.Post(kChatPath, httplib::Headers{}, bare.dump(), "application/json");
        REQUIRE(bareResult);
        CHECK(bareResult->status == 200);

        const SchemaObservation bareObservation = lastObservation(router);
        CHECK(bareObservation.tagged);
        CHECK(bareObservation.schemaMissing);
        CHECK(router.schema_missing_count() == 1);
    }
}

TEST_CASE(
    "[11.6-nonstream-verdict-verbatim] a tagged request declaring Verdict.schema.json records a "
    "conformance verdict for a non-stream response while the body returns byte-verbatim, in both "
    "the chat.completion and legacy completion envelope shapes") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");
    const std::string requestBody = responseFormatBody(verdictSchema);

    std::string outputText;
    bool expectedVerdict = false;

    SUBCASE("conforming Verdict text") {
        outputText = R"({"findingId":"F-1","upheld":true,"reasoning":"the finding holds"})";
        expectedVerdict = true;
    }

    SUBCASE("missing the required 'reasoning'") {
        outputText = R"({"findingId":"F-1","upheld":true})";
    }

    SUBCASE("extra property under additionalProperties:false") {
        outputText =
            R"({"findingId":"F-1","upheld":true,"reasoning":"holds","confidence":0.9})";
    }

    SUBCASE("output text that is not JSON at all") {
        outputText = "the finding is upheld, I am fairly sure";
    }

    std::mutex answerMutex;
    std::string answer;

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/.*", [&](const httplib::Request& request, httplib::Response& response) {
            upstream.record(request);
            std::string body;
            {
                const std::lock_guard<std::mutex> lock(answerMutex);
                body = answer;
            }

            response.set_content(body, "application/json");
        });
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const struct {
        const char* label;
        std::string responseBody;
    } shapes[] = {
        { "chat.completion choices[0].message.content", chatCompletionBody(outputText) },
        { "legacy completion choices[0].text", legacyCompletionBody(outputText) },
    };

    for (const auto& shape : shapes) {
        INFO("envelope shape: ", shape.label);
        {
            const std::lock_guard<std::mutex> lock(answerMutex);
            answer = shape.responseBody;
        }

        const auto result =
            client.Post(kChatPath, taggedHeaders(), requestBody, "application/json");
        REQUIRE(result);
        // The verdict is recorded WITHOUT touching the response: upstream
        // status, Content-Type and the exact bytes — never wrapped, never
        // re-serialized, never re-statused.
        CHECK(result->status == 200);
        CHECK(result->get_header_value("Content-Type") == "application/json");
        CHECK(result->body == shape.responseBody);

        const SchemaObservation observation = lastObservation(router);
        CHECK(observation.tagged);
        CHECK_FALSE(observation.schemaMissing);
        REQUIRE(observation.schemaConformed.has_value());
        CHECK(*observation.schemaConformed == expectedVerdict);

        // The identical verdict through the pure seam 11.7 will consume.
        const SchemaObservation pure = observe_request(taggedTags(), requestBody);
        CHECK(observe_response(pure, /*validateResponses=*/true, /*isStream=*/false,
                               shape.responseBody) == std::optional<bool>{ expectedVerdict });
    }

    // A schema was declared on every request here: nothing was "missing".
    CHECK(router.schema_missing_count() == 0);
}

TEST_CASE(
    "[11.6-conformance-unobservable-null] schemaConformed is an EMPTY optional — unobservable, "
    "distinct from false — whenever there is nothing to validate or no way to validate it, and "
    "the response still returns byte-verbatim every time") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    // Defaults describe the OBSERVABLE case; each SUBCASE breaks exactly one
    // link in the chain, so the empty verdict is attributable to that link.
    bool validateResponses = true;
    httplib::Headers headers = taggedHeaders();
    std::string requestBody = responseFormatBody(verdictSchema);
    std::string responseBody =
        chatCompletionBody(R"({"findingId":"F-1","upheld":true,"reasoning":"holds"})");

    SUBCASE("the request was untagged") {
        headers = {};
    }

    SUBCASE("the request was tagged but declared no schema") {
        requestBody = kSchemalessBody;
    }

    SUBCASE("grammar-only declaration (no JSON Schema to validate against)") {
        requestBody = kGrammarBody;
    }

    SUBCASE("schema.validateResponses is false (shipped default is true)") {
        validateResponses = false;
    }

    SUBCASE("the response body is not parseable JSON") {
        responseBody = "definitely not JSON { \"choices\"";
    }

    SUBCASE("an embeddings body carries no extractable output text") {
        responseBody =
            "{ \"object\" : \"list\" , \"data\" : [ { \"object\" : \"embedding\" , "
            "\"embedding\" : [ 0.1 , 0.2 ] , \"index\" : 0 } ] }";
    }

    SUBCASE("an error body carries no extractable output text") {
        responseBody =
            "{ \"error\" : { \"message\" : \"upstream complaint\" , "
            "\"type\" : \"server_error\" , \"code\" : 500 } }";
    }

    SUBCASE("an empty choices array carries no extractable output text") {
        responseBody = "{ \"object\" : \"chat.completion\" , \"choices\" : [ ] }";
    }

    SUBCASE("a declared schema the validator cannot compile") {
        // Load-bearing G5: a malformed request-embedded schema is logged and
        // observed as unobservable — it can NEVER turn a request the direct
        // path would have served into a failure.
        //
        // Vetted against the linked validator: set_root_schema THROWS on
        // {"required":42} (and on {"properties":42} and an unresolved $ref),
        // while the assertions file's illustrative {"type":42} COMPILES in
        // this build and validate-rejects every instance instead — that shape
        // belongs to the false-verdict bucket, not to this one.
        requestBody = responseFormatBody(json{ { "required", 42 } });
    }

    StubUpstream upstream;
    answerWith(upstream, responseBody);
    upstream.start();

    conductor::router::RouterConfig config = makeConfig(upstream.port());
    config.schema.validateResponses = validateResponses;

    conductor::router::Router router(config);
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Post(kChatPath, headers, requestBody, "application/json");
    REQUIRE(result);
    CHECK(result->status == 200);
    CHECK(result->body == responseBody);
    CHECK(result->get_header_value("Content-Type") == "application/json");

    const SchemaObservation observation = lastObservation(router);
    CHECK_FALSE(observation.schemaConformed.has_value());

    // The pure mirror of the same inputs.
    RequestTags tags;
    if (!headers.empty())
        tags.schema = "required";

    const SchemaObservation pure = observe_request(tags, requestBody);
    CHECK_FALSE(
        observe_response(pure, validateResponses, /*isStream=*/false, responseBody).has_value());
}

TEST_CASE(
    "[11.6-stream-verdict-null] a tagged schema-declaring request whose upstream streams SSE "
    "relays incrementally with bytes, order and content type unchanged while schemaConformed "
    "stays an empty optional") {
    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    // The wire-notes DISCOVERY (i) shape: chat.completion.chunk frames
    // terminated by data: [DONE].
    constexpr const char* kSseChunkOne =
        "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"{\\\"findingId\\\":\"}}]}\n\n";
    constexpr const char* kSseChunkTwo =
        "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"\\\"F-1\\\"}\"}}]}\n\n"
        "data: [DONE]\n\n";

    json streamRequest;
    streamRequest["model"] = kModel;
    streamRequest["messages"] =
        json::array({ json{ { "role", "user" }, { "content", "stream a verdict" } } });
    streamRequest["stream"] = true;
    streamRequest["stream_options"] = json{ { "include_usage", true } };
    streamRequest["response_format"] =
        json{ { "type", "json_schema" },
              { "json_schema", json{ { "name", "Verdict" }, { "schema", verdictSchema } } } };
    const std::string streamBody = streamRequest.dump();

    // The gate holds the stub's SECOND chunk until the test releases it, so
    // observing the first chunk client-side while the gate is still closed is
    // PROOF of incremental, unbuffered forwarding — no chunk was held back
    // for inspection.
    struct {
        std::mutex mutex;
        std::condition_variable releasedCv;
        bool releaseSecond{ false };
        std::atomic<bool> secondChunkWritten{ false };
    } gate;

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions", [&](const httplib::Request& request, httplib::Response& response) {
            upstream.record(request);
            response.set_chunked_content_provider(
                "text/event-stream", [&](std::size_t offset, httplib::DataSink& sink) {
                    if (offset == 0) {
                        sink.write(kSseChunkOne, std::string_view(kSseChunkOne).size());
                        return true;
                    }

                    {
                        std::unique_lock<std::mutex> lock(gate.mutex);
                        gate.releasedCv.wait(lock, [&] {
                            return gate.releaseSecond;
                        });
                    }

                    gate.secondChunkWritten = true;
                    sink.write(kSseChunkTwo, std::string_view(kSseChunkTwo).size());
                    sink.done();
                    return true;
                });
        });
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    std::mutex receivedMutex;
    std::string received;
    std::atomic<bool> sawFirstChunk{ false };
    std::optional<httplib::Result> resultSlot;

    std::thread clientThread([&] {
        httplib::Client client(kHost, router.listen_port());
        configureClient(client);
        resultSlot.emplace(client.Post(
            kChatPath, taggedHeaders(), streamBody, "application/json",
            [&](const char* data, std::size_t length) {
                const std::lock_guard<std::mutex> lock(receivedMutex);
                received.append(data, length);
                if (received.find(kSseChunkOne) != std::string::npos)
                    sawFirstChunk = true;

                return true;
            }));
    });

    const bool firstObservedInTime = waitUntil([&] {
        return sawFirstChunk.load();
    });

    // Snapshotted BEFORE the gate opens; releasing and joining happen
    // unconditionally so a failing run cannot wedge the stub or the client.
    const bool secondWrittenAtObservation = gate.secondChunkWritten.load();

    {
        const std::lock_guard<std::mutex> lock(gate.mutex);
        gate.releaseSecond = true;
    }

    gate.releasedCv.notify_all();
    clientThread.join();

    CHECK(firstObservedInTime);
    CHECK_FALSE(secondWrittenAtObservation);

    REQUIRE(resultSlot.has_value());
    const httplib::Result& result = *resultSlot;
    REQUIRE(result);
    CHECK(result->status == 200);
    CHECK(result->get_header_value("Content-Type") == "text/event-stream");

    {
        const std::lock_guard<std::mutex> lock(receivedMutex);
        CHECK(received == std::string(kSseChunkOne) + kSseChunkTwo);
    }

    const SchemaObservation observation = lastObservation(router);
    CHECK(observation.tagged);
    CHECK_FALSE(observation.schemaMissing);
    REQUIRE(observation.declaredSchema.has_value());
    CHECK(*observation.declaredSchema == verdictSchema);
    // Streamed ⇒ unobservable: no validator ran on streamed bytes.
    CHECK_FALSE(observation.schemaConformed.has_value());
    CHECK(router.schema_missing_count() == 0);

    // The pure half: a streamed body is unobservable whatever bytes it holds.
    const SchemaObservation pure = observe_request(taggedTags(), streamBody);
    CHECK_FALSE(observe_response(pure, /*validateResponses=*/true, /*isStream=*/true,
                                 std::string(kSseChunkOne) + kSseChunkTwo)
                    .has_value());

    // ORCHESTRATOR ADDITION (C-046). The check above cannot tell the isStream
    // gate from the envelope-parse gate: SSE bytes are not a JSON envelope, so
    // they yield an empty verdict for TWO independent reasons and removing the
    // isStream gate leaves this case green. The §4.4 rule being pinned is
    // "streamed ⇒ unobservable", so the discriminating input is a body that
    // WOULD have produced a verdict — a well-formed envelope whose content
    // conforms — presented as a stream. Task 11.7 is the first caller that can
    // hand exactly that (a buffered copy of a streamed body), which is why this
    // is closed now rather than left to be discovered there.
    json streamedEnvelope;
    streamedEnvelope["object"] = "chat.completion";
    streamedEnvelope["choices"] = json::array(
        { json{ { "index", 0 },
                { "message",
                  json{ { "role", "assistant" },
                        { "content",
                          R"({"findingId":"F-1","upheld":true,"reasoning":"the finding holds"})" } } } } });
    const std::string parseableStreamedBody = streamedEnvelope.dump();

    // Premise: identical bytes NOT marked as a stream DO produce a verdict, so
    // the only difference between the two calls below is the isStream flag.
    const std::optional<bool> nonStreamVerdict =
        observe_response(pure, /*validateResponses=*/true, /*isStream=*/false, parseableStreamedBody);
    REQUIRE(nonStreamVerdict.has_value());
    CHECK(*nonStreamVerdict);

    CHECK_FALSE(
        observe_response(pure, /*validateResponses=*/true, /*isStream=*/true, parseableStreamedBody)
            .has_value());
}

TEST_CASE(
    "[11.6-reject-on-missing-opt-in] schema.rejectOnMissing:true answers a tagged schema-less "
    "POST with the pinned 400 envelope, synchronously and without touching upstream or "
    "admission, while everything else — tagged-with-schema, untagged, and GET — proxies "
    "normally") {
    // The published constants follow 11.4's string-code convention.
    CHECK(std::string(conductor::router::kSchemaErrorType) == "invalid_request_error");
    CHECK(std::string(conductor::router::kSchemaMissingCode) == "schema_missing");

    const json verdictSchema = readExportedSchema("Verdict.schema.json");

    // A stub that HOLDS any request whose body says so, so the single
    // admission slot can be pinned busy while the 400 is provoked.
    struct Gate {
        std::mutex mutex;
        std::condition_variable cv;
        bool released{ false };
    } gate;

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/.*", [&](const httplib::Request& request, httplib::Response& response) {
            upstream.record(request);
            const json body = json::parse(request.body, nullptr, /*allow_exceptions=*/false);
            const bool hold =
                !body.is_discarded() && body.is_object() && body.value("hold", false);
            if (hold) {
                std::unique_lock<std::mutex> lock(gate.mutex);
                gate.cv.wait(lock, [&] {
                    return gate.released;
                });
            }

            response.set_content(R"({"served":true})", "application/json");
        });
    upstream.server().Get(
        kModelsPath, [&](const httplib::Request& request, httplib::Response& response) {
            upstream.record(request);
            response.set_content(R"({"object":"list","data":[]})", "application/json");
        });
    upstream.start();

    conductor::router::RouterConfig config = makeConfig(upstream.port());
    config.schema.rejectOnMissing = true;
    // ONE in-flight slot, and a queue timeout that only bounds a FAILING run:
    // a 400 that wrongly went through admission would surface as a 503 here
    // rather than wedging ctest.
    config.admission = { 1, 8, 30000 };

    conductor::router::Router router(config);
    router.start();

    // An UNTAGGED held request occupies the only slot (untagged is exempt
    // from the posture, so it crosses and parks at the stub).
    const std::string holdBody =
        R"({"model":"qwen3.6-27b","hold":true,"messages":[{"role":"user","content":"hold"}]})";

    std::optional<httplib::Result> heldResult;
    std::thread heldThread([&] {
        httplib::Client heldClient(kHost, router.listen_port());
        heldClient.set_connection_timeout(10, 0);
        heldClient.set_read_timeout(60, 0);
        heldClient.set_write_timeout(60, 0);
        heldResult.emplace(
            heldClient.Post(kChatPath, httplib::Headers{}, holdBody, "application/json"));
    });

    // Frees the hold and joins the client when the scope unwinds — including
    // on a failed REQUIRE — so a failing run cannot deadlock the teardown.
    struct HoldRelease {
        Gate& gate;
        std::thread& thread;

        HoldRelease(Gate& g, std::thread& t)
            : gate(g)
            , thread(t) {
        }

        ~HoldRelease() {
            {
                const std::lock_guard<std::mutex> lock(gate.mutex);
                gate.released = true;
            }

            gate.cv.notify_all();
            if (thread.joinable())
                thread.join();
        }

        HoldRelease(const HoldRelease&) = delete;
        HoldRelease& operator=(const HoldRelease&) = delete;
    } holdRelease(gate, heldThread);

    REQUIRE(waitUntil([&upstream] {
        return upstream.requestCount() == 1;
    }));

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // The tagged schema-less POST is refused SYNCHRONOUSLY while the slot is
    // held: it never queued, never consumed a slot, never crossed upstream.
    const auto rejected =
        client.Post(kChatPath, taggedHeaders(), kSchemalessBody, "application/json");
    REQUIRE(rejected);
    CHECK(rejected->status == 400);
    CHECK(rejected->get_header_value("Content-Type") == "application/json");

    const json envelope = json::parse(rejected->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(envelope.is_discarded());
    REQUIRE(envelope.contains("error"));
    REQUIRE(envelope["error"].is_object());
    CHECK(envelope["error"]["type"] == "invalid_request_error");
    CHECK(envelope["error"]["code"] == "schema_missing");

    const std::string message = envelope["error"].value("message", std::string());
    INFO("400 envelope message: '", message, "'");
    // An operator reading the message learns WHICH header was expected and
    // WHICH config key produced a refusal the base build never makes.
    CHECK(mentions(message, "X-Conductor-Schema"));
    CHECK(mentions(message, "schema.rejectOnMissing"));

    CHECK(router.admission().queued_count() == 0);
    CHECK(upstream.requestCount() == 1);  // Zero hits for the refused request.
    // The refusal is a posture; the count is an observation, and it advances
    // regardless.
    CHECK(router.schema_missing_count() == 1);

    // Free the slot and let the held request finish with the stub's answer.
    {
        const std::lock_guard<std::mutex> lock(gate.mutex);
        gate.released = true;
    }

    gate.cv.notify_all();
    heldThread.join();
    REQUIRE(heldResult.has_value());
    REQUIRE(*heldResult);
    CHECK((*heldResult)->status == 200);

    // Under the SAME config, a tagged request WITH a schema field proxies.
    const auto declared = client.Post(kChatPath, taggedHeaders(),
                                      responseFormatBody(verdictSchema), "application/json");
    REQUIRE(declared);
    CHECK(declared->status == 200);
    CHECK(upstream.requestCount() == 2);
    CHECK(router.schema_missing_count() == 1);

    // ... an untagged request proxies ...
    const auto untagged =
        client.Post(kChatPath, httplib::Headers{}, kSchemalessBody, "application/json");
    REQUIRE(untagged);
    CHECK(untagged->status == 200);
    CHECK(upstream.requestCount() == 3);
    CHECK(router.schema_missing_count() == 1);

    // ... and a tagged schema-less GET /v1/models proxies: the 400 is
    // POST-only, for the same G5 reason SG-6 keeps GET out of admission.
    const auto models = client.Get(kModelsPath, taggedHeaders());
    REQUIRE(models);
    CHECK(models->status == 200);
    CHECK(upstream.requestCount() == 4);
    // Observation still runs on every /v1/* request: a bodyless tagged GET is
    // tagged-and-missing, so the COUNT advances — the 400 is what GET is
    // exempt from, never the observation.
    CHECK(router.schema_missing_count() == 2);
}

TEST_CASE(
    "[11.6-default-config-observes] the shipped section 2.2 document parses to observe-not-"
    "enforce — rejectOnMissing false, also when omitted — and a Router built from that parsed "
    "config serves a tagged schema-less request with the upstream's status, never a 400") {
    const std::filesystem::path schemaPath = repoPath("router/tests/schemas/RouterConfig.schema.json");
    INFO("RouterConfig schema: ", schemaPath.string());
    REQUIRE(std::filesystem::exists(schemaPath));

    // The §2.2 document verbatim through Task 11.2's parseRouterConfig.
    const conductor::router::RouterConfig parsed =
        conductor::router::parseRouterConfig(kSection22ConfigText, schemaPath.string());
    CHECK(parsed.schema.observeHeader == "X-Conductor-Schema");
    CHECK(parsed.schema.validateResponses == true);
    CHECK(parsed.schema.rejectOnMissing == false);

    // A document omitting rejectOnMissing entirely also yields false — the
    // parse's documented-optional default fill, not an accident of the text.
    json omitting = json::parse(kSection22ConfigText);
    omitting["schema"].erase("rejectOnMissing");
    const conductor::router::RouterConfig defaulted =
        conductor::router::parseRouterConfig(omitting.dump(), schemaPath.string());
    CHECK(defaulted.schema.rejectOnMissing == false);

    // BEHAVIOUR, not merely a field value: the Router runs with that parsed
    // config — only the endpoints redirected to this test's seams (listen 0 =
    // ephemeral port, upstream = the stub, ledger = temp dir), the schema
    // block untouched — and the tagged schema-less request comes back with
    // the UPSTREAM's answer.
    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::RouterConfig config = parsed;
    config.listen = { kHost, 0 };
    config.upstream = { kHost, upstream.port() };
    config.metrics = {
        (std::filesystem::temp_directory_path() / "conductor-router-11.6" / "metrics.jsonl")
            .string()
    };

    conductor::router::Router router(config);
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const SchemaObservation observation = proxiedUntouched(
        router, client, upstream, taggedHeaders(), kSchemalessBody, kUpstreamAnswer);
    CHECK(observation.tagged);
    CHECK(observation.schemaMissing);
    CHECK(router.schema_missing_count() == 1);
}

TEST_CASE(
    "[11.6-exported-schema-usable] the exported section 2 schemas compile into the linked "
    "json-schema-validator despite carrying no $schema key, and their accept/reject verdicts are "
    "exactly the ones the schemas state") {
    // Verdict.schema.json: 3 required properties, additionalProperties:false.
    const json verdictSchema = readExportedSchema("Verdict.schema.json");
    CHECK_FALSE(verdictSchema.contains("$schema"));

    nlohmann::json_schema::json_validator verdictValidator;
    REQUIRE_NOTHROW(verdictValidator.set_root_schema(verdictSchema));

    const json conformingVerdict =
        json::parse(R"({"findingId":"F-7","upheld":false,"reasoning":"the claim does not hold"})");
    const json missingRequired = json::parse(R"({"findingId":"F-7","upheld":false})");
    const json extraProperty = json::parse(
        R"({"findingId":"F-7","upheld":false,"reasoning":"holds","confidence":0.9})");

    CHECK(conforms(verdictValidator, conformingVerdict));
    CHECK_FALSE(conforms(verdictValidator, missingRequired));
    CHECK_FALSE(conforms(verdictValidator, extraProperty));

    // Findings.schema.json as the second case: nested items with their own
    // required list and additionalProperties:false.
    const json findingsSchema = readExportedSchema("Findings.schema.json");
    CHECK_FALSE(findingsSchema.contains("$schema"));

    nlohmann::json_schema::json_validator findingsValidator;
    REQUIRE_NOTHROW(findingsValidator.set_root_schema(findingsSchema));

    const json conformingFindings = json::parse(
        R"({"findings":[{"id":"F-1","severity":"major","lens":"correctness","claim":"c","evidence":"e","suggestedFix":"s"}]})");
    const json missingFindings = json::parse(R"({})");
    const json extraTopLevel = json::parse(R"({"findings":[],"summary":"extra"})");
    const json itemMissingField = json::parse(
        R"({"findings":[{"id":"F-1","severity":"major","lens":"l","claim":"c","evidence":"e"}]})");

    CHECK(conforms(findingsValidator, conformingFindings));
    CHECK_FALSE(conforms(findingsValidator, missingFindings));
    CHECK_FALSE(conforms(findingsValidator, extraTopLevel));
    CHECK_FALSE(conforms(findingsValidator, itemMissingField));
}

TEST_CASE(
    "[11.6-shrunk-scope-note] the inertness of response observation on real fan-out traffic is "
    "recorded in docs/build/honest-limits-pending.md, citing the wire-notes record rather than "
    "re-deriving it") {
    const std::filesystem::path notePath = repoPath("docs/build/honest-limits-pending.md");
    INFO("honest-limits accumulator: ", notePath.string());
    REQUIRE(std::filesystem::exists(notePath));

    const std::string note = readFileText(notePath);
    // The note names its task ...
    CHECK(mentions(note, "11.6"));
    // ... cites the verified record instead of re-deriving it ...
    CHECK(mentions(note, "wire-notes"));
    // ... states the reason: session.prompt issues STREAMING provider
    // requests (DISCOVERY (i)) ...
    CHECK(mentions(note, "stream"));
    // ... so every fan-out schemaConformed is unobservable and the request-
    // side counter is the router's schema-conformance dataset.
    CHECK(mentions(note, "schemaConformed"));
    CHECK(mentions(note, "schemaMissing"));
}
