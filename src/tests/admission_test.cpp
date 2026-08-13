// =============================================================================
// Task 11.4 — llama-router `admission`: per-model caps, priority queueing,
// queue timeout / overflow 503s, and a health endpoint that survives a full
// queue.
//
// This suite is written RED: `router/admission.hpp` does not exist yet, so this
// translation unit fails to COMPILE. That is the intended red shape. The API
// below is the exact target the implementer must produce — every name, type and
// behaviour here is asserted by the cases in this file. One TEST_CASE per
// assertion id from docs/build/specs/task-11.4.assertions.json, named
// "[<id>] ...".
//
//   // src/router/admission.hpp   (HEADER-ONLY, matching 11.2 and 11.3)
//   #pragma once
//
//   #include <cstddef>
//   #include <optional>
//   #include <string>
//
//   #include "router/config.hpp"
//
//   namespace conductor::router {
//
//   // SG-5: the minimal health route 11.4 owns; 11.7 extends the BODY on this
//   // same route without changing its pool-exhaustion property.
//   inline constexpr const char* kHealthPath = "/conductor/health";
//
//   // SG-1's pinned 503 envelope, the OpenAI-compatible shape llama-server
//   // itself emits: {"error":{"message":…,"type":"unavailable_error",
//   //                          "code":"queue_timeout"|"queue_overflow"}}.
//   inline constexpr const char* kAdmissionErrorType  = "unavailable_error";
//   inline constexpr const char* kQueueTimeoutCode    = "queue_timeout";
//   inline constexpr const char* kQueueOverflowCode   = "queue_overflow";
//
//   // SG-2: the fixed thread budget the maxQueued clamp is measured against,
//   // and the +8 margin of the plan's threads >= maxQueued +
//   // sum(maxInflightPerModel) + 8.
//   inline constexpr int kAdmissionThreadBudget = 256;
//   inline constexpr int kTaskQueueThreadMargin = 8;
//
//   enum class AdmissionOutcome { Admitted, TimedOut, Overflowed };
//
//   // mutex + condvar over per-model in-flight counters and ONE priority queue,
//   // driven by the ALREADY-PARSED §2.2 admission + priorities blocks. No
//   // config file is re-read and no header is re-parsed here.
//   //   - admit(model, priority) BLOCKS the calling (handler) thread while the
//   //     model is at cfg.admission.maxInflightPerModel. It returns Admitted as
//   //     soon as a slot is claimed, TimedOut when the entry waited longer than
//   //     cfg.admission.queueTimeoutMs (the entry is then removed, leaving no
//   //     hole), and Overflowed IMMEDIATELY — never after a wait — when the
//   //     queue already holds cfg.admission.maxQueued entries.
//   //   - `priority` is 11.3's RequestTags.priority verbatim: an empty optional
//   //     (untagged) and any value outside interactive|review|batch (SG-4) are
//   //     both treated as interactive and admitted normally, never rejected.
//   //     Ordering is by the §2.2 priorities VALUE, lower first, FIFO within a
//   //     class.
//   //   - `model` is the request body's `model` field; an absent/unusable one
//   //     buckets under the empty-string key (SG-3), never a rejection.
//   //   - release(model) returns one in-flight slot and wakes the highest
//   //     priority FIFO head waiting on that model.
//   //   - queued_count() / inflight_count(model) are the observation seam these
//   //     tests synchronize on, so nothing here has to sleep on an assumed
//   //     duration.
//   class AdmissionController {
//    public:
//     explicit AdmissionController(const RouterConfig& config);
//
//     AdmissionController(const AdmissionController&) = delete;
//     AdmissionController& operator=(const AdmissionController&) = delete;
//
//     AdmissionOutcome admit(const std::string& model,
//                            const std::optional<std::string>& priority);
//     void release(const std::string& model);
//
//     [[nodiscard]] std::size_t queued_count() const;
//     [[nodiscard]] std::size_t inflight_count(const std::string& model) const;
//   };
//
//   // The plan's startup arithmetic, consumed BOTH by Router::start()
//   // (svr.new_task_queue -> httplib::ThreadPool) and by the maxQueued clamp in
//   // 11.2's validation path:
//   //   maxQueued + sum(maxInflightPerModel) + kTaskQueueThreadMargin.
//   [[nodiscard]] int computeTaskQueueThreads(const RouterConfig& config);
//
//   }  // namespace conductor::router
//
// The Router SEAM (src/router/router.hpp, Task 11.3, extended in place):
//   - Router owns one AdmissionController built from its RouterConfig and
//     exposes it read-only:
//         [[nodiscard]] const AdmissionController& admission() const;
//   - the EXISTING single /v1/.* handler is WRAPPED, not duplicated: admit ->
//     the existing upstream relay -> release on every exit path. SG-6: this
//     applies to POST /v1/* only; GET /v1/models keeps passing through
//     un-admitted, as does /conductor/*.
//   - a rejected admission answers HTTP 503 + the SG-1 envelope and never
//     contacts the upstream.
//   - GET /conductor/health is registered OUTSIDE admission and answers
//     200 {"status":"ok"} (SG-5).
//   - start() sizes the listener's task queue explicitly via
//     server_.new_task_queue = [n = computeTaskQueueThreads(config_)] {
//         return new httplib::ThreadPool(n); };
//     so a full queue of blocked handler threads cannot starve the pool.
//
// The 11.2 CLAMP (src/router/config.hpp, inside the EXISTING parseRouterConfig
// validation path — not a parallel one): when computeTaskQueueThreads exceeds
// kAdmissionThreadBudget, admission.maxQueued is clamped to
// kAdmissionThreadBudget - maxInflightPerModel - kTaskQueueThreadMargin and the
// clamp is logged at warn naming BOTH the configured and effective values; if
// that arithmetic cannot reach >= 1 the parse throws ConfigError naming
// admission.maxQueued.
//
// This file's final home is src/tests/admission_test.cpp. CMake wiring is
// ORCHESTRATOR-ONLY: this file joins the router-tests target source list.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
//
// NO SLEEPS AS SYNCHRONIZATION anywhere below. Every wait is either a condvar
// (the stub upstream's release gate) or a poll on OBSERVABLE state
// (queued_count(), the stub's request log, a client thread's completion flag);
// the poll deadlines and the clients' read timeouts exist only to bound a
// FAILING run. The one place elapsed time is asserted is the queue-timeout
// case, where the elapsed time IS the behaviour under test.
// =============================================================================

#include <doctest/doctest.h>
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/sinks/base_sink.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <filesystem>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#include "router/admission.hpp"
#include "router/config.hpp"
#include "router/router.hpp"

namespace {

    using conductor::router::AdmissionOutcome;
    using nlohmann::json;

    constexpr const char* kHost = "127.0.0.1";
    constexpr const char* kChatPath = "/v1/chat/completions";
    constexpr const char* kModelsPath = "/v1/models";
    constexpr const char* kHealthRoute = "/conductor/health";
    constexpr const char* kModelA = "model-a";
    constexpr const char* kModelB = "model-b";

    // SG-1's pinned envelope values, written as literals so the assertions pin
    // the WIRE shape rather than whatever the header happens to name them.
    constexpr const char* kUnavailableType = "unavailable_error";
    constexpr const char* kTimeoutCode = "queue_timeout";
    constexpr const char* kOverflowCode = "queue_overflow";

    // Client read timeout: a FAILURE backstop only. Every request in this suite
    // is meant to be released by the test long before this elapses; it exists so
    // a wrong implementation unwinds instead of wedging ctest forever.
    constexpr int kClientReadTimeoutSeconds = 60;

    // What the stub upstream saw, in arrival order. `marker` is the request
    // body's own "marker" field, which is how a dispatch order is read back.
    struct Seen {
        std::string method;
        std::string path;
        std::string model;
        std::string marker;
    };

    // The stub upstream from Task 11.3's proxy_test.cpp (an in-process
    // httplib::Server on an ephemeral port), extended with the one thing 11.4
    // needs: it HOLDS a request open until the test releases it. A request whose
    // body carries "hold": true parks on a condvar until releaseNext() has been
    // called once for it, in arrival order among held requests; releaseAll()
    // frees every present and future hold. That is the release-driven
    // synchronization these cases are built on — no sleeps.
    class HoldingUpstream {
    public:
        HoldingUpstream() {
            const httplib::Server::Handler serve =
                [this](const httplib::Request& request, httplib::Response& response) {
                    handle(request, response);
                };

            server_.Get("/v1/.*", serve);
            server_.Post("/v1/.*", serve);
        }

        ~HoldingUpstream() {
            releaseAll();
            stop();
        }

        HoldingUpstream(const HoldingUpstream&) = delete;
        HoldingUpstream& operator=(const HoldingUpstream&) = delete;

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

        // Frees exactly one more held request, in the order the holds arrived.
        void releaseNext() {
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                ++released_;
            }

            gate_.notify_all();
        }

        void releaseAll() {
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                released_ = std::numeric_limits<std::size_t>::max();
            }

            gate_.notify_all();
        }

        [[nodiscard]] std::size_t seenCount() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return seen_.size();
        }

        [[nodiscard]] std::vector<Seen> seen() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return seen_;
        }

        // Dispatch order as the upstream observed it.
        [[nodiscard]] std::vector<std::string> markers() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            std::vector<std::string> out;
            out.reserve(seen_.size());
            for (const Seen& entry : seen_)
                out.push_back(entry.marker);

            return out;
        }

        [[nodiscard]] bool sawMarker(std::string_view marker) const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return std::any_of(seen_.begin(), seen_.end(), [marker](const Seen& entry) {
                return entry.marker == marker;
            });
        }

    private:
        void handle(const httplib::Request& request, httplib::Response& response) {
            const json body = json::parse(request.body, nullptr, /*allow_exceptions=*/false);
            const bool object = !body.is_discarded() && body.is_object();

            Seen entry;
            entry.method = request.method;
            entry.path = request.path;
            entry.model = object ? body.value("model", std::string()) : std::string();
            entry.marker = object ? body.value("marker", std::string()) : std::string();

            const bool hold = object && body.value("hold", false);
            std::size_t holdIndex = 0;

            {
                const std::lock_guard<std::mutex> lock(mutex_);
                seen_.push_back(entry);
                if (hold)
                    holdIndex = held_++;
            }

            if (hold) {
                std::unique_lock<std::mutex> lock(mutex_);
                gate_.wait(lock, [this, holdIndex] {
                    return released_ > holdIndex;
                });
            }

            json answer;
            answer["served"] = entry.marker;
            answer["model"] = entry.model;
            response.set_content(answer.dump(), "application/json");
        }

        httplib::Server server_;
        std::thread listen_;
        int port_{ 0 };

        mutable std::mutex mutex_;
        std::condition_variable gate_;
        std::vector<Seen> seen_;
        std::size_t held_{ 0 };
        std::size_t released_{ 0 };
    };

    // Releases every hold when the enclosing scope unwinds — including on a
    // failed REQUIRE, which throws. Declared AFTER the in-flight/queued clients
    // so it is destroyed BEFORE them: the clients can then finish and join
    // instead of deadlocking the teardown.
    struct DrainGuard {
        HoldingUpstream& upstream;

        explicit DrainGuard(HoldingUpstream& target)
            : upstream(target) {
        }

        ~DrainGuard() {
            upstream.releaseAll();
        }

        DrainGuard(const DrainGuard&) = delete;
        DrainGuard& operator=(const DrainGuard&) = delete;
    };

    // One request in flight on its own thread, because an admitted-and-held or
    // queued request BLOCKS its caller — that is the property under test.
    class AsyncRequest {
    public:
        AsyncRequest(int port, std::string path, httplib::Headers headers, std::string body) {
            thread_ = std::thread(
                [this, port, path = std::move(path), headers = std::move(headers),
                 body = std::move(body)]() mutable {
                    httplib::Client client(kHost, port);
                    client.set_connection_timeout(10, 0);
                    client.set_read_timeout(kClientReadTimeoutSeconds, 0);
                    client.set_write_timeout(kClientReadTimeoutSeconds, 0);
                    result_.emplace(client.Post(path.c_str(), headers, body, "application/json"));
                    done_.store(true);
                });
        }

        ~AsyncRequest() {
            join();
        }

        AsyncRequest(const AsyncRequest&) = delete;
        AsyncRequest& operator=(const AsyncRequest&) = delete;

        [[nodiscard]] bool done() const {
            return done_.load();
        }

        void join() {
            if (thread_.joinable())
                thread_.join();
        }

        // Valid after join() / once done() is true.
        [[nodiscard]] const httplib::Result& result() const {
            REQUIRE(result_.has_value());
            return *result_;
        }

    private:
        std::atomic<bool> done_{ false };
        std::optional<httplib::Result> result_;
        std::thread thread_;
    };

    using RequestPtr = std::unique_ptr<AsyncRequest>;

    // Readiness poll on OBSERVABLE state (the 11.3 idiom): the predicate is the
    // synchronization, the 2ms interval is only the poll granularity, and the
    // deadline bounds a FAILING run. No assertion rests on the deadline.
    bool waitUntil(const std::function<bool()>& ready,
                   std::chrono::milliseconds deadline = std::chrono::seconds{ 20 }) {
        const auto giveUp = std::chrono::steady_clock::now() + deadline;
        while (std::chrono::steady_clock::now() < giveUp) {
            if (ready())
                return true;

            std::this_thread::sleep_for(std::chrono::milliseconds{ 2 });
        }

        return ready();
    }

    // The Router consumes Task 11.2's PARSED RouterConfig, so the tests build the
    // struct directly (11.3's makeConfig idiom). listen.port 0 is the pinned
    // test-only "bind an ephemeral port" construction. Every admission knob is a
    // parameter: each case pins them at DIFFERENT values, so no hardcoded
    // constant can satisfy the suite.
    conductor::router::RouterConfig makeConfig(int upstreamPort, int maxInflightPerModel,
                                               int maxQueued, std::int64_t queueTimeoutMs) {
        conductor::router::RouterConfig config;
        config.version = 1;
        config.listen = { kHost, 0 };
        config.upstream = { kHost, upstreamPort };
        config.admission = { maxInflightPerModel, maxQueued, queueTimeoutMs };
        // §2.2 order: lower value dequeues first.
        config.priorities = { 0, 1, 2 };
        config.affinity = { "X-Conductor-Group", true };
        config.schema = { "X-Conductor-Schema", true, false };
        config.metrics = {
            (std::filesystem::temp_directory_path() / "conductor-router-11.4" / "metrics.jsonl")
                .string()
        };
        config.logging = { "info" };
        return config;
    }

    std::string requestBody(const std::string& model, const std::string& marker, bool hold) {
        json body;
        body["model"] = model;
        body["marker"] = marker;
        body["hold"] = hold;
        body["messages"] = json::array({ json{ { "role", "user" }, { "content", marker } } });
        return body.dump();
    }

    // The §4.4 body-field fallback carrying the priority tag and NOTHING else:
    // 11.3 normalizes it into RequestTags.priority and strips the key. A router
    // that re-parsed X-Conductor-Priority itself would see no priority here.
    std::string requestBodyWithFallbackPriority(const std::string& model, const std::string& marker,
                                                bool hold, const std::string& priority) {
        json body = json::parse(requestBody(model, marker, hold));
        body[conductor::router::kParamsFallbackField] = json{ { "priority", priority } };
        return body.dump();
    }

    httplib::Headers priorityHeaders(const char* priority) {
        return httplib::Headers{ { "X-Conductor-Priority", priority } };
    }

    RequestPtr postAsync(int routerPort, httplib::Headers headers, std::string body) {
        return std::make_unique<AsyncRequest>(routerPort, kChatPath, std::move(headers),
                                              std::move(body));
    }

    // Enqueues one request and waits until admission OBSERVES it queued, which is
    // what makes the arrival order of a queue deterministic without a sleep.
    RequestPtr enqueueAndAwait(const conductor::router::Router& router, int routerPort,
                               httplib::Headers headers, std::string body,
                               std::size_t expectedDepth) {
        RequestPtr request = postAsync(routerPort, std::move(headers), std::move(body));
        REQUIRE(waitUntil([&router, expectedDepth] {
            return router.admission().queued_count() == expectedDepth;
        }));

        return request;
    }

    struct Envelope {
        int status{ 0 };
        std::string contentType;
        std::string type;
        std::string code;
        std::string message;
    };

    // SG-1: HTTP 503 + {"error":{"message":…,"type":…,"code":…}}.
    Envelope readEnvelope(const httplib::Result& result) {
        Envelope envelope;
        REQUIRE(result);
        envelope.status = result->status;
        envelope.contentType = result->get_header_value("Content-Type");

        const json body = json::parse(result->body, nullptr, /*allow_exceptions=*/false);
        REQUIRE_FALSE(body.is_discarded());
        REQUIRE(body.contains("error"));
        REQUIRE(body["error"].is_object());
        envelope.type = body["error"].value("type", std::string());
        envelope.code = body["error"].value("code", std::string());
        envelope.message = body["error"].value("message", std::string());
        return envelope;
    }

    // The exported schema, resolved exactly as 11.2's config_test.cpp does:
    // beside this source (CMake compiles by absolute path), else by walking up
    // from the working directory so the suite runs from a build tree too.
    std::filesystem::path exportedSchemaPath() {
        static constexpr const char* kRelative = "schemas/RouterConfig.schema.json";

        const std::filesystem::path here(__FILE__);
        const std::filesystem::path beside = here.parent_path() / kRelative;
        if (std::filesystem::exists(beside))
            return beside;

        std::error_code ec;
        std::filesystem::path dir = std::filesystem::current_path(ec);
        while (!ec && !dir.empty()) {
            const std::filesystem::path candidate = dir / "src" / "tests" / kRelative;
            if (std::filesystem::exists(candidate))
                return candidate;

            const std::filesystem::path parent = dir.parent_path();
            if (parent == dir)
                break;

            dir = parent;
        }

        return beside;
    }

    // The §2.2 router config document (plan lines 636-670), the shape the clamp
    // case perturbs one admission block at a time.
    json section22Document() {
        return json::parse(R"CONFIG({
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
        })CONFIG");
    }

    json admissionDocument(int maxInflightPerModel, int maxQueued, std::int64_t queueTimeoutMs) {
        json document = section22Document();
        document["admission"]["maxInflightPerModel"] = maxInflightPerModel;
        document["admission"]["maxQueued"] = maxQueued;
        document["admission"]["queueTimeoutMs"] = queueTimeoutMs;
        return document;
    }

    // Retargets a PARSED config at this test's stub upstream and an ephemeral
    // listen port, leaving the admission block — clamp included — untouched.
    conductor::router::RouterConfig withTestEndpoints(conductor::router::RouterConfig config,
                                                      int upstreamPort) {
        config.listen = { kHost, 0 };
        config.upstream = { kHost, upstreamPort };
        config.metrics = {
            (std::filesystem::temp_directory_path() / "conductor-router-11.4" / "metrics.jsonl")
                .string()
        };
        return config;
    }

    bool mentions(std::string_view haystack, std::string_view needle) {
        return haystack.find(needle) != std::string_view::npos;
    }

    // Captures warn-and-above spdlog messages so the clamp's warning can be read
    // back. Installed and removed by CaptureWarnings, which also restores the
    // process-wide level it had to lower.
    class CaptureSink final : public spdlog::sinks::base_sink<std::mutex> {
    public:
        [[nodiscard]] std::vector<std::string> lines() const {
            const std::lock_guard<std::mutex> lock(own_);
            return lines_;
        }

    protected:
        void sink_it_(const spdlog::details::log_msg& msg) override {
            if (msg.level < spdlog::level::warn)
                return;

            const std::lock_guard<std::mutex> lock(own_);
            lines_.emplace_back(msg.payload.data(), msg.payload.size());
        }

        void flush_() override {
        }

    private:
        mutable std::mutex own_;
        std::vector<std::string> lines_;
    };

    struct CaptureWarnings {
        std::shared_ptr<CaptureSink> sink{ std::make_shared<CaptureSink>() };
        std::shared_ptr<spdlog::logger> logger{ spdlog::default_logger() };
        spdlog::level::level_enum savedLevel{ spdlog::default_logger()->level() };

        CaptureWarnings() {
            logger->sinks().push_back(sink);
            logger->set_level(spdlog::level::trace);
        }

        ~CaptureWarnings() {
            auto& sinks = logger->sinks();
            const auto found = std::find(sinks.begin(), sinks.end(), sink);
            if (found != sinks.end())
                sinks.erase(found);

            logger->set_level(savedLevel);
        }

        CaptureWarnings(const CaptureWarnings&) = delete;
        CaptureWarnings& operator=(const CaptureWarnings&) = delete;

        [[nodiscard]] bool anyMentions(std::initializer_list<std::string_view> parts) const {
            for (const std::string& line : sink->lines()) {
                bool all = true;
                for (const std::string_view part : parts)
                    all = all && mentions(line, part);

                if (all)
                    return true;
            }

            return false;
        }
    };

    // What a rejected parse produced (11.2's Rejection idiom).
    struct Rejection {
        bool thrown{ false };
        std::string field;
        std::string message;
    };

    Rejection parseExpectingRejection(const std::string& document, const std::string& schemaPath) {
        Rejection rejection;
        try {
            const auto config = conductor::router::parseRouterConfig(document, schemaPath);
            (void)config;
        } catch (const conductor::router::ConfigError& error) {
            rejection.thrown = true;
            rejection.field = error.field();
            rejection.message = error.what();
        }

        return rejection;
    }

}  // namespace

TEST_CASE(
    "[11.4-cap-queues] at maxInflightPerModel the next same-model request QUEUES instead of "
    "reaching the upstream, and a release dispatches it") {
    constexpr int kInflightCap = 2;

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), kInflightCap, 64, 600000));
    router.start();

    std::vector<RequestPtr> inFlight;
    RequestPtr queued;
    // Destroyed FIRST, so a failed REQUIRE below still frees every hold and the
    // client threads above can join.
    DrainGuard drain(upstream);

    // Two requests fill the cap and are HELD open at the stub until this test
    // releases them.
    inFlight.push_back(postAsync(router.listen_port(), {}, requestBody(kModelA, "hold-1", true)));
    inFlight.push_back(postAsync(router.listen_port(), {}, requestBody(kModelA, "hold-2", true)));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 2;
    }));

    CHECK(router.admission().inflight_count(kModelA) == 2);
    CHECK(router.admission().queued_count() == 0);

    // The third is QUEUED, not rejected: it never reaches the upstream and its
    // caller is still blocked.
    queued = postAsync(router.listen_port(), {}, requestBody(kModelA, "queued-3", true));
    REQUIRE(waitUntil([&router] {
        return router.admission().queued_count() == 1;
    }));

    CHECK(upstream.seenCount() == 2);
    CHECK_FALSE(upstream.sawMarker("queued-3"));
    CHECK_FALSE(queued->done());
    CHECK(router.admission().inflight_count(kModelA) == 2);

    // Releasing ONE held request frees one slot; the queued request is woken and
    // dispatched to the upstream.
    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 3;
    }));

    CHECK(upstream.sawMarker("queued-3"));
    CHECK(router.admission().queued_count() == 0);

    // ... and completes with the UPSTREAM's response, not a router-minted one.
    upstream.releaseAll();
    queued->join();
    const httplib::Result& queuedResult = queued->result();
    REQUIRE(queuedResult);
    CHECK(queuedResult->status == 200);
    CHECK(json::parse(queuedResult->body).value("served", std::string()) == "queued-3");

    for (const RequestPtr& request : inFlight) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }

    REQUIRE(waitUntil([&router] {
        return router.admission().inflight_count(kModelA) == 0;
    }));

    // The same cap/queue/release law directly on the controller surface the
    // Router wraps: admit() blocks at the cap and release() wakes it.
    conductor::router::AdmissionController controller(makeConfig(1, kInflightCap, 64, 600000));
    CHECK(controller.admit(kModelA, "interactive") == AdmissionOutcome::Admitted);
    CHECK(controller.admit(kModelA, "interactive") == AdmissionOutcome::Admitted);
    CHECK(controller.inflight_count(kModelA) == 2);

    std::atomic<bool> thirdReturned{ false };
    AdmissionOutcome thirdOutcome = AdmissionOutcome::Overflowed;
    std::thread third([&] {
        thirdOutcome = controller.admit(kModelA, "interactive");
        thirdReturned.store(true);
    });

    REQUIRE(waitUntil([&controller] {
        return controller.queued_count() == 1;
    }));

    CHECK_FALSE(thirdReturned.load());
    controller.release(kModelA);
    third.join();
    CHECK(thirdOutcome == AdmissionOutcome::Admitted);
    CHECK(controller.queued_count() == 0);
    CHECK(controller.inflight_count(kModelA) == 2);
    controller.release(kModelA);
    controller.release(kModelA);
    CHECK(controller.inflight_count(kModelA) == 0);
}

TEST_CASE(
    "[11.4-priority-order] queued requests dequeue interactive < review < batch, FIFO within a "
    "class, with untagged treated as interactive and the tag read from RequestTags") {
    constexpr int kInflightCap = 1;

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), kInflightCap, 16, 600000));
    router.start();

    RequestPtr held;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    held = postAsync(router.listen_port(), {}, requestBody(kModelA, "hold", true));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 1;
    }));

    // Deliberately INVERTED arrival order, each request observed queued before
    // the next is sent so the arrival order is a fact, not a race.
    queued.push_back(enqueueAndAwait(router, router.listen_port(), priorityHeaders("batch"),
                                     requestBody(kModelA, "batch-header", true), 1));
    queued.push_back(enqueueAndAwait(router, router.listen_port(), priorityHeaders("review"),
                                     requestBody(kModelA, "review-header", true), 2));
    // Priority carried ONLY by the §4.4 body field: 11.3's RequestTags normalizes
    // it, so admission must see "batch" here. A router that re-parsed the header
    // itself would see nothing and dequeue this as interactive.
    queued.push_back(enqueueAndAwait(
        router, router.listen_port(), {},
        requestBodyWithFallbackPriority(kModelA, "batch-body", true, "batch"), 3));
    queued.push_back(enqueueAndAwait(router, router.listen_port(), priorityHeaders("interactive"),
                                     requestBody(kModelA, "interactive-header", true), 4));
    // Untagged: §4.4 says it defaults to interactive and bypasses NOTHING — it
    // is queued like every other request, and dequeues behind the explicitly
    // interactive one that arrived before it.
    queued.push_back(enqueueAndAwait(router, router.listen_port(), {},
                                     requestBody(kModelA, "untagged", true), 5));

    CHECK(upstream.seenCount() == 1);

    // Free one slot at a time; each release dispatches exactly the next entry.
    const std::vector<std::string> expected = {
        "hold",
        "interactive-header",
        "untagged",
        "review-header",
        "batch-header",
        "batch-body",
    };

    for (std::size_t dispatched = 1; dispatched < expected.size(); ++dispatched) {
        upstream.releaseNext();
        const std::size_t want = dispatched + 1;
        REQUIRE(waitUntil([&upstream, want] {
            return upstream.seenCount() == want;
        }));
    }

    CHECK(router.admission().queued_count() == 0);
    CHECK(upstream.markers() == expected);

    upstream.releaseAll();
    held->join();
    for (const RequestPtr& request : queued) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }
}

TEST_CASE(
    "[11.4-fifo-within-class] same-priority queued requests are dispatched in exactly their "
    "arrival order across the whole drain") {
    constexpr int kInflightCap = 3;

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), kInflightCap, 12, 600000));
    router.start();

    std::vector<RequestPtr> inFlight;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    for (int slot = 1; slot <= kInflightCap; ++slot) {
        inFlight.push_back(postAsync(router.listen_port(), {},
                                     requestBody(kModelA, "hold-" + std::to_string(slot), true)));
    }

    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == static_cast<std::size_t>(kInflightCap);
    }));

    // Five requests of the SAME priority class, enqueued one at a time so their
    // arrival order is established, not raced.
    const std::vector<std::string> arrival = { "fifo-1", "fifo-2", "fifo-3", "fifo-4", "fifo-5" };
    for (std::size_t index = 0; index < arrival.size(); ++index) {
        queued.push_back(enqueueAndAwait(router, router.listen_port(), priorityHeaders("review"),
                                         requestBody(kModelA, arrival[index], true), index + 1));
    }

    CHECK(upstream.seenCount() == static_cast<std::size_t>(kInflightCap));

    for (std::size_t drained = 0; drained < arrival.size(); ++drained) {
        upstream.releaseNext();
        const std::size_t want = static_cast<std::size_t>(kInflightCap) + drained + 1;
        REQUIRE(waitUntil([&upstream, want] {
            return upstream.seenCount() == want;
        }));

        // Stable across the WHOLE drain, not just at the end: entry N reached the
        // upstream on release N.
        const std::vector<std::string> markers = upstream.markers();
        REQUIRE(markers.size() == want);
        CHECK(markers.back() == arrival[drained]);
        CHECK(router.admission().queued_count() == arrival.size() - drained - 1);
    }

    const std::vector<std::string> markers = upstream.markers();
    const std::vector<std::string> dispatched(markers.begin() + kInflightCap, markers.end());
    CHECK(dispatched == arrival);

    upstream.releaseAll();
    for (const RequestPtr& request : inFlight)
        request->join();

    for (const RequestPtr& request : queued) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }
}

TEST_CASE(
    "[11.4-queue-timeout-503] a queued request that waits past queueTimeoutMs gets the 503 "
    "queue_timeout envelope, never reaches the upstream, and leaves no hole in the queue") {
    constexpr std::int64_t kQueueTimeoutMs = 1200;

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), 1, 8, kQueueTimeoutMs));
    router.start();

    RequestPtr held;
    RequestPtr timingOut;
    std::vector<RequestPtr> afterwards;
    DrainGuard drain(upstream);

    held = postAsync(router.listen_port(), {}, requestBody(kModelA, "t-hold", true));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 1;
    }));

    const auto queuedAt = std::chrono::steady_clock::now();
    timingOut = enqueueAndAwait(router, router.listen_port(), {},
                                requestBody(kModelA, "t-timeout", true), 1);

    // Waiting for the request's OWN completion, not for a duration: the elapsed
    // time is then read back, because "waited longer than queueTimeoutMs" is the
    // behaviour under test.
    REQUIRE(waitUntil([&timingOut] {
        return timingOut->done();
    }));

    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - queuedAt)
                             .count();

    timingOut->join();
    const Envelope envelope = readEnvelope(timingOut->result());
    INFO("timeout envelope: status=", envelope.status, " type='", envelope.type, "' code='",
         envelope.code, "' message='", envelope.message, "'");
    CHECK(envelope.status == 503);
    CHECK(envelope.contentType == "application/json");
    CHECK(envelope.type == kUnavailableType);
    CHECK(envelope.code == kTimeoutCode);
    CHECK_FALSE(envelope.message.empty());
    // It really waited rather than being rejected on arrival (the overflow path).
    CHECK(elapsed >= kQueueTimeoutMs - 200);

    // Removed from the queue, and it NEVER reached the upstream.
    CHECK(router.admission().queued_count() == 0);
    CHECK(upstream.seenCount() == 1);
    CHECK_FALSE(upstream.sawMarker("t-timeout"));

    // The queue still works after the removal — no hole: two fresh entries drain
    // in arrival order as slots free.
    afterwards.push_back(enqueueAndAwait(router, router.listen_port(), {},
                                         requestBody(kModelA, "t-b", true), 1));
    afterwards.push_back(enqueueAndAwait(router, router.listen_port(), {},
                                         requestBody(kModelA, "t-c", true), 2));

    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 2;
    }));

    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 3;
    }));

    const std::vector<std::string> markers = upstream.markers();
    REQUIRE(markers.size() == 3);
    CHECK(markers[0] == "t-hold");
    CHECK(markers[1] == "t-b");
    CHECK(markers[2] == "t-c");
    CHECK_FALSE(upstream.sawMarker("t-timeout"));

    upstream.releaseAll();
    held->join();
    for (const RequestPtr& request : afterwards) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }
}

TEST_CASE(
    "[11.4-overflow-503] a full queue rejects the next request immediately with the 503 "
    "queue_overflow envelope, evicting nothing and never touching the upstream") {
    constexpr int kMaxQueued = 2;
    constexpr std::int64_t kQueueTimeoutMs = 30000;

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), 1, kMaxQueued, kQueueTimeoutMs));
    router.start();

    RequestPtr held;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    held = postAsync(router.listen_port(), {}, requestBody(kModelA, "o-hold", true));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 1;
    }));

    queued.push_back(enqueueAndAwait(router, router.listen_port(), {},
                                     requestBody(kModelA, "o-q1", true), 1));
    queued.push_back(enqueueAndAwait(router, router.listen_port(), {},
                                     requestBody(kModelA, "o-q2", true), 2));

    // The queue now holds exactly maxQueued entries. The next request must be
    // refused ON ARRIVAL — synchronously, from this thread.
    httplib::Client client(kHost, router.listen_port());
    client.set_connection_timeout(10, 0);
    client.set_read_timeout(kClientReadTimeoutSeconds, 0);

    const auto sentAt = std::chrono::steady_clock::now();
    const httplib::Result overflowed =
        client.Post(kChatPath, httplib::Headers{}, requestBody(kModelA, "o-overflow", true),
                    "application/json");

    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - sentAt)
                             .count();

    const Envelope envelope = readEnvelope(overflowed);
    INFO("overflow envelope: status=", envelope.status, " type='", envelope.type, "' code='",
         envelope.code, "' message='", envelope.message, "'");
    CHECK(envelope.status == 503);
    CHECK(envelope.contentType == "application/json");
    CHECK(envelope.type == kUnavailableType);
    CHECK(envelope.code == kOverflowCode);
    CHECK_FALSE(envelope.message.empty());
    // Immediate: nowhere near the queue timeout it would have waited out if it
    // had been enqueued.
    CHECK(elapsed < 5000);
    CHECK(elapsed < kQueueTimeoutMs);

    // Nothing already queued was evicted, and the refused request never crossed.
    CHECK(router.admission().queued_count() == static_cast<std::size_t>(kMaxQueued));
    CHECK(upstream.seenCount() == 1);
    CHECK_FALSE(upstream.sawMarker("o-overflow"));

    // The two survivors still drain in order.
    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 2;
    }));

    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 3;
    }));

    const std::vector<std::string> markers = upstream.markers();
    REQUIRE(markers.size() == 3);
    CHECK(markers[0] == "o-hold");
    CHECK(markers[1] == "o-q1");
    CHECK(markers[2] == "o-q2");
    CHECK_FALSE(upstream.sawMarker("o-overflow"));

    upstream.releaseAll();
    held->join();
    for (const RequestPtr& request : queued) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }
}

TEST_CASE(
    "[11.4-per-model-independence] a request for model B passes straight through while model A "
    "is capped with a non-empty queue") {
    constexpr int kInflightCap = 2;

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), kInflightCap, 8, 600000));
    router.start();

    std::vector<RequestPtr> inFlight;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    inFlight.push_back(postAsync(router.listen_port(), {}, requestBody(kModelA, "a-hold-1", true)));
    inFlight.push_back(postAsync(router.listen_port(), {}, requestBody(kModelA, "a-hold-2", true)));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 2;
    }));

    queued.push_back(
        enqueueAndAwait(router, router.listen_port(), {}, requestBody(kModelA, "a-q1", true), 1));
    queued.push_back(
        enqueueAndAwait(router, router.listen_port(), {}, requestBody(kModelA, "a-q2", true), 2));

    CHECK(router.admission().inflight_count(kModelA) == 2);
    CHECK(router.admission().queued_count() == 2);

    // Model B is a different counter: no wait, straight to the upstream. Sent
    // synchronously from this thread precisely because it must NOT block.
    httplib::Client client(kHost, router.listen_port());
    client.set_connection_timeout(10, 0);
    client.set_read_timeout(kClientReadTimeoutSeconds, 0);

    const auto sentAt = std::chrono::steady_clock::now();
    const httplib::Result passedThrough =
        client.Post(kChatPath, httplib::Headers{}, requestBody(kModelB, "b-pass", false),
                    "application/json");

    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - sentAt)
                             .count();

    REQUIRE(passedThrough);
    CHECK(passedThrough->status == 200);
    CHECK(json::parse(passedThrough->body).value("served", std::string()) == "b-pass");
    CHECK(elapsed < 5000);

    CHECK(upstream.sawMarker("b-pass"));
    CHECK(upstream.seenCount() == 3);
    // B neither consumed nor freed A's capacity: A's queue is untouched and its
    // in-flight count is unchanged.
    CHECK(router.admission().queued_count() == 2);
    CHECK(router.admission().inflight_count(kModelA) == 2);
    REQUIRE(waitUntil([&router] {
        return router.admission().inflight_count(kModelB) == 0;
    }));

    // Releasing A's held requests drains A's queue normally, in order.
    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 4;
    }));

    upstream.releaseNext();
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 5;
    }));

    const std::vector<std::string> markers = upstream.markers();
    REQUIRE(markers.size() == 5);
    // The two held A requests race each other into the stub, so only their SET is
    // pinned; everything after them is strictly ordered.
    CHECK(((markers[0] == "a-hold-1" && markers[1] == "a-hold-2") ||
           (markers[0] == "a-hold-2" && markers[1] == "a-hold-1")));
    CHECK(markers[2] == "b-pass");
    CHECK(markers[3] == "a-q1");
    CHECK(markers[4] == "a-q2");
    CHECK(router.admission().queued_count() == 0);

    upstream.releaseAll();
    for (const RequestPtr& request : inFlight)
        request->join();

    for (const RequestPtr& request : queued) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }
}

TEST_CASE(
    "[11.4-health-at-full-queue] with every in-flight slot held and the queue full, "
    "GET /conductor/health still answers 200 — the pool-exhaustion proof") {
    constexpr int kInflightCap = 2;

    // Sized ABOVE httplib's default pool (max(hardware_concurrency - 1, 8)) on
    // whatever machine runs this, so a router that did NOT size its task queue
    // via new_task_queue starves here: every blocked handler thread would hold a
    // default-pool worker and the health probe would never be dispatched.
    const int queueDepth =
        std::max(32, static_cast<int>(std::thread::hardware_concurrency()) + 16);

    HoldingUpstream upstream;
    upstream.start();

    const conductor::router::RouterConfig config =
        makeConfig(upstream.port(), kInflightCap, queueDepth, 600000);

    // The startup arithmetic the plan names verbatim.
    CHECK(conductor::router::computeTaskQueueThreads(config) == queueDepth + kInflightCap + 8);

    conductor::router::Router router(config);
    router.start();

    std::vector<RequestPtr> inFlight;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    for (int slot = 0; slot < kInflightCap; ++slot) {
        inFlight.push_back(postAsync(router.listen_port(), {},
                                     requestBody(kModelA, "h-hold-" + std::to_string(slot), true)));
    }

    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == static_cast<std::size_t>(kInflightCap);
    }));

    // Fill the queue to maxQueued. Order is irrelevant here, so these go out
    // together and the depth is awaited once.
    for (int entry = 0; entry < queueDepth; ++entry) {
        queued.push_back(postAsync(router.listen_port(), {},
                                   requestBody(kModelA, "h-q-" + std::to_string(entry), true)));
    }

    REQUIRE(waitUntil(
        [&router, queueDepth] {
            return router.admission().queued_count() == static_cast<std::size_t>(queueDepth);
        },
        std::chrono::seconds{ 30 }));

    CHECK(upstream.seenCount() == static_cast<std::size_t>(kInflightCap));

    httplib::Client client(kHost, router.listen_port());
    client.set_connection_timeout(10, 0);
    client.set_read_timeout(kClientReadTimeoutSeconds, 0);

    const auto askedAt = std::chrono::steady_clock::now();
    const httplib::Result health = client.Get(kHealthRoute);
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - askedAt)
                             .count();

    REQUIRE(health);
    CHECK(health->status == 200);
    const json healthBody = json::parse(health->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(healthBody.is_discarded());
    CHECK(healthBody.value("status", std::string()) == "ok");
    // Promptly: it was answered, not merely eventually dispatched behind the
    // blocked handlers.
    CHECK(elapsed < 5000);

    // Health is registered OUTSIDE admission (SG-5), so it neither queued nor
    // consumed a slot.
    CHECK(router.admission().queued_count() == static_cast<std::size_t>(queueDepth));

    // SG-6, the same G5 law one route over: GET /v1/models is not admitted, so a
    // saturated queue cannot stall opencode's model listing either.
    const httplib::Result models = client.Get(kModelsPath);
    REQUIRE(models);
    CHECK(models->status == 200);
    CHECK(router.admission().queued_count() == static_cast<std::size_t>(queueDepth));

    upstream.releaseAll();
    for (const RequestPtr& request : inFlight)
        request->join();

    for (const RequestPtr& request : queued) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }

    CHECK(router.admission().queued_count() == 0);
}

TEST_CASE(
    "[11.4-maxqueued-clamp] config validation clamps maxQueued to the 256-thread budget, logs "
    "both values, rejects an unreachable clamp, and leaves the section 2.2 default alone") {
    const std::filesystem::path schemaPath = exportedSchemaPath();
    REQUIRE(std::filesystem::exists(schemaPath));

    constexpr int kBudget = 256;
    constexpr int kMargin = 8;
    constexpr int kClampInflight = 8;
    constexpr int kConfiguredMaxQueued = 1000;
    constexpr int kEffectiveMaxQueued = kBudget - kClampInflight - kMargin;  // 240
    constexpr std::int64_t kQueueTimeoutMs = 30000;

    // The §2.2 defaults are NOT clamped: 64 + 4 + 8 = 76, comfortably inside the
    // budget.
    const auto defaults =
        conductor::router::parseRouterConfig(section22Document().dump(), schemaPath.string());

    CHECK(defaults.admission.maxQueued == 64);
    CHECK(defaults.admission.maxInflightPerModel == 4);
    CHECK(conductor::router::computeTaskQueueThreads(defaults) == 76);

    // Over budget: 1000 + 8 + 8 = 1016 > 256, so maxQueued is clamped to 240 and
    // the sizing arithmetic lands exactly on the budget.
    conductor::router::RouterConfig clamped;
    {
        const CaptureWarnings warnings;
        clamped = conductor::router::parseRouterConfig(
            admissionDocument(kClampInflight, kConfiguredMaxQueued, kQueueTimeoutMs).dump(),
            schemaPath.string());

        // The clamp is announced at warn naming BOTH the configured and the
        // effective value — a silent clamp is indistinguishable from a bug.
        CHECK(warnings.anyMentions({ "1000", "240" }));
    }

    CHECK(clamped.admission.maxQueued == kEffectiveMaxQueued);
    CHECK(clamped.admission.maxInflightPerModel == kClampInflight);
    CHECK(conductor::router::computeTaskQueueThreads(clamped) == kBudget);

    // Boundary: an effective maxQueued of exactly 1 is still a valid config...
    const auto atBoundary = conductor::router::parseRouterConfig(
        admissionDocument(kBudget - kMargin - 1, kConfiguredMaxQueued, kQueueTimeoutMs).dump(),
        schemaPath.string());

    CHECK(atBoundary.admission.maxQueued == 1);
    CHECK(conductor::router::computeTaskQueueThreads(atBoundary) == kBudget);

    // ... and one thread further in, the clamp cannot reach 1, so the config is
    // REJECTED naming the field (11.2's posture), never silently repaired.
    const Rejection rejection = parseExpectingRejection(
        admissionDocument(kBudget - kMargin, kConfiguredMaxQueued, kQueueTimeoutMs).dump(),
        schemaPath.string());

    INFO("rejection field='", rejection.field, "' message='", rejection.message, "'");
    REQUIRE(rejection.thrown);
    CHECK(rejection.field == "admission.maxQueued");
    CHECK(mentions(rejection.message, rejection.field));

    // BEHAVIOURAL proof that the clamped value is the one the router runs with:
    // the queue overflows at 240, the effective bound, not at the configured
    // 1000. (Nothing here re-parses config: the router is handed the PARSED,
    // already-clamped struct, retargeted at this test's stub upstream.)
    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(withTestEndpoints(clamped, upstream.port()));
    router.start();

    std::vector<RequestPtr> inFlight;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    for (int slot = 0; slot < kClampInflight; ++slot) {
        inFlight.push_back(postAsync(router.listen_port(), {},
                                     requestBody(kModelA, "c-hold-" + std::to_string(slot), true)));
    }

    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == static_cast<std::size_t>(kClampInflight);
    }));

    for (int entry = 0; entry < kEffectiveMaxQueued; ++entry) {
        queued.push_back(postAsync(router.listen_port(), {},
                                   requestBody(kModelA, "c-q-" + std::to_string(entry), true)));
    }

    REQUIRE(waitUntil(
        [&router] {
            return router.admission().queued_count() ==
                   static_cast<std::size_t>(kEffectiveMaxQueued);
        },
        std::chrono::seconds{ 30 }));

    httplib::Client client(kHost, router.listen_port());
    client.set_connection_timeout(10, 0);
    client.set_read_timeout(kClientReadTimeoutSeconds, 0);

    const httplib::Result overflowed =
        client.Post(kChatPath, httplib::Headers{}, requestBody(kModelA, "c-overflow", true),
                    "application/json");

    const Envelope envelope = readEnvelope(overflowed);
    INFO("clamped-bound overflow: status=", envelope.status, " code='", envelope.code, "'");
    CHECK(envelope.status == 503);
    CHECK(envelope.type == kUnavailableType);
    CHECK(envelope.code == kOverflowCode);
    CHECK_FALSE(upstream.sawMarker("c-overflow"));
    CHECK(router.admission().queued_count() == static_cast<std::size_t>(kEffectiveMaxQueued));

    upstream.releaseAll();
    for (const RequestPtr& request : inFlight)
        request->join();

    for (const RequestPtr& request : queued) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }
}

// =============================================================================
// [11.4-fix-streaming-slot-release] — the pre-commit review fix (C-033).
//
// The eight rows above all drive a stub that answers with a Content-Length, so
// the router takes its BUFFERED path and the admitted slot is released by the
// local shared_ptr going out of scope at the end of relayToUpstream. Generation
// traffic does not look like that: an SSE / chunked answer takes the INCREMENTAL
// path, where the handler registers a content provider and RETURNS while the
// stream is still running. If the slot does not ride along in that provider's
// capture it is released the moment the handler returns, and
// maxInflightPerModel stops bounding anything for exactly the traffic the cap
// exists to bound.
// =============================================================================

namespace {

    // Answers /v1/* with a chunked stream: one chunk immediately (so a client can
    // observe that the relay is live), then parks until the test releases it.
    class StreamingUpstream {
    public:
        StreamingUpstream() {
            server_.Post("/v1/.*", [this](const httplib::Request&, httplib::Response& response) {
                response.set_chunked_content_provider(
                    "text/event-stream", [this](std::size_t offset, httplib::DataSink& sink) {
                        if (offset == 0) {
                            const std::string first = "data: open\n\n";
                            sink.write(first.data(), first.size());
                            return true;
                        }

                        std::unique_lock<std::mutex> lock(mutex_);
                        gate_.wait(lock, [this] {
                            return released_;
                        });

                        const std::string last = "data: [DONE]\n\n";
                        sink.write(last.data(), last.size());
                        sink.done();
                        return true;
                    });
            });
        }

        ~StreamingUpstream() {
            release();
            if (listen_.joinable()) {
                server_.stop();
                listen_.join();
            }
        }

        StreamingUpstream(const StreamingUpstream&) = delete;
        StreamingUpstream& operator=(const StreamingUpstream&) = delete;

        void start() {
            port_ = server_.bind_to_any_port(kHost);
            REQUIRE(port_ > 0);
            listen_ = std::thread([this] {
                server_.listen_after_bind();
            });
            server_.wait_until_ready();
        }

        void release() {
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                released_ = true;
            }
            gate_.notify_all();
        }

        [[nodiscard]] int port() const {
            return port_;
        }

    private:
        httplib::Server server_;
        std::thread listen_;
        int port_{ 0 };
        std::mutex mutex_;
        std::condition_variable gate_;
        bool released_{ false };
    };

}  // namespace

TEST_CASE(
    "[11.4-fix-streaming-slot-release] a STREAMING response holds its admitted slot for the whole "
    "stream: the cap still bounds SSE traffic, which is the only traffic that matters") {
    const std::filesystem::path schemaPath = exportedSchemaPath();
    REQUIRE(std::filesystem::exists(schemaPath));

    const auto config = conductor::router::parseRouterConfig(
        admissionDocument(/*maxInflightPerModel=*/1, /*maxQueued=*/4, /*queueTimeoutMs=*/30000).dump(),
        schemaPath.string());

    StreamingUpstream upstream;
    upstream.start();

    conductor::router::Router router(withTestEndpoints(config, upstream.port()));
    router.start();

    // One streaming request, read on its own thread so the stream stays open.
    std::mutex seenMutex;
    std::condition_variable seenGate;
    bool sawFirstChunk = false;

    std::thread streamer([&] {
        httplib::Client client(kHost, router.listen_port());
        client.set_read_timeout(60, 0);
        client.Post(
            kChatPath, httplib::Headers{}, requestBody(kModelA, "stream-1", false),
            "application/json",
            [&](const char* data, std::size_t length) {
                if (std::string(data, length).find("data: open") != std::string::npos) {
                    {
                        const std::lock_guard<std::mutex> lock(seenMutex);
                        sawFirstChunk = true;
                    }
                    seenGate.notify_all();
                }
                return true;
            });
    });

    // The first chunk proves the handler has RETURNED and httplib is driving the
    // content provider — precisely the window in which a non-captured slot has
    // already been released.
    {
        std::unique_lock<std::mutex> lock(seenMutex);
        REQUIRE(seenGate.wait_for(lock, std::chrono::seconds{ 20 }, [&] {
            return sawFirstChunk;
        }));
    }

    CHECK(router.admission().inflight_count(kModelA) == 1);

    // And the cap is real while it streams: a second same-model request queues
    // rather than passing straight through.
    RequestPtr queued = postAsync(router.listen_port(), {}, requestBody(kModelA, "stream-2", false));
    CHECK(waitUntil([&router] {
        return router.admission().queued_count() == 1;
    }));

    upstream.release();
    streamer.join();

    // The stream ended, so the slot it held is returned and the waiter runs.
    CHECK(waitUntil([&router] {
        return router.admission().queued_count() == 0;
    }));

    queued->join();
    REQUIRE(queued->result());
    CHECK(queued->result()->status == 200);
    CHECK(waitUntil([&router] {
        return router.admission().inflight_count(kModelA) == 0;
    }));
}

TEST_CASE(
    "[11.4-fix-thread-sizing-overflow] an admission integer too large for the listener sizing "
    "arithmetic is refused BY NAME, never wrapped into a one-thread listener") {
    const std::filesystem::path schemaPath = exportedSchemaPath();
    REQUIRE(std::filesystem::exists(schemaPath));

    constexpr int kIntMax = std::numeric_limits<int>::max();
    constexpr int kBudget = conductor::router::kAdmissionThreadBudget;
    constexpr int kMargin = conductor::router::kTaskQueueThreadMargin;

    // maxQueued + maxInflightPerModel + margin in plain `int` OVERFLOWS here.
    // Signed overflow is UB and wraps NEGATIVE under optimization; a negative sum
    // reads as "inside the budget", so the clamp returns early, nothing is
    // clamped, and Router::start sizes its pool from that negative count — a
    // ONE-thread listener that a single blocked handler wedges, health included.
    // The value is out of range, so the parse refuses it, naming the field.
    const Rejection queuedTooLarge = parseExpectingRejection(
        admissionDocument(/*maxInflightPerModel=*/4, kIntMax, /*queueTimeoutMs=*/30000).dump(),
        schemaPath.string());

    INFO("maxQueued rejection field='", queuedTooLarge.field, "' message='",
         queuedTooLarge.message, "'");
    REQUIRE(queuedTooLarge.thrown);
    CHECK(queuedTooLarge.field == "admission.maxQueued");
    CHECK(mentions(queuedTooLarge.message, queuedTooLarge.field));

    // The same arithmetic, overflowed from the other addend.
    const Rejection inflightTooLarge = parseExpectingRejection(
        admissionDocument(kIntMax, /*maxQueued=*/64, /*queueTimeoutMs=*/30000).dump(),
        schemaPath.string());

    INFO("maxInflightPerModel rejection field='", inflightTooLarge.field, "' message='",
         inflightTooLarge.message, "'");
    REQUIRE(inflightTooLarge.thrown);
    CHECK(inflightTooLarge.field == "admission.maxInflightPerModel");
    CHECK(mentions(inflightTooLarge.message, inflightTooLarge.field));

    // Past `int` entirely: 2^32 is a schema-legal number that get<int>() would
    // narrow to 0 — a maxQueued the operator never wrote.
    {
        json beyondInt = section22Document();
        beyondInt["admission"]["maxQueued"] = std::int64_t{ 4294967296 };
        const Rejection wide = parseExpectingRejection(beyondInt.dump(), schemaPath.string());
        INFO("2^32 rejection field='", wide.field, "' message='", wide.message, "'");
        REQUIRE(wide.thrown);
        CHECK(wide.field == "admission.maxQueued");
    }

    // A large but in-range maxQueued is still CLAMPED, not waved through by a
    // wrapped sum: 1000000 + 4 + 8 is over budget, so the effective value is 244.
    conductor::router::RouterConfig clamped;
    {
        const CaptureWarnings warnings;
        clamped = conductor::router::parseRouterConfig(
            admissionDocument(/*maxInflightPerModel=*/4, /*maxQueued=*/1000000,
                              /*queueTimeoutMs=*/30000)
                .dump(),
            schemaPath.string());

        CHECK(warnings.anyMentions({ "1000000", "244" }));
    }

    CHECK(clamped.admission.maxQueued == kBudget - 4 - kMargin);
    CHECK(conductor::router::computeTaskQueueThreads(clamped) == kBudget);

    // And the sizing arithmetic is TOTAL: a config built in code — the parser
    // bypassed, which is how every Router test and Router::start's own caller
    // reach it — can never report a pool smaller than one request needs.
    const conductor::router::RouterConfig overflowing =
        makeConfig(/*upstreamPort=*/1, kIntMax, kIntMax, /*queueTimeoutMs=*/30000);

    CHECK(conductor::router::computeTaskQueueThreads(overflowing) >= kBudget);
}

TEST_CASE(
    "[11.4-fix-admission-range-check] the three admission integers are range-checked at parse "
    "time and refused by their dotted name, exactly as both ports already are") {
    const std::filesystem::path schemaPath = exportedSchemaPath();
    REQUIRE(std::filesystem::exists(schemaPath));

    // A cap of zero or less means hasFreeSlot() can never be true: every request
    // queues until it times out, and the router serves nothing at all.
    for (const int cap : { 0, -1, -1000 }) {
        const Rejection rejection = parseExpectingRejection(
            admissionDocument(cap, /*maxQueued=*/64, /*queueTimeoutMs=*/30000).dump(),
            schemaPath.string());

        INFO("maxInflightPerModel=", cap, " field='", rejection.field, "' message='",
             rejection.message, "'");
        REQUIRE(rejection.thrown);
        CHECK(rejection.field == "admission.maxInflightPerModel");
        CHECK(mentions(rejection.message, rejection.field));
    }

    for (const int depth : { -1, -64 }) {
        const Rejection rejection = parseExpectingRejection(
            admissionDocument(/*maxInflightPerModel=*/4, depth, /*queueTimeoutMs=*/30000).dump(),
            schemaPath.string());

        INFO("maxQueued=", depth, " field='", rejection.field, "' message='", rejection.message,
             "'");
        REQUIRE(rejection.thrown);
        CHECK(rejection.field == "admission.maxQueued");
        CHECK(mentions(rejection.message, rejection.field));
    }

    for (const std::int64_t timeout : { std::int64_t{ -1 }, std::int64_t{ -30000 } }) {
        const Rejection rejection = parseExpectingRejection(
            admissionDocument(/*maxInflightPerModel=*/4, /*maxQueued=*/64, timeout).dump(),
            schemaPath.string());

        INFO("queueTimeoutMs=", timeout, " field='", rejection.field, "' message='",
             rejection.message, "'");
        REQUIRE(rejection.thrown);
        CHECK(rejection.field == "admission.queueTimeoutMs");
        CHECK(mentions(rejection.message, rejection.field));
    }

    // A fractional value silently truncates through get<int>(): 4.9 slots is
    // not 4 slots, it is a config file the operator has to be told about.
    for (const char* field : { "maxInflightPerModel", "maxQueued", "queueTimeoutMs" }) {
        json fractional = section22Document();
        fractional["admission"][field] = 4.9;

        const Rejection rejection = parseExpectingRejection(fractional.dump(), schemaPath.string());
        const std::string dotted = std::string("admission.") + field;

        INFO(dotted, "=4.9 field='", rejection.field, "' message='", rejection.message, "'");
        REQUIRE(rejection.thrown);
        CHECK(rejection.field == dotted);
        CHECK(mentions(rejection.message, rejection.field));
    }

    // The in-range edges are configs, not violations: one slot, no queue at all,
    // and a timeout of zero all parse and survive the clamp untouched.
    const auto edges = conductor::router::parseRouterConfig(
        admissionDocument(/*maxInflightPerModel=*/1, /*maxQueued=*/0, /*queueTimeoutMs=*/0).dump(),
        schemaPath.string());

    CHECK(edges.admission.maxInflightPerModel == 1);
    CHECK(edges.admission.maxQueued == 0);
    CHECK(edges.admission.queueTimeoutMs == 0);
    CHECK(conductor::router::computeTaskQueueThreads(edges) ==
          1 + conductor::router::kTaskQueueThreadMargin);
}

TEST_CASE(
    "[11.4-fix-clamp-names-inflight] when maxInflightPerModel ALONE exhausts the thread budget the "
    "refusal names maxInflightPerModel, the knob that cannot be satisfied") {
    const std::filesystem::path schemaPath = exportedSchemaPath();
    REQUIRE(std::filesystem::exists(schemaPath));

    constexpr int kBudget = conductor::router::kAdmissionThreadBudget;
    constexpr int kMargin = conductor::router::kTaskQueueThreadMargin;

    // 300 + 8 = 308 > 256: no maxQueued, not even 0, makes this config fit, so
    // maxQueued is not what the operator has to change.
    const Rejection inflightSide = parseExpectingRejection(
        admissionDocument(/*maxInflightPerModel=*/300, /*maxQueued=*/1000,
                          /*queueTimeoutMs=*/30000)
            .dump(),
        schemaPath.string());

    INFO("field='", inflightSide.field, "' message='", inflightSide.message, "'");
    REQUIRE(inflightSide.thrown);
    CHECK(inflightSide.field == "admission.maxInflightPerModel");
    CHECK(mentions(inflightSide.message, inflightSide.field));
    CHECK(mentions(inflightSide.message, "300"));

    // The boundary the committed suite pins is unmoved: at 248 the in-flight
    // side FITS exactly (248 + 8 == 256) and it is the queue that cannot be
    // given a single slot, so that refusal still names maxQueued.
    const Rejection queueSide = parseExpectingRejection(
        admissionDocument(kBudget - kMargin, /*maxQueued=*/1000, /*queueTimeoutMs=*/30000).dump(),
        schemaPath.string());

    INFO("field='", queueSide.field, "' message='", queueSide.message, "'");
    REQUIRE(queueSide.thrown);
    CHECK(queueSide.field == "admission.maxQueued");
    CHECK(mentions(queueSide.message, queueSide.field));
}
