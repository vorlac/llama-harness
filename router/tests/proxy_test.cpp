// =============================================================================
// Task 11.3 — llama-router `router`: proxy pass-through.
//
// This suite is written RED: `router.hpp` does not exist yet, so this
// translation unit fails to COMPILE. That is the intended red shape. The API
// below is the exact target the implementer must produce — every name, type,
// and behaviour here is asserted by the cases in this file. One TEST_CASE per
// assertion id from task-11.3.assertions.json, named "[<id>] ...".
//
//   // router/router.hpp
//   #pragma once
//
//   #include <optional>
//   #include <string>
//
//   #include <nlohmann/json.hpp>
//
//   #include "router/config.hpp"
//
//   namespace conductor::router {
//
//   // Task 0.2's pinned body-field fallback name (conductor/tests/fixtures/
//   // wire-markers.ts PARAMS_FALLBACK_FIELD). The C++ literal must be the
//   // identical string.
//   inline constexpr const char* kParamsFallbackField = "x_conductor";
//
//   // The four §4.4 conductor tags in ONE normalized representation, whichever
//   // source supplied them: the X-Conductor-* headers minted by
//   // conductor/adapter/inject.ts headersFor, or the x_conductor body field.
//   // An absent tag is an empty optional.
//   struct RequestTags {
//     std::optional<std::string> role;
//     std::optional<std::string> priority;
//     std::optional<std::string> group;
//     std::optional<std::string> schema;
//
//     bool operator==(const RequestTags&) const = default;
//   };
//
//   // Body-field fallback extraction + stripping. ALWAYS removes a top-level
//   // "x_conductor" key from `body` when one exists. Tags are produced only
//   // when the key's payload is an object of string values
//   // {"role"?, "priority"?, "group"?, "schema"?}; any other payload extracts
//   // NOTHING (fail-open, spdlog-logged) yet the key is still stripped. A body
//   // without the key is left untouched and yields all-empty tags.
//   RequestTags extract_and_strip_tags(nlohmann::json& body);
//
//   // The §4.4 pass-through slice only — admission/affinity/schema-observer/
//   // metrics are Tasks 11.4-11.7 and are NOT part of this class yet.
//   //   - Constructed from Task 11.2's parsed RouterConfig (listen + upstream
//   //     endpoints). cfg.listen.port == 0 binds an OS-assigned ephemeral
//   //     port. Construction and start() need NO live upstream: the upstream
//   //     connection is made per proxied request.
//   //   - start(): binds cfg.listen, serves on a background thread, and
//   //     returns only once the listener is accepting connections. stop():
//   //     stops the listener and joins; the destructor stops a running router.
//   //   - listen_port(): the actually-bound listen port, valid after start().
//   //   - /v1/* requests are proxied to the upstream. Every path outside /v1/*
//   //     and the reserved /conductor/* prefix is answered 404 with zero
//   //     upstream contact. /conductor/* behaviour is deliberately NOT defined
//   //     here (Task 11.7 adds those endpoints).
//   //   - A request body with NO x_conductor key — including a non-JSON
//   //     body — is forwarded BYTE-verbatim (no parse→re-serialize mutation).
//   //     When the key is present, the forwarded body is the original minus
//   //     exactly that one key (a re-serialize is unavoidable there).
//   //     End-to-end headers cross unchanged in both directions; the upstream
//   //     status and body return verbatim, non-2xx included (G5: the router
//   //     never returns a status the direct path would not have returned, and
//   //     performs no request validation of any kind).
//   //   - Upstream connect failure ⇒ 502, Content-Type application/json, body
//   //     {"error":{"message":"<names upstream host:port + cause>",
//   //               "type":"router_upstream_unreachable","code":502}}.
//   //     Per-request, never latched, never a crash: the next request after
//   //     the upstream comes up proxies normally.
//   //   - SSE responses stream through unbuffered (httplib content
//   //     provider/receiver), chunk bytes and order preserved, Content-Type
//   //     text/event-stream preserved.
//   //   - last_request_tags(): the normalized RequestTags of the most recent
//   //     /v1/* request — std::nullopt until one has been handled; a tagless
//   //     or unparseable-body request yields an ENGAGED value with four empty
//   //     optionals. Per-tag, an X-Conductor-* header wins over the same key
//   //     in x_conductor; a body-only key still fills its tag; the field is
//   //     stripped regardless. This is the single normalized tag seam that
//   //     Tasks 11.4+ consume; 11.3 attaches no behaviour to the tags.
//   class Router {
//    public:
//     explicit Router(const RouterConfig& config);
//     ~Router();
//
//     Router(const Router&) = delete;
//     Router& operator=(const Router&) = delete;
//
//     void start();
//     void stop();
//
//     [[nodiscard]] int listen_port() const;
//     [[nodiscard]] std::optional<RequestTags> last_request_tags() const;
//   };
//
//   }  // namespace conductor::router
//
// This file's final home is router/tests/proxy_test.cpp; the module it
// exercises is router/router.{hpp,cpp}. CMake wiring is ORCHESTRATOR-ONLY:
// this file joins the router-tests target source list, router.cpp joins both
// llama-router and router-tests.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
// =============================================================================

#include <doctest/doctest.h>
#include <httplib.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "router/config.hpp"
#include "router/router.hpp"

namespace {

    using nlohmann::json;

    constexpr const char* kHost = "127.0.0.1";

    // The stub upstream is an in-process httplib::Server on an ephemeral port
    // (plan 2751-2753): no model, no llama-server. It records every request it
    // serves so the tests can assert exactly what crossed the proxy.
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

        // Register handlers on server() BEFORE calling start()/startOn().
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

        // Bind a caller-chosen port — used by the upstream-down case to bring the
        // upstream up on the exact port the router was configured with.
        void startOn(int port) {
            REQUIRE(server_.bind_to_port(kHost, port));
            port_ = port;
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

    // The Router consumes Task 11.2's PARSED RouterConfig — 11.3 never re-parses
    // config JSON, so the doctest builds the struct directly. listen.port 0 is the
    // pinned test-only "bind an ephemeral port" construction (parseRouterConfig's
    // 1..65535 range check applies to config files, not to this seam). The metrics
    // ledger path points into the OS temp dir: unit tests must never touch the
    // repo's .data tree, and 11.3 has no metrics module to write it anyway.
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
            (std::filesystem::temp_directory_path() / "conductor-router-11.3" / "metrics.jsonl")
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

    // Readiness poll on observable state (plan 2794-2795): the predicate is the
    // synchronization; the tiny sleep is only the poll interval, and the deadline
    // only bounds a FAILING run. No assertion in this suite rests on elapsed time.
    bool waitUntil(const std::function<bool()>& ready, std::chrono::milliseconds deadline = std::chrono::seconds{ 10 }) {
        const auto giveUp = std::chrono::steady_clock::now() + deadline;
        while (std::chrono::steady_clock::now() < giveUp) {
            if (ready())
                return true;

            std::this_thread::sleep_for(std::chrono::milliseconds{ 2 });
        }

        return ready();
    }

    // The four §4.4 tag values used consistently across the header path and the
    // body-field path, so the suite can assert both normalize IDENTICALLY. Values
    // mirror conductor/adapter/inject.ts headersFor and the §4.4 examples.
    conductor::router::RequestTags fullConductorTags() {
        conductor::router::RequestTags tags;
        tags.role = "reviewer";
        tags.priority = "review";
        tags.group = "run:r-1:review:I3";
        tags.schema = "required";
        return tags;
    }

    const httplib::Headers& fullConductorHeaders() {
        static const httplib::Headers headers = {
            { "X-Conductor-Role", "reviewer" },
            { "X-Conductor-Priority", "review" },
            { "X-Conductor-Group", "run:r-1:review:I3" },
            { "X-Conductor-Schema", "required" },
            { "Authorization", "Bearer conductor-test-token" },
        };
        return headers;
    }

    // Deliberately NON-canonical JSON: \r\n and tab whitespace, spaces inside
    // brackets, a \u escape nlohmann would rewrite as raw UTF-8, plus raw UTF-8 it
    // would keep — any parse→re-serialize inside the router changes these bytes,
    // so byte-equality at the stub proves the no-x_conductor path forwards the
    // ORIGINAL bytes.
    constexpr const char* kVerbatimBody =
        "{ \"model\" : \"qwen3.6-27b\" ,\r\n"
        "\t\"messages\" : [ { \"role\" : \"user\" , \"content\" : \"h\\u00e9llo — stays verbatim\" } ],\n"
        "  \"temperature\" : 0.25 , \"stream\" : false }";

    // A second, distinct non-canonical body for the header-only path.
    constexpr const char* kHeaderPathBody =
        "{\t\"model\":\"qwen3.6-27b\" ,\r\n"
        " \"messages\":[ {\"role\":\"user\",\"content\":\"header path — \\u2603\"} ] ,\n"
        " \"stream\" : false }";

    constexpr const char* kSimpleBody =
        R"({"model":"qwen3.6-27b","messages":[{"role":"user","content":"ping"}]})";

}  // namespace

TEST_CASE(
    "[11.3-post-forward-verbatim] POST /v1/chat/completions crosses with byte-identical "
    "body and unchanged end-to-end headers") {
    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content(R"({"ok":true})", "application/json");
        });
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Post("/v1/chat/completions", fullConductorHeaders(), kVerbatimBody,
                                    "application/json");
    REQUIRE(result);
    CHECK(result->status == 200);

    REQUIRE(upstream.requestCount() == 1);
    const CapturedRequest seen = upstream.request(0);
    CHECK(seen.method == "POST");
    CHECK(seen.path == "/v1/chat/completions");
    // No x_conductor key ⇒ the ORIGINAL bytes cross, byte-identical.
    CHECK(seen.body == kVerbatimBody);
    // Every pinned end-to-end header crosses with unchanged name+value
    // (hop-by-hop transport headers — Host, Content-Length, Connection — are
    // deliberately NOT asserted; they are necessarily the proxy client's own).
    CHECK(seen.header("X-Conductor-Role") == "reviewer");
    CHECK(seen.header("X-Conductor-Priority") == "review");
    CHECK(seen.header("X-Conductor-Group") == "run:r-1:review:I3");
    CHECK(seen.header("X-Conductor-Schema") == "required");
    CHECK(seen.header("Authorization") == "Bearer conductor-test-token");
    CHECK(seen.header("Content-Type") == "application/json");

    // The pinned lifecycle: stop() actually releases the listener, so a
    // post-stop connection is refused rather than served.
    router.stop();
    const auto afterStop =
        client.Post("/v1/chat/completions", fullConductorHeaders(), kVerbatimBody,
                    "application/json");
    CHECK(afterStop.error() != httplib::Error::Success);
}

TEST_CASE(
    "[11.3-response-verbatim-status] a non-2xx upstream response returns status, body and "
    "Content-Type untouched") {
    constexpr const char* kUpstream400Body =
        R"({"error":{"message":"upstream-error-marker: prompt exceeds context","type":"invalid_request_error","code":400}})";

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.status = 400;
            res.set_content(kUpstream400Body, "application/json");
        });
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Post(
        "/v1/chat/completions", fullConductorHeaders(),
        kSimpleBody, "application/json");

    REQUIRE(result);

    // G5 (plan 90-92): the status is forwarded AS-IS — never rewritten — and
    // the exact upstream body comes back with no router envelope around it.
    CHECK(result->status == 400);
    CHECK(result->body == kUpstream400Body);
    CHECK(result->get_header_value("Content-Type") == "application/json");
    CHECK(upstream.requestCount() == 1);
}

TEST_CASE(
    "[11.3-sse-incremental] SSE chunks stream through unbuffered: the first chunk is "
    "observed before the second is sent") {
    constexpr const char* kSseChunkOne = "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n";
    constexpr const char* kSseChunkTwo =
        "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n\n"
        "data: [DONE]\n\n";
    constexpr const char* kStreamRequestBody = R"({"model":"qwen3.6-27b","messages":[{"role":"user","content":"stream please"}],"stream":true})";

    // The gate holds the stub's SECOND chunk until the test releases it, so
    // observing the first chunk client-side while the gate is still closed is
    // PROOF of incremental, unbuffered forwarding.
    struct {
        std::mutex mutex;
        std::condition_variable releasedCv;
        bool releaseSecond{ false };
        std::atomic<bool> secondChunkWritten{ false };
    } gate;

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_chunked_content_provider(
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
            "/v1/chat/completions", httplib::Headers{}, kStreamRequestBody, "application/json",
            [&](const char* data, std::size_t length) {
                const std::lock_guard<std::mutex> lock(receivedMutex);
                received.append(data, length);
                if (received.find(kSseChunkOne) != std::string::npos) {
                    sawFirstChunk = true;
                }
                return true;
            }));
    });

    // Readiness poll on observed client-side state — no sleep-as-sync. The
    // second-chunk flag is snapshotted at the moment of observation, BEFORE
    // the gate opens; releasing and joining happen unconditionally so a
    // failing run cannot leave the stub or the client thread wedged.
    const bool firstObservedInTime = waitUntil([&] {
        return sawFirstChunk.load();
    });

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
    // Payload bytes and chunk order are preserved end-to-end.
    const std::lock_guard<std::mutex> lock(receivedMutex);
    CHECK(received == std::string(kSseChunkOne) + kSseChunkTwo);
}

TEST_CASE(
    "[11.3-non-v1-404] paths outside /v1/* are answered 404 by the router with zero upstream contact") {
    StubUpstream upstream;

    // Catch-alls: if the router forwarded ANYTHING, the stub would record it
    // and answer 200 — so the 404s below can only have come from the router.
    upstream.server().Get(
        ".*", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content("reached-upstream", "text/plain");
        });

    upstream.server().Post(
        ".*", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content("reached-upstream", "text/plain");
        });

    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto getFoo = client.Get("/foo");
    REQUIRE(getFoo);
    CHECK(getFoo->status == 404);

    const auto postApi = client.Post("/api/x", R"({"model":"qwen3.6-27b"})", "application/json");
    REQUIRE(postApi);
    CHECK(postApi->status == 404);

    CHECK(upstream.requestCount() == 0);
    // Deliberately NO request to /conductor/*: that prefix is reserved and its
    // behaviour lands at Task 11.7 — pinning it here would break that suite.
}

TEST_CASE(
    "[11.3-v1-wildcard] pass-through covers /v1/* generally: GET /v1/models proxies with "
    "status and body verbatim") {
    constexpr const char* kModelsBody =
        R"({"object":"list","data":[{"id":"qwen3.6-27b","object":"model"}]})";

    StubUpstream upstream;
    upstream.server().Get("/v1/models", [&](const httplib::Request& req, httplib::Response& res) {
        upstream.record(req);
        res.set_content(kModelsBody, "application/json");
    });
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Get("/v1/models");
    REQUIRE(result);
    CHECK(result->status == 200);
    CHECK(result->body == kModelsBody);
    CHECK(result->get_header_value("Content-Type") == "application/json");

    REQUIRE(upstream.requestCount() == 1);
    const CapturedRequest seen = upstream.request(0);
    CHECK(seen.method == "GET");
    CHECK(seen.path == "/v1/models");
}

TEST_CASE(
    "[11.3-upstream-down-502] a dead upstream is a per-request 502 JSON envelope, never a "
    "crash or a latched failure") {
    // Reserve a genuinely-free port by binding an ephemeral listener and
    // stopping it: httplib's stop() releases the descriptor, so connections to
    // the port are refused afterwards.
    int upstreamPort = 0;
    {
        StubUpstream reserver;
        reserver.start();
        upstreamPort = reserver.port();
        reserver.stop();
    }

    conductor::router::Router router(makeConfig(upstreamPort));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto down = client.Post(
        "/v1/chat/completions", kSimpleBody,
        "application/json");

    REQUIRE(down);
    CHECK(down->status == 502);
    CHECK(down->get_header_value("Content-Type") == "application/json");

    json envelope = json::parse(down->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(envelope.is_discarded());
    REQUIRE(envelope.contains("error"));
    REQUIRE(envelope["error"].is_object());
    CHECK(envelope["error"]["type"] == "router_upstream_unreachable");
    CHECK(envelope["error"]["code"] == 502);
    const std::string message = envelope["error"].value("message", std::string());
    INFO("502 envelope message: '", message, "'");
    CHECK(mentions(message, kHost));
    CHECK(mentions(message, std::to_string(upstreamPort)));

    // The SAME router instance recovers the moment something listens on the
    // configured port: the 502 was per-request, not a latched failure.
    StubUpstream revived;
    revived.server().Post(
        "/v1/chat/completions",
        [&](const httplib::Request& req, httplib::Response& res) {
            revived.record(req);
            res.set_content(R"({"revived":true})", "application/json");
        });

    revived.startOn(upstreamPort);

    const auto up = client.Post("/v1/chat/completions", kSimpleBody, "application/json");
    REQUIRE(up);
    CHECK(up->status == 200);
    CHECK(up->body == R"({"revived":true})");
    CHECK(revived.requestCount() == 1);
}

TEST_CASE(
    "[11.3-xconductor-extract] the pinned x_conductor body field normalizes into "
    "RequestTags; malformed payloads extract nothing yet still strip") {
    using conductor::router::extract_and_strip_tags;
    using conductor::router::RequestTags;

    // The C++ literal is the identical string Task 0.2 pinned
    // (conductor/tests/fixtures/wire-markers.ts PARAMS_FALLBACK_FIELD).
    CHECK(std::string(conductor::router::kParamsFallbackField) == "x_conductor");

    const RequestTags fullTags = fullConductorTags();
    const RequestTags emptyTags{};

    // --- The free-function surface first: extraction + stripping in one step.
    {
        json body = json::parse(R"({"model":"m","messages":[],"x_conductor":{"role":"reviewer","priority":"review","group":"run:r-1:review:I3","schema":"required"}})");
        const RequestTags tags = extract_and_strip_tags(body);
        CHECK(tags == fullTags);
        CHECK_FALSE(body.contains("x_conductor"));
        CHECK(body == json::parse(R"({"model":"m","messages":[]})"));
    }
    {
        // Partial payload: only the present keys become tags.
        json body = json::parse(R"({"model":"m","x_conductor":{"priority":"batch"}})");
        const RequestTags tags = extract_and_strip_tags(body);
        RequestTags expected;
        expected.priority = "batch";
        CHECK(tags == expected);
        CHECK(body == json::parse(R"({"model":"m"})"));
    }
    {
        // Malformed (non-object) payload — the exact Task 0.2 probe value:
        // nothing extracted (fail-open), the field STILL stripped.
        json body = json::parse(R"({"model":"m","x_conductor":"params-fallback-probe"})");
        const RequestTags tags = extract_and_strip_tags(body);
        CHECK(tags == emptyTags);
        CHECK(body == json::parse(R"({"model":"m"})"));
    }
    {
        // No field: the body is untouched and no tags are produced.
        json body = json::parse(R"({"model":"m","stream":true})");
        const RequestTags tags = extract_and_strip_tags(body);
        CHECK(tags == emptyTags);
        CHECK(body == json::parse(R"({"model":"m","stream":true})"));
    }

    // --- End-to-end: the ROUTER normalizes the field into last_request_tags().
    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions",
        [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content(R"({"ok":true})", "application/json");
        });

    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    // Before any /v1/* request the seam is disengaged.
    CHECK_FALSE(router.last_request_tags().has_value());

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto tagged = client.Post(
        "/v1/chat/completions",
        R"({"model":"m","messages":[],"x_conductor":{"role":"reviewer","priority":"review","group":"run:r-1:review:I3","schema":"required"}})",
        "application/json");

    REQUIRE(tagged);
    CHECK(tagged->status == 200);
    const auto taggedSeen = router.last_request_tags();
    REQUIRE(taggedSeen.has_value());
    CHECK(*taggedSeen == fullTags);

    // Malformed payload through the router: engaged-but-empty tags, and the
    // field is still stripped from what the stub observes.
    const auto malformed = client.Post(
        "/v1/chat/completions",
        R"({"model":"m","x_conductor":42})", "application/json");

    REQUIRE(malformed);
    CHECK(malformed->status == 200);
    const auto malformedSeen = router.last_request_tags();
    REQUIRE(malformedSeen.has_value());
    CHECK(*malformedSeen == emptyTags);

    REQUIRE(upstream.requestCount() == 2);
    const json malformedUpstreamBody = json::parse(upstream.request(1).body);
    CHECK_FALSE(malformedUpstreamBody.contains("x_conductor"));
    CHECK(malformedUpstreamBody == json::parse(R"({"model":"m"})"));
}

TEST_CASE(
    "[11.3-xconductor-strip] the upstream-observed body is the original minus exactly the "
    "x_conductor key") {
    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content(R"({"ok":true})", "application/json");
        });

    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const json original = json::parse(R"({
        "model": "qwen3.6-27b",
        "messages": [{"role": "user", "content": "strip me"}],
        "stream": false,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "verdict", "schema": {"type": "object"}}
        },
        "temperature": 0.25,
        "x_conductor": {"role": "reviewer", "priority": "review",
                        "group": "run:r-1:review:I3", "schema": "required"}
    })");

    const auto result = client.Post("/v1/chat/completions", original.dump(), "application/json");
    REQUIRE(result);
    CHECK(result->status == 200);

    REQUIRE(upstream.requestCount() == 1);
    const CapturedRequest seen = upstream.request(0);
    CHECK(seen.header("Content-Type") == "application/json");

    const json observed = json::parse(seen.body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(observed.is_discarded());
    CHECK_FALSE(observed.contains("x_conductor"));

    // JSON-equality with (original minus x_conductor): stripping removed
    // exactly the fallback field — model, messages, stream, response_format
    // and every other field survive. (Byte-equality is impossible here: the
    // strip forces one re-serialize; the byte-identity law lives on the
    // no-field path, asserted by 11.3-post-forward-verbatim and
    // 11.3-header-path-untouched.)
    json expected = original;
    expected.erase("x_conductor");
    CHECK(observed == expected);
}

TEST_CASE(
    "[11.3-header-path-untouched] a headers-only request crosses byte-identical and yields "
    "the same RequestTags; headers win per-tag when both sources are present") {
    StubUpstream upstream;
    upstream.server().Post(
        "/v1/chat/completions",
        [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content(R"({"ok":true})", "application/json");
        });

    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // --- The production path (plan 2798-2799): tags via X-Conductor-* headers
    // only, body carrying no x_conductor key.
    const auto viaHeaders = client.Post(
        "/v1/chat/completions", fullConductorHeaders(),
        kHeaderPathBody, "application/json");

    REQUIRE(viaHeaders);
    CHECK(viaHeaders->status == 200);

    REQUIRE(upstream.requestCount() == 1);
    const CapturedRequest headerSeen = upstream.request(0);
    // No field ⇒ no parse/re-serialize mutation: the exact bytes cross.
    CHECK(headerSeen.body == kHeaderPathBody);
    CHECK(headerSeen.header("X-Conductor-Role") == "reviewer");
    CHECK(headerSeen.header("X-Conductor-Priority") == "review");
    CHECK(headerSeen.header("X-Conductor-Group") == "run:r-1:review:I3");
    CHECK(headerSeen.header("X-Conductor-Schema") == "required");

    // The header path normalizes into the IDENTICAL RequestTags value the
    // body-field fallback yields (11.3-xconductor-extract uses the same four
    // values) — one tag surface for Tasks 11.4+, regardless of source.
    const auto headerTags = router.last_request_tags();
    REQUIRE(headerTags.has_value());
    CHECK(*headerTags == fullConductorTags());

    // --- Both sources present (pinned gap resolution): per-tag the header
    // wins, a body-only key still fills its tag, the field is stripped anyway.
    const httplib::Headers partialHeaders = {
        { "X-Conductor-Role", "implementer" },
        { "X-Conductor-Priority", "interactive" },
    };

    const auto bothSources = client.Post(
        "/v1/chat/completions", partialHeaders,
        R"({"model":"m","x_conductor":{"role":"reviewer","group":"run:r-9:batch:I1"}})",
        "application/json");

    REQUIRE(bothSources);
    CHECK(bothSources->status == 200);

    conductor::router::RequestTags merged;
    merged.role = "implementer";        // in both — the HEADER value wins
    merged.priority = "interactive";    // header-only — kept
    merged.group = "run:r-9:batch:I1";  // body-only — still fills its tag

    const auto mergedSeen = router.last_request_tags();

    REQUIRE(mergedSeen.has_value());
    CHECK(*mergedSeen == merged);

    REQUIRE(upstream.requestCount() == 2);

    const json bothBody = json::parse(
        upstream.request(1).body, nullptr,
        /*allow_exceptions=*/false);

    REQUIRE_FALSE(bothBody.is_discarded());
    CHECK_FALSE(bothBody.contains("x_conductor"));
    CHECK(bothBody == json::parse(R"({"model":"m"})"));
}

TEST_CASE(
    "[11.3-fail-open-nonjson] a non-JSON body is forwarded byte-verbatim — extraction "
    "failure is never a router-origin error") {
    constexpr const char* kNotJson =
        "this is { not JSON ,,, \"unterminated — the proxy path performs no validation";

    StubUpstream upstream;
    upstream.server().Post(
        ".*", [&](const httplib::Request& req, httplib::Response& res) {
            upstream.record(req);
            res.set_content(R"({"served":"anyway"})", "application/json");
        });

    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Post(
        "/v1/chat/completions", kNotJson,
        "application/json");

    REQUIRE(result);
    // G5 law (plan 87-94, 224-228): no request the direct path would have
    // served is ever rejected by the router — the parse failure inside the
    // extraction step must not surface as any router-origin 4xx/5xx.
    CHECK(result->status == 200);
    CHECK(result->body == R"({"served":"anyway"})");

    REQUIRE(upstream.requestCount() == 1);
    const CapturedRequest seen = upstream.request(0);
    CHECK(seen.path == "/v1/chat/completions");
    CHECK(seen.body == kNotJson);

    // Fail-open extraction: the unparseable body yields engaged-but-empty
    // tags, not a crash and not a rejection.
    const conductor::router::RequestTags emptyTags{};
    const auto tags = router.last_request_tags();
    REQUIRE(tags.has_value());
    CHECK(*tags == emptyTags);
}
