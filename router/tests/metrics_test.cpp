// =============================================================================
// Task 11.7 — llama-router `metrics`: the §4.4 per-request JSONL ledger plus
// the in-memory aggregate served by /conductor/metrics, and the extended
// /conductor/health body.
//
// This suite is written RED: `router/metrics.hpp` does not exist yet, so this
// translation unit fails to COMPILE. That is the intended red shape. Everything
// else this file touches — config.hpp, router.hpp, admission.hpp,
// schema-observer.hpp, version.hpp — is committed code and must keep compiling
// verbatim. One TEST_CASE per assertion id from
// docs/build/specs/task-11.7.assertions.json (16 rows), named "[<id>] …".
//
// THE TARGET SURFACE (pinned by the promoted spec's resolutions — exactly two
// exports, mirroring affinity.hpp's dependency-light shape; NO httplib here):
//
//   // router/metrics.hpp   (HEADER-ONLY, matching 11.2-11.6)
//   #pragma once
//
//   #include <nlohmann/json.hpp>
//
//   #include <cstdint>
//   #include <optional>
//   #include <string>
//
//   #include "router/config.hpp"
//
//   namespace conductor::router {
//
//   // ONE request's ledger line, exactly §4.4's field set (plan lines
//   // 1680-1684) under the pinned camelCase keys. Every key is PRESENT on
//   // every serialized line; absence is JSON null, never a missing key, so a
//   // downstream reader parses the ledger with a fixed column set.
//   struct RequestRecord {
//       std::string model;                          // body `model`; "" per SG-3
//       std::optional<std::string> role;            // RequestTags verbatim
//       std::optional<std::string> group;           // RequestTags verbatim
//       std::string priority;                       // RESOLVED class, SG-4
//       std::int64_t queueWaitMs{ 0 };              // measured across admit()
//       std::optional<std::int64_t> upstreamMs;     // null when never attempted
//       std::optional<std::int64_t> promptTokens;   // from `usage`
//       std::optional<std::int64_t> completionTokens;
//       nlohmann::json timings;                     // VERBATIM copy; null absent
//       std::optional<bool> schemaMissing;          // caller-supplied (11.6)
//       std::optional<bool> schemaConformed;        // caller-supplied (11.6)
//       int status{ 0 };                            // as returned to the client
//   };
//
//   // Per-request append + in-memory aggregate, one mutex over both so the
//   // file and the counters can never disagree. Non-copyable. The constructor
//   // creates ledgerPath's parent directory when missing and the file is
//   // opened APPEND-only; each append is a single write of `<compact json>\n`
//   // flushed per line. A write failure is logged at warn and NEVER thrown —
//   // G5's fail-soft law — while the in-memory counters still advance.
//   class MetricsLedger {
//    public:
//     explicit MetricsLedger(const RouterConfig& config);
//
//     MetricsLedger(const MetricsLedger&) = delete;
//     MetricsLedger& operator=(const MetricsLedger&) = delete;
//
//     void record(const RequestRecord& record);
//
//     // The union aggregate both /conductor/metrics and these tests read:
//     //   totalRequests      — records recorded since construction
//     //   schemaMissing      — COUNT of records with schemaMissing == true
//     //   schemaConformed    — COUNT of records with schemaConformed == true
//     //   statusCounts       — object keyed by the DECIMAL status as a string
//     //   promptTokens       — sum over non-null values, 0 when none
//     //   completionTokens   — sum over non-null values, 0 when none
//     //   waitMsP50/waitMsP95 — NEAREST-RANK percentiles of the sorted
//     //       queueWaitMs samples: N > 0 sorted ascending 1-indexed, rank
//     //       ceil(0.50*N) / ceil(0.95*N); both 0 when N == 0
//     //   schemaConformanceRate — (schemaConformed true) / (schemaConformed
//     //       non-null), in 0..1; null when the denominator is 0
//     // The first six names are byte-identical to the COMMITTED
//     // conductor/adapter/router-client.ts MetricsSummary, which casts the
//     // parsed object without validating.
//     [[nodiscard]] nlohmann::json summary() const;
//   };
//
//   }  // namespace conductor::router
//
// THE ROUTER SEAM (router/router.hpp, extended IN PLACE):
//   - Router owns one MetricsLedger built from its RouterConfig — the ledger
//     location comes ONLY from config.metrics.ledgerPath, never re-read, never
//     hardcoded.
//   - queueWaitMs is std::chrono::steady_clock measured across the EXISTING
//     admission_.admit(...) call in handleProxy — admit() parks the handler
//     thread for exactly the queue wait, so ONE measurement covers Admitted,
//     TimedOut and Overflowed alike, and 11.4's committed surface is not
//     touched. A request that never reaches admit() (SG-6's un-admitted
//     non-POST reads) records queueWaitMs 0.
//   - EVERY request that enters the committed /v1/.* proxy handler gets
//     exactly ONE ledger line — the buffered return, the chunked/streamed
//     completion, the admission-refusal 503, the upstream-unreachable 502 and
//     the catch-all router-error 502. /conductor/* is NEVER ledgered, and a
//     path outside /v1/* never reaches the handler (httplib's own 404).
//   - THE LINE IS WRITTEN WHEN THE RESPONSE COMPLETES, not when the handler
//     returns. On the buffered path those coincide; on the chunked path the
//     record guard is captured INTO the content provider exactly as
//     AdmissionSlot already is, so httplib destroying the provider — normal
//     end or a dying connection — writes the line exactly once (the C-033
//     defect class: a handler-return design would ledger the streamed line
//     before any usage chunk existed).
//   - streamed usage: the router inspects SSE chunks AS THEY PASS (never
//     buffering, relaying every byte unchanged) and takes usage/timings from
//     the `data:` chunk carrying a non-null `usage` object, which under Task
//     0.2's stream_options:{include_usage:true} arrives before `data: [DONE]`.
//   - GET /conductor/metrics is registered OUTSIDE admission, exactly like the
//     committed GET /conductor/health, whose body 11.7 extends in place to
//     {"status":"ok","version":<router_version()>}.
//
// This file's final home is router/tests/metrics_test.cpp. CMake wiring is
// ORCHESTRATOR-ONLY: this file joins the router-tests target source list;
// metrics.hpp is header-only and needs no source-list entry.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
//
// NO SLEEPS AS SYNCHRONIZATION anywhere below: streamed cases synchronize on
// observed client-side state plus a condvar gate (the 11.3 idiom), held-slot
// cases on the stub's request log and admission's queued_count(), and ledger
// contents are awaited by polling the file — the append happens at response
// completion, which trails the client's last byte by a scheduling instant.
// The ONE sleep in this file (the queue-wait case) CREATES the measured
// quantity — the wait itself, exactly like 11.4's elapsed-time case — and no
// ordering rests on it. Every temp ledger lives in a doctest-owned temp dir
// removed on teardown; NO test writes the §2.2 default .data/router path.
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
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <initializer_list>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#include "router/admission.hpp"
#include "router/config.hpp"
#include "router/metrics.hpp"
#include "router/router.hpp"
#include "router/version.hpp"

namespace {

    using conductor::router::MetricsLedger;
    using conductor::router::RequestRecord;
    using nlohmann::json;

    constexpr const char* kHost = "127.0.0.1";
    constexpr const char* kChatPath = "/v1/chat/completions";
    constexpr const char* kModelsPath = "/v1/models";
    constexpr const char* kHealthRoute = "/conductor/health";
    constexpr const char* kMetricsRoute = "/conductor/metrics";
    constexpr const char* kModelA = "model-a";

    // Client read timeout for held requests: a FAILURE backstop only, never a
    // synchronization mechanism.
    constexpr int kClientReadTimeoutSeconds = 60;

    // The pinned §4.4 column set: every key PRESENT on every line, absence as
    // JSON null. A missing key here is a missing column in the POC dataset.
    constexpr const char* kLedgerKeys[] = {
        "model",
        "role",
        "group",
        "priority",
        "queueWaitMs",
        "upstreamMs",
        "promptTokens",
        "completionTokens",
        "timings",
        "schemaMissing",
        "schemaConformed",
        "status",
    };

    // The union aggregate's key set: the first six are byte-identical to the
    // COMMITTED conductor/adapter/router-client.ts MetricsSummary.
    constexpr const char* kSummaryKeys[] = {
        "totalRequests",
        "schemaMissing",
        "schemaConformed",
        "statusCounts",
        "promptTokens",
        "completionTokens",
        "waitMsP50",
        "waitMsP95",
        "schemaConformanceRate",
    };

    // The stub's canned answer. Deliberately NON-canonical whitespace: any
    // parse-and-re-serialize on the return path changes these bytes, so
    // byte-equality client-side proves the ledger observed without touching.
    constexpr const char* kUpstreamAnswer =
        "{ \"served\" : true ,\n\t\"note\" : \"upstream bytes — returned verbatim\" }";

    // A doctest-owned temp directory, unique per instantiation, recursively
    // removed on teardown — the HARD TEST RULE that keeps every ledger out of
    // the repo's .data tree.
    class TempDir {
    public:
        explicit TempDir(std::string_view label) {
            static std::atomic<std::uint64_t> counter{ 0 };
            const auto ticks = static_cast<std::uint64_t>(
                std::chrono::steady_clock::now().time_since_epoch().count());
            path_ = std::filesystem::temp_directory_path() /
                    ("conductor-router-11.7-" + std::string(label) + "-" + std::to_string(ticks) +
                     "-" + std::to_string(counter.fetch_add(1)));
            std::filesystem::create_directories(path_);
        }

        ~TempDir() {
            std::error_code ec;
            std::filesystem::remove_all(path_, ec);
        }

        TempDir(const TempDir&) = delete;
        TempDir& operator=(const TempDir&) = delete;

        [[nodiscard]] const std::filesystem::path& path() const {
            return path_;
        }

        [[nodiscard]] std::filesystem::path ledgerPath() const {
            return path_ / "metrics.jsonl";
        }

    private:
        std::filesystem::path path_;
    };

    // The Router and MetricsLedger consume Task 11.2's PARSED RouterConfig, so
    // the tests build the struct directly (the 11.3-11.6 makeConfig idiom).
    // listen.port 0 is the pinned test-only ephemeral-port construction; the
    // ledger path is ALWAYS a parameter because 11.7-ledger-path-config pins
    // that the location comes only from the config.
    conductor::router::RouterConfig makeConfig(int upstreamPort,
                                               const std::filesystem::path& ledgerPath,
                                               int maxInflightPerModel = 4, int maxQueued = 64,
                                               std::int64_t queueTimeoutMs = 600000) {
        conductor::router::RouterConfig config;
        config.version = 1;
        config.listen = { kHost, 0 };
        config.upstream = { kHost, upstreamPort };
        config.admission = { maxInflightPerModel, maxQueued, queueTimeoutMs };
        config.priorities = { 0, 1, 2 };
        config.affinity = { "X-Conductor-Group", true };
        config.schema = { "X-Conductor-Schema", true, false };
        config.metrics = { ledgerPath.string() };
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
    // the synchronization, the 2ms interval only poll granularity, and the
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

    // --- ledger file reading -------------------------------------------------

    std::vector<std::string> ledgerLineText(const std::filesystem::path& path) {
        std::vector<std::string> lines;
        std::ifstream in(path, std::ios::binary);
        if (!in.is_open())
            return lines;  // No file yet means zero lines, not an error.

        std::string line;
        while (std::getline(in, line)) {
            if (!line.empty())
                lines.push_back(line);
        }

        return lines;
    }

    std::size_t ledgerLineCount(const std::filesystem::path& path) {
        return ledgerLineText(path).size();
    }

    // Every line must parse STANDALONE as one JSON object — the whole point of
    // one-line-per-request JSONL.
    std::vector<json> ledgerLineJson(const std::filesystem::path& path) {
        std::vector<json> parsed;
        for (const std::string& text : ledgerLineText(path)) {
            INFO("ledger line: ", text);
            json line = json::parse(text, nullptr, /*allow_exceptions=*/false);
            REQUIRE_FALSE(line.is_discarded());
            REQUIRE(line.is_object());
            parsed.push_back(std::move(line));
        }

        return parsed;
    }

    // The append trails the client's last byte by a scheduling instant (the
    // record guard fires when httplib destroys the provider), so ledger
    // contents are awaited, never assumed synchronous.
    bool awaitLedgerLines(const std::filesystem::path& path, std::size_t expected,
                          std::chrono::milliseconds deadline = std::chrono::seconds{ 10 }) {
        return waitUntil(
            [&path, expected] {
                return ledgerLineCount(path) >= expected;
            },
            deadline);
    }

    std::vector<json> linesWhere(const std::filesystem::path& path,
                                 const std::function<bool(const json&)>& match) {
        std::vector<json> out;
        const std::vector<json> all = ledgerLineJson(path);
        for (const json& line : all) {
            if (match(line))
                out.push_back(line);
        }

        return out;
    }

    json onlyLineWhere(const std::filesystem::path& path,
                       const std::function<bool(const json&)>& match) {
        const std::vector<json> matches = linesWhere(path, match);
        REQUIRE(matches.size() == 1);
        return matches.front();
    }

    json lineForModel(const std::filesystem::path& path, const std::string& model) {
        INFO("looking for the ledger line with model '", model, "'");
        return onlyLineWhere(path, [&model](const json& line) {
            return line.value("model", std::string()) == model;
        });
    }

    json lineForRole(const std::filesystem::path& path, const std::string& role) {
        INFO("looking for the ledger line with role '", role, "'");
        return onlyLineWhere(path, [&role](const json& line) {
            return line.contains("role") && line["role"].is_string() &&
                   line["role"].get<std::string>() == role;
        });
    }

    json lineForStatus(const std::filesystem::path& path, int status) {
        INFO("looking for the ledger line with status ", status);
        return onlyLineWhere(path, [status](const json& line) {
            return line.value("status", 0) == status;
        });
    }

    void checkLedgerKeys(const json& line) {
        for (const char* key : kLedgerKeys) {
            INFO("pinned ledger key '", key, "' in line: ", line.dump());
            CHECK(line.contains(key));
        }
    }

    // A well-formed full-column line, used to seed "prior run" ledger files.
    json fullLedgerLine(const std::string& model, int status) {
        json line;
        line["model"] = model;
        line["role"] = nullptr;
        line["group"] = nullptr;
        line["priority"] = "interactive";
        line["queueWaitMs"] = 0;
        line["upstreamMs"] = nullptr;
        line["promptTokens"] = nullptr;
        line["completionTokens"] = nullptr;
        line["timings"] = nullptr;
        line["schemaMissing"] = nullptr;
        line["schemaConformed"] = nullptr;
        line["status"] = status;
        return line;
    }

    std::string readFileText(const std::filesystem::path& path) {
        std::ifstream in(path, std::ios::binary);
        REQUIRE(in.is_open());
        std::ostringstream buffer;
        buffer << in.rdbuf();
        return buffer.str();
    }

    // --- request bodies ------------------------------------------------------

    // The ledger's column set is FIXED, so per-request markers ride in a
    // recorded column: the body's `model` (or a role tag) names the request.
    std::string chatBody(const std::string& model) {
        json body;
        body["model"] = model;
        body["messages"] = json::array({ json{ { "role", "user" }, { "content", "ledger me" } } });
        return body.dump();
    }

    // Extra fields the STUB reads (the HoldingUpstream "hold"/"marker" trick):
    // they cross the proxy unchanged and mean nothing to the ledger.
    std::string chatBodyWith(const std::string& model,
                             const std::vector<std::pair<std::string, json>>& extras) {
        json body = json::parse(chatBody(model));
        for (const auto& [key, value] : extras)
            body[key] = value;

        return body.dump();
    }

    std::string streamRequestBody(const std::string& model) {
        json body;
        body["model"] = model;
        body["messages"] =
            json::array({ json{ { "role", "user" }, { "content", "stream a ledger line" } } });
        body["stream"] = true;
        // Task 0.2's pinned request shape: usage rides the final chunks.
        body["stream_options"] = json{ { "include_usage", true } };
        return body.dump();
    }

    httplib::Headers roleHeaders(const char* role) {
        return httplib::Headers{ { "X-Conductor-Role", role } };
    }

    // --- module-level record building ----------------------------------------

    RequestRecord makeRecord(std::string model, int status, std::int64_t queueWaitMs) {
        RequestRecord record;
        record.model = std::move(model);
        record.priority = "interactive";
        record.status = status;
        record.queueWaitMs = queueWaitMs;
        return record;
    }

    // --- the buffered stub upstream (Task 11.3's idiom) ----------------------

    struct CapturedRequest {
        std::string method;
        std::string path;
        std::string body;
        httplib::Headers headers;
    };

    class StubUpstream {
    public:
        StubUpstream() = default;

        ~StubUpstream() {
            stop();
        }

        StubUpstream(const StubUpstream&) = delete;
        StubUpstream& operator=(const StubUpstream&) = delete;

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
                CapturedRequest{ request.method, request.path, request.body, request.headers });
        }

        [[nodiscard]] std::size_t requestCount() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return requests_.size();
        }

    private:
        httplib::Server server_;
        std::thread listen_;
        int port_{ 0 };
        mutable std::mutex mutex_;
        std::vector<CapturedRequest> requests_;
    };

    // Every POST /v1/* answered with `answer` (application/json, the status the
    // request body's own "status" field asks for, 200 by default) — the
    // HoldingUpstream body-flag trick, reused so one stub covers the
    // status-recording rows. NOTE this always answers via set_content, so it
    // always sets Content-Length and ONLY exercises the BUFFERED relay — the
    // C-033 trap the streamed rows below exist to escape.
    void answerWith(StubUpstream& upstream, std::string answer) {
        upstream.server().Post(
            "/v1/.*",
            [&upstream, answer = std::move(answer)](const httplib::Request& request,
                                                    httplib::Response& response) {
                upstream.record(request);
                const json body = json::parse(request.body, nullptr, /*allow_exceptions=*/false);
                if (!body.is_discarded() && body.is_object())
                    response.status = body.value("status", 200);

                response.set_content(answer, "application/json");
            });
    }

    void answerModels(StubUpstream& upstream) {
        upstream.server().Get(
            kModelsPath, [&upstream](const httplib::Request& request, httplib::Response& response) {
                upstream.record(request);
                response.set_content(R"({"object":"list","data":[]})", "application/json");
            });
    }

    // --- the gated SSE stub (proxy_test's 11.3-sse-incremental idiom) --------
    //
    // The gate holds the stub's SECOND chunk until the test releases it, so
    // observing the first chunk client-side while the gate is still closed is
    // PROOF of incremental, unbuffered forwarding — the router held nothing
    // back to inspect it. This is the ONLY way to reach the chunked relay,
    // which is the path ALL production fan-out traffic takes.
    struct StreamGate {
        std::mutex mutex;
        std::condition_variable releasedCv;
        bool releaseSecond{ false };
        std::atomic<bool> secondChunkWritten{ false };

        void release() {
            {
                const std::lock_guard<std::mutex> lock(mutex);
                releaseSecond = true;
            }

            releasedCv.notify_all();
        }
    };

    // Frees the gate when the scope unwinds — a failed REQUIRE must not leave
    // the stub's provider parked forever.
    struct GateRelease {
        StreamGate& gate;

        explicit GateRelease(StreamGate& target)
            : gate(target) {
        }

        ~GateRelease() {
            gate.release();
        }

        GateRelease(const GateRelease&) = delete;
        GateRelease& operator=(const GateRelease&) = delete;
    };

    void serveGatedStream(StubUpstream& upstream, StreamGate& gate, std::string chunkOne,
                          std::string chunkTwo) {
        upstream.server().Post(
            kChatPath,
            [&upstream, &gate, chunkOne = std::move(chunkOne), chunkTwo = std::move(chunkTwo)](
                const httplib::Request& request, httplib::Response& response) {
                upstream.record(request);
                response.set_chunked_content_provider(
                    "text/event-stream",
                    [&gate, chunkOne, chunkTwo](std::size_t offset, httplib::DataSink& sink) {
                        if (offset == 0) {
                            sink.write(chunkOne.data(), chunkOne.size());
                            return true;
                        }

                        {
                            std::unique_lock<std::mutex> lock(gate.mutex);
                            gate.releasedCv.wait(lock, [&gate] {
                                return gate.releaseSecond;
                            });
                        }

                        gate.secondChunkWritten = true;
                        sink.write(chunkTwo.data(), chunkTwo.size());
                        sink.done();
                        return true;
                    });
            });
    }

    // --- the holding stub upstream (Task 11.4's idiom) -----------------------

    struct Seen {
        std::string method;
        std::string path;
        std::string model;
        std::string marker;
    };

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
    // failed REQUIRE. Declared AFTER the in-flight/queued clients so it is
    // destroyed BEFORE them: the clients then finish and join instead of
    // deadlocking the teardown.
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

    std::string requestBody(const std::string& model, const std::string& marker, bool hold) {
        json body;
        body["model"] = model;
        body["marker"] = marker;
        body["hold"] = hold;
        body["messages"] = json::array({ json{ { "role", "user" }, { "content", marker } } });
        return body.dump();
    }

    // One request in flight on its own thread, because a held or queued
    // request BLOCKS its caller.
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

    RequestPtr postAsync(int routerPort, httplib::Headers headers, std::string body) {
        return std::make_unique<AsyncRequest>(routerPort, kChatPath, std::move(headers),
                                              std::move(body));
    }

    RequestPtr enqueueAndAwait(const conductor::router::Router& router, int routerPort,
                               httplib::Headers headers, std::string body,
                               std::size_t expectedDepth) {
        RequestPtr request = postAsync(routerPort, std::move(headers), std::move(body));
        REQUIRE(waitUntil([&router, expectedDepth] {
            return router.admission().queued_count() == expectedDepth;
        }));

        return request;
    }

    // --- spdlog warn capture (admission_test's clamp-warning idiom) ----------
    //
    // Installed BEFORE any Router or stub exists and removed AFTER they are
    // gone, so the default logger's sink vector is never mutated beside live
    // server threads; the sink itself is mutex-guarded for concurrent logging.
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

}  // namespace

TEST_CASE(
    "[11.7-ledger-line-per-request] exactly one JSONL line per request that enters the /v1/.* "
    "proxy handler, in response-completion order, and ZERO lines for /conductor/* and for "
    "paths outside /v1/*") {
    TempDir tmp("per-request");

    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    answerModels(upstream);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // Two sequential POSTs: two lines, each parsing standalone, in request
    // order (sequential completions complete in request order).
    const auto first = client.Post(kChatPath, httplib::Headers{}, chatBody("line-a"),
                                   "application/json");
    REQUIRE(first);
    CHECK(first->status == 200);
    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));

    const auto second = client.Post(kChatPath, httplib::Headers{}, chatBody("line-b"),
                                    "application/json");
    REQUIRE(second);
    CHECK(second->status == 200);
    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 2));

    // The un-admitted GET /v1/models read still enters the proxy handler, so
    // it gets a line too (SG-6 exempts it from admission, not from the ledger).
    const auto models = client.Get(kModelsPath);
    REQUIRE(models);
    CHECK(models->status == 200);
    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 3));

    {
        const std::vector<json> lines = ledgerLineJson(tmp.ledgerPath());
        REQUIRE(lines.size() == 3);
        CHECK(lines[0].value("model", std::string()) == "line-a");
        CHECK(lines[1].value("model", std::string()) == "line-b");
        // The bodyless GET buckets under SG-3's reserved empty-string model.
        CHECK(lines[2].value("model", std::string()) == "");
    }

    // NEVER ledgered: the two /conductor endpoints and a path httplib itself
    // 404s without reaching the handler.
    const auto health = client.Get(kHealthRoute);
    REQUIRE(health);
    CHECK(health->status == 200);

    const auto metrics = client.Get(kMetricsRoute);
    REQUIRE(metrics);
    CHECK(metrics->status == 200);

    const auto outside = client.Get("/outside/v1");
    REQUIRE(outside);
    CHECK(outside->status == 404);
    CHECK(upstream.requestCount() == 3);  // The 404 never touched the upstream.

    // A further POST proves the count advanced by exactly the ledgered
    // requests: 4 lines total, never 5 — health, metrics and the 404 appended
    // nothing.
    const auto third = client.Post(kChatPath, httplib::Headers{}, chatBody("line-c"),
                                   "application/json");
    REQUIRE(third);
    CHECK(third->status == 200);
    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 4));

    const std::vector<json> lines = ledgerLineJson(tmp.ledgerPath());
    REQUIRE(lines.size() == 4);
    CHECK(lines[3].value("model", std::string()) == "line-c");
}

TEST_CASE(
    "[11.7-ledger-fields] every line carries the full pinned camelCase column set with absence "
    "as JSON null — tags verbatim, priority RESOLVED per SG-4, model per SG-3, status as "
    "actually returned (an upstream 500 records 500)") {
    TempDir tmp("fields");

    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // A: fully tagged, in-vocabulary priority.
    const httplib::Headers taggedHeaders = {
        { "X-Conductor-Role", "reviewer" },
        { "X-Conductor-Group", "g-fields" },
        { "X-Conductor-Priority", "review" },
    };
    const auto tagged = client.Post(kChatPath, taggedHeaders, chatBody("fields-a"),
                                    "application/json");
    REQUIRE(tagged);
    CHECK(tagged->status == 200);

    // B: an out-of-vocabulary priority tag — the queue treated it as
    // interactive (11.4's SG-4 collapse), so the ledger must SAY interactive
    // or the POC's wait analysis lies.
    const auto urgent = client.Post(kChatPath, httplib::Headers{ { "X-Conductor-Priority", "urgent" } },
                                    chatBody("fields-b"), "application/json");
    REQUIRE(urgent);
    CHECK(urgent->status == 200);

    // C: untagged, and the body carries no usable model.
    const auto modelless = client.Post(
        kChatPath, httplib::Headers{},
        R"({"messages":[{"role":"user","content":"no model field"}]})", "application/json");
    REQUIRE(modelless);
    CHECK(modelless->status == 200);

    // D: the stub answers 500 — the status column records what the CLIENT got.
    const auto failed = client.Post(kChatPath, httplib::Headers{},
                                    chatBodyWith("fields-d", { { "status", 500 } }),
                                    "application/json");
    REQUIRE(failed);
    CHECK(failed->status == 500);

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 4));
    const std::vector<json> lines = ledgerLineJson(tmp.ledgerPath());
    REQUIRE(lines.size() == 4);
    for (const json& line : lines)
        checkLedgerKeys(line);

    const json lineA = lineForModel(tmp.ledgerPath(), "fields-a");
    CHECK(lineA["role"] == "reviewer");
    CHECK(lineA["group"] == "g-fields");
    CHECK(lineA["priority"] == "review");
    REQUIRE(lineA["queueWaitMs"].is_number());
    CHECK(lineA["queueWaitMs"].get<std::int64_t>() >= 0);
    // The upstream WAS attempted and answered, so upstreamMs is non-null.
    REQUIRE(lineA["upstreamMs"].is_number());
    CHECK(lineA["upstreamMs"].get<std::int64_t>() >= 0);
    // No usage in the stub's answer, no observation on an untagged-schema
    // request, no verdict: null, never a missing key.
    CHECK(lineA["promptTokens"].is_null());
    CHECK(lineA["completionTokens"].is_null());
    CHECK(lineA["timings"].is_null());
    CHECK(lineA["schemaMissing"].is_null());
    CHECK(lineA["schemaConformed"].is_null());
    CHECK(lineA["status"] == 200);

    const json lineB = lineForModel(tmp.ledgerPath(), "fields-b");
    CHECK(lineB["priority"] == "interactive");
    CHECK(lineB["role"].is_null());
    CHECK(lineB["group"].is_null());

    const json lineC = lineForModel(tmp.ledgerPath(), "");
    CHECK(lineC["priority"] == "interactive");
    CHECK(lineC["role"].is_null());
    CHECK(lineC["group"].is_null());
    CHECK(lineC["status"] == 200);

    const json lineD = lineForModel(tmp.ledgerPath(), "fields-d");
    CHECK(lineD["status"] == 500);
}

TEST_CASE(
    "[11.7-queue-wait] queueWaitMs is the wait measured across admit() and nothing else: a "
    "queued request records at least its held interval, an immediately-admitted one records "
    "near 0, and an un-admitted GET /v1/models records exactly 0") {
    TempDir tmp("queue-wait");

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(
        makeConfig(upstream.port(), tmp.ledgerPath(), /*maxInflightPerModel=*/1,
                   /*maxQueued=*/8, /*queueTimeoutMs=*/600000));
    router.start();

    RequestPtr held;
    RequestPtr queued;
    DrainGuard drain(upstream);

    // Immediately admitted: admit() returns without waiting, then the stub
    // holds the request OPEN (the hold is upstream time, not queue time — a
    // ledger that conflated them would fail the near-zero check below).
    held = postAsync(router.listen_port(), roleHeaders("held"),
                     requestBody(kModelA, "w-hold", true));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 1;
    }));

    // Queued behind the held slot.
    queued = enqueueAndAwait(router, router.listen_port(), roleHeaders("queued"),
                             requestBody(kModelA, "w-queued", false), 1);

    // The sleep CREATES the measured quantity — the wait itself, like 11.4's
    // elapsed-time case. Synchronization stays on queued_count()/the release:
    // by the time t0 was taken the entry was already waiting inside admit(),
    // so its true wait is at least (release instant - t0).
    const auto queuedObservedAt = std::chrono::steady_clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds{ 300 });
    const std::int64_t heldIntervalMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() -
                                                              queuedObservedAt)
            .count();

    upstream.releaseNext();

    held->join();
    REQUIRE(held->result());
    CHECK(held->result()->status == 200);

    queued->join();
    REQUIRE(queued->result());
    CHECK(queued->result()->status == 200);

    // The un-admitted read never reaches admit(): exactly 0, not merely small.
    httplib::Client client(kHost, router.listen_port());
    configureClient(client);
    const auto models = client.Get(kModelsPath);
    REQUIRE(models);
    CHECK(models->status == 200);

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 3));

    const json heldLine = lineForRole(tmp.ledgerPath(), "held");
    REQUIRE(heldLine["queueWaitMs"].is_number());
    // At or near 0: a slot was free, so admit() returned essentially
    // instantly. 250ms of slack absorbs scheduling noise while still
    // discriminating from the 300ms+ the queued request waited.
    CHECK(heldLine["queueWaitMs"].get<std::int64_t>() < 250);

    const json queuedLine = lineForRole(tmp.ledgerPath(), "queued");
    REQUIRE(queuedLine["queueWaitMs"].is_number());
    CHECK(queuedLine["queueWaitMs"].get<std::int64_t>() >= heldIntervalMs);

    const json modelsLine = lineForModel(tmp.ledgerPath(), "");
    CHECK(modelsLine["queueWaitMs"] == 0);
}

TEST_CASE(
    "[11.7-usage-nonstream] a buffered response's usage object fills the token columns and "
    "timings is copied VERBATIM from the same body; a body with neither records nulls while "
    "the response crosses byte-identically either way") {
    const json expectedTimings = json{ { "prompt_ms", 12.5 },
                                       { "predicted_ms", 80.25 },
                                       { "predicted_per_second", 52.5 } };

    std::string answer;
    bool expectUsage = false;

    SUBCASE("usage and timings present") {
        json envelope;
        envelope["id"] = "chatcmpl-1";
        envelope["object"] = "chat.completion";
        envelope["model"] = "usage-buffered";
        envelope["choices"] = json::array(
            { json{ { "index", 0 },
                    { "message", json{ { "role", "assistant" }, { "content", "counted" } } },
                    { "finish_reason", "stop" } } });
        envelope["usage"] =
            json{ { "prompt_tokens", 7 }, { "completion_tokens", 21 }, { "total_tokens", 28 } };
        envelope["timings"] = expectedTimings;
        // dump(2) keeps the bytes non-canonical relative to a default dump(),
        // so a parse-and-re-serialize on the return path is detectable.
        answer = envelope.dump(2);
        expectUsage = true;
    }

    SUBCASE("neither usage nor timings") {
        answer = kUpstreamAnswer;
    }

    TempDir tmp("usage-nonstream");

    StubUpstream upstream;
    answerWith(upstream, answer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Post(kChatPath, httplib::Headers{}, chatBody("usage-buffered"),
                                    "application/json");
    REQUIRE(result);
    // Reading usage never touches the relay: upstream status and exact bytes.
    CHECK(result->status == 200);
    CHECK(result->body == answer);
    CHECK(result->get_header_value("Content-Type") == "application/json");

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));
    const json line = lineForModel(tmp.ledgerPath(), "usage-buffered");
    checkLedgerKeys(line);

    if (expectUsage) {
        CHECK(line["promptTokens"] == 7);
        CHECK(line["completionTokens"] == 21);
        CHECK(line["timings"] == expectedTimings);
    }
    else {
        CHECK(line["promptTokens"].is_null());
        CHECK(line["completionTokens"].is_null());
        CHECK(line["timings"].is_null());
    }

    CHECK(line["status"] == 200);
}

TEST_CASE(
    "[11.7-usage-streamed] a chunked SSE response relays UNBUFFERED (first chunk observed "
    "before the stub produced the last) while the token counts come from the usage-bearing "
    "data: chunk before [DONE]; a stream with no usage chunk records nulls") {
    const std::string chunkOne =
        "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":"
        "\"first\"}}]}\n\n";

    const json expectedTimings = json{ { "prompt_ms", 3.25 }, { "predicted_ms", 41.5 } };

    std::string chunkTwo;
    bool expectUsage = false;

    SUBCASE("the final chunks carry usage and timings (Task 0.2's include_usage shape)") {
        json usageChunk;
        usageChunk["object"] = "chat.completion.chunk";
        usageChunk["choices"] = json::array();
        usageChunk["usage"] = json{ { "prompt_tokens", 11 }, { "completion_tokens", 5 } };
        usageChunk["timings"] = expectedTimings;
        chunkTwo = "data: " + usageChunk.dump() + "\n\ndata: [DONE]\n\n";
        expectUsage = true;
    }

    SUBCASE("no usage chunk anywhere") {
        chunkTwo =
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":"
            "\"second\"}}]}\n\n"
            "data: [DONE]\n\n";
    }

    TempDir tmp("usage-streamed");

    StreamGate gate;
    StubUpstream upstream;
    serveGatedStream(upstream, gate, chunkOne, chunkTwo);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    GateRelease gateRelease(gate);

    std::mutex receivedMutex;
    std::string received;
    std::atomic<bool> sawFirstChunk{ false };
    std::optional<httplib::Result> resultSlot;

    std::thread clientThread([&] {
        httplib::Client client(kHost, router.listen_port());
        configureClient(client);
        resultSlot.emplace(client.Post(
            kChatPath, httplib::Headers{}, streamRequestBody("usage-streamed"),
            "application/json", [&](const char* data, std::size_t length) {
                const std::lock_guard<std::mutex> lock(receivedMutex);
                received.append(data, length);
                if (received.find(chunkOne) != std::string::npos)
                    sawFirstChunk = true;

                return true;
            }));
    });

    const bool firstObservedInTime = waitUntil([&] {
        return sawFirstChunk.load();
    });

    // Snapshotted BEFORE the gate opens: the router relayed the first chunk
    // while the last did not exist yet, so nothing was buffered to be
    // inspected — usage is read from chunks AS THEY PASS or not at all.
    const bool secondWrittenAtObservation = gate.secondChunkWritten.load();

    gate.release();
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
        CHECK(received == chunkOne + chunkTwo);  // Every byte relayed.
    }

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));
    const json line = lineForModel(tmp.ledgerPath(), "usage-streamed");
    checkLedgerKeys(line);

    if (expectUsage) {
        CHECK(line["promptTokens"] == 11);
        CHECK(line["completionTokens"] == 5);
        CHECK(line["timings"] == expectedTimings);
    }
    else {
        CHECK(line["promptTokens"].is_null());
        CHECK(line["completionTokens"].is_null());
        CHECK(line["timings"].is_null());
    }

    // The streaming pin: no validator ran on streamed bytes, so the verdict
    // column is null on EVERY streamed response.
    CHECK(line["schemaConformed"].is_null());
    CHECK(line["status"] == 200);
}

TEST_CASE(
    "[11.7-streamed-line-once] a streamed request yields EXACTLY ONE line, appended after the "
    "stream completes — zero lines while the stub is still producing, one after [DONE], and "
    "one (never zero, never two) when the downstream disconnects mid-stream") {
    const std::string chunkOne =
        "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":"
        "\"first\"}}]}\n\n";

    json usageChunk;
    usageChunk["object"] = "chat.completion.chunk";
    usageChunk["choices"] = json::array();
    usageChunk["usage"] = json{ { "prompt_tokens", 11 }, { "completion_tokens", 5 } };
    const std::string chunkTwo = "data: " + usageChunk.dump() + "\n\ndata: [DONE]\n\n";

    constexpr const char* kStreamModel = "streamed-once";

    TempDir tmp("streamed-once");

    StreamGate gate;
    StubUpstream upstream;
    serveGatedStream(upstream, gate, chunkOne, chunkTwo);
    answerModels(upstream);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    GateRelease gateRelease(gate);

    SUBCASE("completed stream: the line lands at completion, not at handler return") {
        std::mutex receivedMutex;
        std::string received;
        std::atomic<bool> sawFirstChunk{ false };
        std::optional<httplib::Result> resultSlot;

        std::thread clientThread([&] {
            httplib::Client client(kHost, router.listen_port());
            configureClient(client);
            resultSlot.emplace(client.Post(
                kChatPath, httplib::Headers{}, streamRequestBody(kStreamModel),
                "application/json", [&](const char* data, std::size_t length) {
                    const std::lock_guard<std::mutex> lock(receivedMutex);
                    received.append(data, length);
                    if (received.find(chunkOne) != std::string::npos)
                        sawFirstChunk = true;

                    return true;
                }));
        });

        REQUIRE(waitUntil([&] {
            return sawFirstChunk.load();
        }));

        // Mid-stream: the handler has long returned (the client holds the
        // first chunk), yet NO line exists. A handler-return design would
        // have written one already — with null token counts forever, which is
        // exactly how C-033-class defects poison the production dataset.
        CHECK_FALSE(gate.secondChunkWritten.load());
        CHECK(ledgerLineCount(tmp.ledgerPath()) == 0);

        gate.release();
        clientThread.join();

        REQUIRE(resultSlot.has_value());
        REQUIRE(*resultSlot);
        CHECK((*resultSlot)->status == 200);

        REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));
        const json line = lineForModel(tmp.ledgerPath(), kStreamModel);
        checkLedgerKeys(line);
        // Written AFTER the usage chunk crossed, so the counts are real.
        CHECK(line["promptTokens"] == 11);
        CHECK(line["completionTokens"] == 5);

        // A later request's line landing proves the guard did not fire again
        // in the meantime: still exactly one line for the streamed request.
        httplib::Client client(kHost, router.listen_port());
        configureClient(client);
        const auto models = client.Get(kModelsPath);
        REQUIRE(models);
        CHECK(models->status == 200);
        REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 2));

        const std::vector<json> streamedLines =
            linesWhere(tmp.ledgerPath(), [](const json& candidate) {
                return candidate.value("model", std::string()) == kStreamModel;
            });
        CHECK(streamedLines.size() == 1);
    }

    SUBCASE("downstream disconnect mid-stream: exactly one line, never zero, never two") {
        std::atomic<bool> sawFirstChunk{ false };
        std::optional<httplib::Result> resultSlot;

        std::thread clientThread([&] {
            httplib::Client client(kHost, router.listen_port());
            configureClient(client);
            resultSlot.emplace(client.Post(
                kChatPath, httplib::Headers{}, streamRequestBody(kStreamModel),
                "application/json", [&](const char* /*data*/, std::size_t /*length*/) {
                    sawFirstChunk = true;
                    return false;  // Hang up on the router mid-stream.
                }));
        });

        REQUIRE(waitUntil([&] {
            return sawFirstChunk.load();
        }));

        clientThread.join();  // The client has aborted the connection.

        // Free the stub; the router's relay now discovers the dead downstream
        // (a failed write or the finished upstream), the provider is
        // destroyed, and the record guard must fire EXACTLY once.
        gate.release();

        REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));
        const json line = lineForModel(tmp.ledgerPath(), kStreamModel);
        checkLedgerKeys(line);

        // A later completed request fences the "never two": its line arrives,
        // and the disconnected stream STILL has exactly one.
        httplib::Client client(kHost, router.listen_port());
        configureClient(client);
        const auto models = client.Get(kModelsPath);
        REQUIRE(models);
        CHECK(models->status == 200);
        REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 2));

        const std::vector<json> streamedLines =
            linesWhere(tmp.ledgerPath(), [](const json& candidate) {
                return candidate.value("model", std::string()) == kStreamModel;
            });
        CHECK(streamedLines.size() == 1);
    }
}

TEST_CASE(
    "[11.7-schema-observations] the schema columns are caller-supplied verbatim — record() "
    "writes true/false/null for engaged/engaged/absent — and end-to-end the router passes "
    "11.6's observation through untouched, so untagged means null-null") {
    // The pure module seam first: metrics derives NOTHING — three-valued in,
    // three-valued out, for both columns independently.
    {
        TempDir tmp("schema-module");
        MetricsLedger ledger(makeConfig(8080, tmp.ledgerPath()));

        RequestRecord observedTrue = makeRecord("sm-true", 200, 0);
        observedTrue.schemaMissing = true;
        observedTrue.schemaConformed = true;
        ledger.record(observedTrue);

        RequestRecord observedFalse = makeRecord("sm-false", 200, 0);
        observedFalse.schemaMissing = false;
        observedFalse.schemaConformed = false;
        ledger.record(observedFalse);

        // Both left disengaged: no observation, no verdict.
        ledger.record(makeRecord("sm-null", 200, 0));

        const json trueLine = lineForModel(tmp.ledgerPath(), "sm-true");
        CHECK(trueLine["schemaMissing"] == true);
        CHECK(trueLine["schemaConformed"] == true);

        const json falseLine = lineForModel(tmp.ledgerPath(), "sm-false");
        CHECK(falseLine["schemaMissing"] == false);
        CHECK(falseLine["schemaConformed"] == false);

        const json nullLine = lineForModel(tmp.ledgerPath(), "sm-null");
        CHECK(nullLine["schemaMissing"].is_null());
        CHECK(nullLine["schemaConformed"].is_null());
    }

    // End-to-end: what 11.6 observed is what the ledger says. The stub answers
    // a chat.completion whose output text is the request body's own "answer"
    // field, so each request chooses the verdict 11.6 will reach.
    TempDir tmp("schema-e2e");

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/.*", [&upstream](const httplib::Request& request, httplib::Response& response) {
            upstream.record(request);
            const json body = json::parse(request.body, nullptr, /*allow_exceptions=*/false);
            if (!body.is_discarded() && body.is_object() && body.contains("answer") &&
                body["answer"].is_string()) {
                json envelope;
                envelope["id"] = "chatcmpl-1";
                envelope["object"] = "chat.completion";
                envelope["choices"] = json::array(
                    { json{ { "index", 0 },
                            { "message", json{ { "role", "assistant" },
                                               { "content", body["answer"].get<std::string>() } } },
                            { "finish_reason", "stop" } } });
                response.set_content(envelope.dump(), "application/json");
                return;
            }

            response.set_content(kUpstreamAnswer, "application/json");
        });
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const httplib::Headers schemaTagged = { { "X-Conductor-Schema", "required" } };
    const json okSchema = json::parse(
        R"({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false})");

    // 1. Untagged: NO observation and NO verdict were made — null, null.
    const auto untagged = client.Post(kChatPath, httplib::Headers{}, chatBody("obs-untagged"),
                                      "application/json");
    REQUIRE(untagged);
    CHECK(untagged->status == 200);

    // 2. Tagged but schemaless: observed missing.
    const auto missing = client.Post(kChatPath, schemaTagged, chatBody("obs-missing"),
                                     "application/json");
    REQUIRE(missing);
    CHECK(missing->status == 200);

    // 3. Tagged, declared, and the buffered answer CONFORMS: verdict true.
    const auto conforming = client.Post(
        kChatPath, schemaTagged,
        chatBodyWith("obs-conforming",
                     { { "response_format",
                         json{ { "type", "json_schema" },
                               { "json_schema", json{ { "name", "Ok" }, { "schema", okSchema } } } } },
                       { "answer", "{\"ok\":true}" } }),
        "application/json");
    REQUIRE(conforming);
    CHECK(conforming->status == 200);

    // 4. Same declaration, non-JSON output text: verdict false.
    const auto failing = client.Post(
        kChatPath, schemaTagged,
        chatBodyWith("obs-failing",
                     { { "response_format",
                         json{ { "type", "json_schema" },
                               { "json_schema", json{ { "name", "Ok" }, { "schema", okSchema } } } } },
                       { "answer", "not JSON output at all" } }),
        "application/json");
    REQUIRE(failing);
    CHECK(failing->status == 200);

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 4));

    const json untaggedLine = lineForModel(tmp.ledgerPath(), "obs-untagged");
    CHECK(untaggedLine["schemaMissing"].is_null());
    CHECK(untaggedLine["schemaConformed"].is_null());

    const json missingLine = lineForModel(tmp.ledgerPath(), "obs-missing");
    CHECK(missingLine["schemaMissing"] == true);
    CHECK(missingLine["schemaConformed"].is_null());

    const json conformingLine = lineForModel(tmp.ledgerPath(), "obs-conforming");
    CHECK(conformingLine["schemaMissing"] == false);
    CHECK(conformingLine["schemaConformed"] == true);

    const json failingLine = lineForModel(tmp.ledgerPath(), "obs-failing");
    CHECK(failingLine["schemaMissing"] == false);
    CHECK(failingLine["schemaConformed"] == false);

    // The streamed-response half of this row — schemaConformed null on every
    // streamed response — is pinned where the chunked relay is driven:
    // [11.7-usage-streamed] asserts it on its ledger line.
}

TEST_CASE(
    "[11.7-shed-ledgered] an admission refusal still gets its line — overflow: 503, null "
    "upstreamMs, null tokens, near-zero wait; timeout: 503, null upstreamMs, null tokens, "
    "wait of at least queueTimeoutMs — and the stub saw NO request for it") {
    TempDir tmp("shed");

    SUBCASE("queue overflow") {
        constexpr std::int64_t kQueueTimeoutMs = 30000;

        HoldingUpstream upstream;
        upstream.start();

        conductor::router::Router router(
            makeConfig(upstream.port(), tmp.ledgerPath(), /*maxInflightPerModel=*/1,
                       /*maxQueued=*/1, kQueueTimeoutMs));
        router.start();

        RequestPtr held;
        RequestPtr queued;
        DrainGuard drain(upstream);

        held = postAsync(router.listen_port(), {}, requestBody(kModelA, "o-hold", true));
        REQUIRE(waitUntil([&upstream] {
            return upstream.seenCount() == 1;
        }));

        queued = enqueueAndAwait(router, router.listen_port(), {},
                                 requestBody(kModelA, "o-q1", true), 1);

        // The queue is full: the next request is refused ON ARRIVAL.
        httplib::Client client(kHost, router.listen_port());
        client.set_connection_timeout(10, 0);
        client.set_read_timeout(kClientReadTimeoutSeconds, 0);

        const auto shed = client.Post(kChatPath, httplib::Headers{},
                                      requestBody(kModelA, "o-shed", true), "application/json");
        REQUIRE(shed);
        CHECK(shed->status == 503);

        // The refused request never crossed to the upstream.
        CHECK_FALSE(upstream.sawMarker("o-shed"));

        upstream.releaseAll();
        held->join();
        queued->join();
        REQUIRE(held->result());
        CHECK(held->result()->status == 200);
        REQUIRE(queued->result());
        CHECK(queued->result()->status == 200);

        // Three requests entered the handler, three lines — the shed tail is
        // IN the dataset, or every 503 the fan-out side sees is invisible.
        REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 3));
        const json shedLine = lineForStatus(tmp.ledgerPath(), 503);
        checkLedgerKeys(shedLine);
        CHECK(shedLine["upstreamMs"].is_null());
        CHECK(shedLine["promptTokens"].is_null());
        CHECK(shedLine["completionTokens"].is_null());
        REQUIRE(shedLine["queueWaitMs"].is_number());
        // Overflowed returns immediately, never after a wait: nowhere near
        // the 30s timeout it would have waited out had it been queued.
        CHECK(shedLine["queueWaitMs"].get<std::int64_t>() < 1000);
    }

    SUBCASE("queue timeout") {
        constexpr std::int64_t kQueueTimeoutMs = 1200;

        HoldingUpstream upstream;
        upstream.start();

        conductor::router::Router router(
            makeConfig(upstream.port(), tmp.ledgerPath(), /*maxInflightPerModel=*/1,
                       /*maxQueued=*/8, kQueueTimeoutMs));
        router.start();

        RequestPtr held;
        RequestPtr timingOut;
        DrainGuard drain(upstream);

        held = postAsync(router.listen_port(), {}, requestBody(kModelA, "t-hold", true));
        REQUIRE(waitUntil([&upstream] {
            return upstream.seenCount() == 1;
        }));

        timingOut = enqueueAndAwait(router, router.listen_port(), {},
                                    requestBody(kModelA, "t-timeout", true), 1);

        // Waiting on the request's OWN completion — the elapsed wait is the
        // behaviour under test and is read back from the ledger below.
        REQUIRE(waitUntil([&timingOut] {
            return timingOut->done();
        }));

        timingOut->join();
        REQUIRE(timingOut->result());
        CHECK(timingOut->result()->status == 503);
        CHECK_FALSE(upstream.sawMarker("t-timeout"));

        upstream.releaseAll();
        held->join();
        REQUIRE(held->result());
        CHECK(held->result()->status == 200);

        REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 2));
        const json shedLine = lineForStatus(tmp.ledgerPath(), 503);
        checkLedgerKeys(shedLine);
        CHECK(shedLine["upstreamMs"].is_null());
        CHECK(shedLine["promptTokens"].is_null());
        CHECK(shedLine["completionTokens"].is_null());
        REQUIRE(shedLine["queueWaitMs"].is_number());
        // It genuinely waited the queue out: admit() parks until the
        // deadline, so the measured wait is at least queueTimeoutMs.
        CHECK(shedLine["queueWaitMs"].get<std::int64_t>() >= kQueueTimeoutMs);
    }
}

TEST_CASE(
    "[11.7-unreachable-ledgered] the router-origin 502 envelope is ledgered: status 502, null "
    "token counts, and a NON-null upstreamMs — the upstream was attempted, unlike a shed "
    "request") {
    TempDir tmp("unreachable");

    // Reserve a genuinely-free port by binding an ephemeral listener and
    // stopping it (the 11.3-upstream-down-502 idiom).
    int deadPort = 0;
    {
        StubUpstream reserver;
        reserver.start();
        deadPort = reserver.port();
        reserver.stop();
    }

    conductor::router::Router router(makeConfig(deadPort, tmp.ledgerPath()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto down = client.Post(kChatPath, httplib::Headers{}, chatBody("unreachable-m"),
                                  "application/json");
    REQUIRE(down);
    CHECK(down->status == 502);
    CHECK(down->get_header_value("Content-Type") == "application/json");

    // 11.3's committed envelope, unchanged by the ledger threading.
    const json envelope = json::parse(down->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(envelope.is_discarded());
    REQUIRE(envelope.contains("error"));
    CHECK(envelope["error"]["type"] == "router_upstream_unreachable");
    CHECK(envelope["error"]["code"] == 502);

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));
    const json line = lineForModel(tmp.ledgerPath(), "unreachable-m");
    checkLedgerKeys(line);
    CHECK(line["status"] == 502);
    CHECK(line["promptTokens"].is_null());
    CHECK(line["completionTokens"].is_null());
    // Attempted, unlike a shed request: the connect failure took measurable
    // (possibly zero-rounded) time, and the column must say so.
    REQUIRE(line["upstreamMs"].is_number());
    CHECK(line["upstreamMs"].get<std::int64_t>() >= 0);
}

TEST_CASE(
    "[11.7-metrics-aggregates] summary()/GET /conductor/metrics serve the pinned union: the "
    "six MetricsSummary names byte-identical, plus exact nearest-rank waitMsP50/waitMsP95 and "
    "schemaConformanceRate with a null zero-denominator") {
    // --- the module half: exact arithmetic over hand-computed samples -------
    {
        TempDir tmp("aggregates-module");
        MetricsLedger ledger(makeConfig(8080, tmp.ledgerPath()));

        // N == 0: zeros, an empty statusCounts object, and a NULL rate —
        // never NaN, never 0, never a missing key.
        {
            const json empty = ledger.summary();
            INFO("empty summary: ", empty.dump());
            for (const char* key : kSummaryKeys)
                CHECK(empty.contains(key));

            CHECK(empty["totalRequests"] == 0);
            CHECK(empty["schemaMissing"] == 0);
            CHECK(empty["schemaConformed"] == 0);
            CHECK(empty["statusCounts"] == json::object());
            CHECK(empty["promptTokens"] == 0);
            CHECK(empty["completionTokens"] == 0);
            CHECK(empty["waitMsP50"] == 0);
            CHECK(empty["waitMsP95"] == 0);
            CHECK(empty["schemaConformanceRate"].is_null());
        }

        // Five records, waits deliberately recorded out of order so the
        // percentiles must SORT: sorted queueWaitMs = [0, 10, 20, 40, 90].
        RequestRecord r1 = makeRecord("agg-1", 200, 40);
        r1.promptTokens = 10;
        r1.completionTokens = 20;
        r1.schemaMissing = true;
        r1.schemaConformed = true;
        ledger.record(r1);

        RequestRecord r2 = makeRecord("agg-2", 200, 0);
        r2.schemaMissing = false;
        r2.schemaConformed = false;
        ledger.record(r2);

        ledger.record(makeRecord("agg-3", 503, 90));

        RequestRecord r4 = makeRecord("agg-4", 200, 10);
        r4.promptTokens = 5;
        r4.completionTokens = 1;
        r4.schemaMissing = true;
        ledger.record(r4);

        ledger.record(makeRecord("agg-5", 502, 20));

        {
            const json summary = ledger.summary();
            INFO("summary at N=5: ", summary.dump());
            CHECK(summary["totalRequests"] == 5);
            CHECK(summary["schemaMissing"] == 2);      // r1, r4 observed missing.
            CHECK(summary["schemaConformed"] == 1);    // r1 alone conformed.
            CHECK(summary["statusCounts"] == json{ { "200", 3 }, { "502", 1 }, { "503", 1 } });
            CHECK(summary["promptTokens"] == 15);      // 10 + 5, nulls ignored.
            CHECK(summary["completionTokens"] == 21);  // 20 + 1.
            // Nearest-rank, 1-indexed over [0,10,20,40,90]:
            //   p50 rank ceil(0.50*5) = 3 -> 20; p95 rank ceil(0.95*5) = 5 -> 90.
            CHECK(summary["waitMsP50"] == 20);
            CHECK(summary["waitMsP95"] == 90);
            // 1 true / 2 non-null verdicts.
            REQUIRE(summary["schemaConformanceRate"].is_number());
            CHECK(summary["schemaConformanceRate"].get<double>() == doctest::Approx(0.5));
        }

        // A sixth record exercises the even-N ranks: sorted samples
        // [0,10,20,40,90,100], p50 rank ceil(3.0) = 3 -> 20, p95 rank
        // ceil(5.7) = 6 -> 100.
        RequestRecord r6 = makeRecord("agg-6", 200, 100);
        r6.promptTokens = 1;
        r6.completionTokens = 1;
        r6.schemaConformed = true;
        ledger.record(r6);

        const json summary = ledger.summary();
        INFO("summary at N=6: ", summary.dump());
        CHECK(summary["totalRequests"] == 6);
        CHECK(summary["statusCounts"] == json{ { "200", 4 }, { "502", 1 }, { "503", 1 } });
        CHECK(summary["promptTokens"] == 16);
        CHECK(summary["completionTokens"] == 22);
        CHECK(summary["waitMsP50"] == 20);
        CHECK(summary["waitMsP95"] == 100);
        CHECK(summary["schemaConformed"] == 2);
        REQUIRE(summary["schemaConformanceRate"].is_number());
        CHECK(summary["schemaConformanceRate"].get<double>() == doctest::Approx(2.0 / 3.0));
    }

    // --- the endpoint half: a known mix through the live Router --------------
    TempDir tmp("aggregates-endpoint");

    json usageEnvelope;
    usageEnvelope["object"] = "chat.completion";
    usageEnvelope["choices"] = json::array(
        { json{ { "index", 0 },
                { "message", json{ { "role", "assistant" }, { "content", "ok" } } },
                { "finish_reason", "stop" } } });
    usageEnvelope["usage"] =
        json{ { "prompt_tokens", 7 }, { "completion_tokens", 3 }, { "total_tokens", 10 } };

    StubUpstream upstream;
    upstream.server().Post(
        "/v1/.*", [&upstream, answer = usageEnvelope.dump()](const httplib::Request& request,
                                                             httplib::Response& response) {
            upstream.record(request);
            const json body = json::parse(request.body, nullptr, /*allow_exceptions=*/false);
            const bool object = !body.is_discarded() && body.is_object();
            if (object)
                response.status = body.value("status", 200);

            if (object && body.value("withUsage", false)) {
                response.set_content(answer, "application/json");
                return;
            }

            response.set_content(kUpstreamAnswer, "application/json");
        });
    answerModels(upstream);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath()));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // The mix: one 200 with usage, one 500 without, one tagged-schema-missing
    // 200, and the un-admitted GET /v1/models.
    const auto withUsage = client.Post(kChatPath, httplib::Headers{},
                                       chatBodyWith("mix-a", { { "withUsage", true } }),
                                       "application/json");
    REQUIRE(withUsage);
    CHECK(withUsage->status == 200);

    const auto failed = client.Post(kChatPath, httplib::Headers{},
                                    chatBodyWith("mix-b", { { "status", 500 } }),
                                    "application/json");
    REQUIRE(failed);
    CHECK(failed->status == 500);

    const auto taggedMissing = client.Post(kChatPath,
                                           httplib::Headers{ { "X-Conductor-Schema",
                                                               "required" } },
                                           chatBody("mix-c"), "application/json");
    REQUIRE(taggedMissing);
    CHECK(taggedMissing->status == 200);

    const auto models = client.Get(kModelsPath);
    REQUIRE(models);
    CHECK(models->status == 200);

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 4));

    const auto metrics = client.Get(kMetricsRoute);
    REQUIRE(metrics);
    CHECK(metrics->status == 200);
    CHECK(metrics->get_header_value("Content-Type") == "application/json");

    const json body = json::parse(metrics->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(body.is_discarded());
    INFO("metrics body: ", body.dump());

    // The COMMITTED router-client.ts MetricsSummary casts this object without
    // validating, so the six overlapping names must be byte-identical — plus
    // the three plan-named extras.
    for (const char* key : kSummaryKeys)
        CHECK(body.contains(key));

    CHECK(body["totalRequests"] == 4);
    CHECK(body["statusCounts"] == json{ { "200", 3 }, { "500", 1 } });
    CHECK(body["promptTokens"] == 7);
    CHECK(body["completionTokens"] == 3);
    CHECK(body["schemaMissing"] == 1);  // mix-c alone was observed missing.
    CHECK(body["schemaConformed"] == 0);
    // Zero verdicts exist (untagged/streaming pin): the rate is NULL, which a
    // zero would misreport as "nothing ever conformed".
    CHECK(body["schemaConformanceRate"].is_null());
    // Nothing queued in this mix, so the percentiles are near-zero waits —
    // their exact arithmetic is pinned in the module half above.
    REQUIRE(body["waitMsP50"].is_number());
    REQUIRE(body["waitMsP95"].is_number());
    CHECK(body["waitMsP50"].get<double>() >= 0);
    CHECK(body["waitMsP95"].get<double>() >= 0);
    CHECK(body["waitMsP95"].get<double>() < 1000);
}

TEST_CASE(
    "[11.7-metrics-endpoint-outside-admission] GET /conductor/metrics answers 200 while every "
    "slot is held and the queue is full — 11.4's pool-exhaustion proof on the metrics route — "
    "and serving it neither appends a line nor increments totalRequests") {
    constexpr int kInflightCap = 2;

    // Sized ABOVE httplib's default pool on whatever machine runs this, so a
    // router that did not size its task queue starves here (the 11.4 idiom).
    const int queueDepth =
        std::max(32, static_cast<int>(std::thread::hardware_concurrency()) + 16);

    TempDir tmp("endpoint-exhaustion");

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath(), kInflightCap,
                                                queueDepth, 600000));
    router.start();

    std::vector<RequestPtr> inFlight;
    std::vector<RequestPtr> queued;
    DrainGuard drain(upstream);

    for (int slot = 0; slot < kInflightCap; ++slot) {
        inFlight.push_back(postAsync(router.listen_port(), {},
                                     requestBody(kModelA, "m-hold-" + std::to_string(slot), true)));
    }

    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == static_cast<std::size_t>(kInflightCap);
    }));

    for (int entry = 0; entry < queueDepth; ++entry) {
        queued.push_back(postAsync(router.listen_port(), {},
                                   requestBody(kModelA, "m-q-" + std::to_string(entry), true)));
    }

    REQUIRE(waitUntil(
        [&router, queueDepth] {
            return router.admission().queued_count() == static_cast<std::size_t>(queueDepth);
        },
        std::chrono::seconds{ 30 }));

    // Nothing has COMPLETED, so nothing is ledgered yet.
    CHECK(ledgerLineCount(tmp.ledgerPath()) == 0);

    httplib::Client client(kHost, router.listen_port());
    client.set_connection_timeout(10, 0);
    client.set_read_timeout(kClientReadTimeoutSeconds, 0);

    const auto askedAt = std::chrono::steady_clock::now();
    const auto metrics = client.Get(kMetricsRoute);
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - askedAt)
                             .count();

    REQUIRE(metrics);
    CHECK(metrics->status == 200);
    // Promptly: answered, not merely eventually dispatched behind the
    // blocked handlers.
    CHECK(elapsed < 5000);

    const json first = json::parse(metrics->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(first.is_discarded());
    CHECK(first["totalRequests"] == 0);

    // Polling the endpoint can never inflate the dataset it reports: a second
    // read sees the same totals and the file gained nothing.
    const auto again = client.Get(kMetricsRoute);
    REQUIRE(again);
    CHECK(again->status == 200);

    const json second = json::parse(again->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(second.is_discarded());
    CHECK(second["totalRequests"] == first["totalRequests"]);
    CHECK(ledgerLineCount(tmp.ledgerPath()) == 0);

    // Registered OUTSIDE admission: it neither queued nor consumed a slot.
    CHECK(router.admission().queued_count() == static_cast<std::size_t>(queueDepth));

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
    "[11.7-health-body] GET /conductor/health still answers HTTP 200 — all routerHealthy "
    "needs — with the extended body {status:ok, version:router_version()}, while proxied "
    "traffic is in flight") {
    TempDir tmp("health");

    HoldingUpstream upstream;
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), tmp.ledgerPath(),
                                                /*maxInflightPerModel=*/1));
    router.start();

    RequestPtr held;
    DrainGuard drain(upstream);

    // Proxied traffic genuinely in flight while health is probed.
    held = postAsync(router.listen_port(), {}, requestBody(kModelA, "health-hold", true));
    REQUIRE(waitUntil([&upstream] {
        return upstream.seenCount() == 1;
    }));

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto health = client.Get(kHealthRoute);
    REQUIRE(health);
    CHECK(health->status == 200);

    const json body = json::parse(health->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(body.is_discarded());
    // `status` keeps its committed value: 11.4's [11.4-health-at-full-queue]
    // asserts it and must stay green.
    CHECK(body.value("status", std::string()) == "ok");
    // `version` is router_version() — never a second version constant.
    CHECK(body.value("version", std::string()) == conductor::router::router_version());
    CHECK(body.value("version", std::string()) == conductor::router::kRouterVersion);

    // Health is never ledgered: nothing has completed, nothing is written.
    CHECK(ledgerLineCount(tmp.ledgerPath()) == 0);

    upstream.releaseAll();
    held->join();
    REQUIRE(held->result());
    CHECK(held->result()->status == 200);
}

TEST_CASE(
    "[11.7-ledger-path-config] the ledger location comes ONLY from the parsed "
    "RouterConfig::metrics.ledgerPath: the missing parent directory is created, each instance "
    "writes to its own configured file, and nothing else appears") {
    TempDir tmp("path");

    // Parents deliberately missing, two levels deep.
    const std::filesystem::path pathA = tmp.path() / "a" / "deep" / "metrics.jsonl";
    const std::filesystem::path pathB = tmp.path() / "b" / "other-name.jsonl";

    MetricsLedger ledgerA(makeConfig(8080, pathA));
    // Construction created the parent, so the very first append cannot fail
    // on a fresh deployment.
    CHECK(std::filesystem::exists(pathA.parent_path()));

    ledgerA.record(makeRecord("path-a-1", 200, 0));
    REQUIRE(std::filesystem::exists(pathA));
    CHECK(ledgerLineCount(pathA) == 1);

    // A second instance from a config naming a DIFFERENT path writes there
    // and only there — the path is read from the struct, never hardcoded.
    MetricsLedger ledgerB(makeConfig(8080, pathB));
    ledgerB.record(makeRecord("path-b-1", 200, 0));
    ledgerB.record(makeRecord("path-b-2", 503, 5));

    CHECK(ledgerLineCount(pathB) == 2);
    CHECK(ledgerLineCount(pathA) == 1);  // A gained nothing from B's writes.

    CHECK(lineForModel(pathA, "path-a-1")["status"] == 200);
    CHECK(lineForModel(pathB, "path-b-2")["status"] == 503);

    // "Exactly there and nowhere else": the ONLY regular files under the
    // doctest-owned root are the two configured ledgers. (The §2.2 default
    // .data/router/metrics.jsonl is untouchable to every test in this file —
    // all fixtures point into TempDir by construction.)
    std::set<std::filesystem::path> files;
    for (const auto& entry : std::filesystem::recursive_directory_iterator(tmp.path())) {
        if (entry.is_regular_file())
            files.insert(entry.path());
    }

    CHECK(files == std::set<std::filesystem::path>{ pathA, pathB });
}

TEST_CASE(
    "[11.7-failsoft-ledger] a ledger write failure NEVER fails the proxied request (G5): same "
    "status, headers and bytes as the healthy case, a warn on the log naming the path, no "
    "router-minted 5xx, and the in-memory aggregate still counts the request") {
    // The healthy baseline: what the client gets when the ledger CAN write.
    int healthyStatus = 0;
    std::string healthyContentType;
    std::string healthyBody;

    {
        TempDir healthyDir("failsoft-healthy");

        StubUpstream upstream;
        answerWith(upstream, kUpstreamAnswer);
        upstream.start();

        conductor::router::Router router(makeConfig(upstream.port(), healthyDir.ledgerPath()));
        router.start();

        httplib::Client client(kHost, router.listen_port());
        configureClient(client);

        const auto result = client.Post(kChatPath, httplib::Headers{}, chatBody("failsoft-m"),
                                        "application/json");
        REQUIRE(result);
        healthyStatus = result->status;
        healthyContentType = result->get_header_value("Content-Type");
        healthyBody = result->body;
        REQUIRE(awaitLedgerLines(healthyDir.ledgerPath(), 1));
    }

    // An unwritable ledger location: the configured path's parent is a
    // regular FILE, so neither the directory nor the ledger can ever be
    // created — every append fails, portably and without permission games.
    TempDir brokenDir("failsoft-broken");
    const std::filesystem::path blocker = brokenDir.path() / "blocker";
    {
        std::ofstream out(blocker, std::ios::binary);
        REQUIRE(out.is_open());
        out << "a regular file where a directory is needed";
    }

    const std::filesystem::path badLedger = blocker / "metrics.jsonl";
    const std::string badLedgerText = badLedger.string();

    // Installed BEFORE the router exists and removed after it is gone, so the
    // default logger's sink list is never mutated beside live server threads.
    CaptureWarnings warnings;

    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    conductor::router::Router router(makeConfig(upstream.port(), badLedger));
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    const auto result = client.Post(kChatPath, httplib::Headers{}, chatBody("failsoft-m"),
                                    "application/json");
    REQUIRE(result);
    // The law itself: the direct path would have served this request, so the
    // router must too — SAME status, headers and body bytes, no minted 5xx.
    CHECK(result->status == healthyStatus);
    CHECK(result->get_header_value("Content-Type") == healthyContentType);
    CHECK(result->body == healthyBody);

    // The failure is journaled at warn, naming the path that could not be
    // written. Polled: the append fires at response completion, which can
    // trail the client's last byte by a scheduling instant.
    REQUIRE(waitUntil([&warnings, &badLedgerText] {
        return warnings.anyMentions({ badLedgerText });
    }));

    // The aggregate does not silently under-count what the file lost.
    const auto metrics = client.Get(kMetricsRoute);
    REQUIRE(metrics);
    CHECK(metrics->status == 200);

    const json summary = json::parse(metrics->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(summary.is_discarded());
    CHECK(summary["totalRequests"] == 1);

    // Nothing could be written — and nothing was.
    CHECK_FALSE(std::filesystem::exists(badLedger));
}

TEST_CASE(
    "[11.7-concurrent-appends] concurrent completions never tear or interleave a line: every "
    "line parses standalone with the full column set, the recovered marker set equals the "
    "sent set, and totalRequests equals N") {
    // The module hammer: raw record() contention far beyond what the HTTP
    // harness can generate, with padded fields to widen every write.
    {
        TempDir tmp("concurrent-module");
        MetricsLedger ledger(makeConfig(8080, tmp.ledgerPath()));

        constexpr int kThreads = 6;
        constexpr int kPerThread = 40;

        std::vector<std::thread> writers;
        writers.reserve(kThreads);
        for (int t = 0; t < kThreads; ++t) {
            writers.emplace_back([&ledger, t] {
                for (int i = 0; i < kPerThread; ++i) {
                    RequestRecord record = makeRecord(
                        "hammer-" + std::to_string(t) + "-" + std::to_string(i), 200, i);
                    record.role = "padding-" + std::string(120, 'r');
                    record.promptTokens = i;
                    record.completionTokens = i;
                    if (i % 3 == 0)
                        record.schemaMissing = true;
                    else if (i % 3 == 1)
                        record.schemaMissing = false;

                    ledger.record(record);
                }
            });
        }

        for (std::thread& writer : writers)
            writer.join();

        const std::vector<json> lines = ledgerLineJson(tmp.ledgerPath());
        REQUIRE(lines.size() == static_cast<std::size_t>(kThreads * kPerThread));

        std::set<std::string> recovered;
        for (const json& line : lines) {
            checkLedgerKeys(line);
            recovered.insert(line.value("model", std::string()));
        }

        std::set<std::string> sent;
        for (int t = 0; t < kThreads; ++t) {
            for (int i = 0; i < kPerThread; ++i)
                sent.insert("hammer-" + std::to_string(t) + "-" + std::to_string(i));
        }

        CHECK(recovered == sent);
        CHECK(ledger.summary()["totalRequests"] == kThreads * kPerThread);
    }

    // End-to-end: N requests completing concurrently against the stub.
    constexpr int kConcurrent = 8;

    TempDir tmp("concurrent-e2e");

    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    upstream.start();

    // maxInflightPerModel 1 sizes the distinct-in-flight budget (ISSUE-042) to
    // exactly this burst of distinct keys, so all kConcurrent are admitted at once
    // — each its own admission bucket AND its own ledger marker — and the ledger is
    // still hammered by kConcurrent live completions.
    conductor::router::Router router(
        makeConfig(upstream.port(), tmp.ledgerPath(), /*maxInflightPerModel=*/1));
    router.start();

    std::vector<RequestPtr> requests;
    requests.reserve(kConcurrent);
    for (int i = 0; i < kConcurrent; ++i) {
        requests.push_back(
            postAsync(router.listen_port(), {}, chatBody("cc-" + std::to_string(i))));
    }

    for (const RequestPtr& request : requests) {
        request->join();
        REQUIRE(request->result());
        CHECK(request->result()->status == 200);
    }

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), kConcurrent));
    const std::vector<json> lines = ledgerLineJson(tmp.ledgerPath());
    REQUIRE(lines.size() == static_cast<std::size_t>(kConcurrent));

    std::set<std::string> recovered;
    for (const json& line : lines) {
        checkLedgerKeys(line);
        recovered.insert(line.value("model", std::string()));
    }

    std::set<std::string> sent;
    for (int i = 0; i < kConcurrent; ++i)
        sent.insert("cc-" + std::to_string(i));

    CHECK(recovered == sent);

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);
    const auto metrics = client.Get(kMetricsRoute);
    REQUIRE(metrics);
    CHECK(metrics->status == 200);

    const json summary = json::parse(metrics->body, nullptr, /*allow_exceptions=*/false);
    REQUIRE_FALSE(summary.is_discarded());
    CHECK(summary["totalRequests"] == kConcurrent);
}

TEST_CASE(
    "[11.7-aggregate-in-memory] the aggregate is in-memory since process start, never a ledger "
    "re-read: pre-existing lines contribute nothing to summary() yet stay byte-preserved on "
    "disk — the module appends, never rewrites — which is why Phase 14 reads the FILE") {
    TempDir tmp("in-memory");
    const std::filesystem::path ledgerPath = tmp.ledgerPath();

    // A prior run's ledger: two well-formed full-column lines already on disk.
    {
        std::ofstream out(ledgerPath, std::ios::binary);
        REQUIRE(out.is_open());
        out << fullLedgerLine("prior-a", 200).dump() << '\n'
            << fullLedgerLine("prior-b", 503).dump() << '\n';
    }

    const std::string preExisting = readFileText(ledgerPath);
    REQUIRE_FALSE(preExisting.empty());

    MetricsLedger ledger(makeConfig(8080, ledgerPath));

    // Zeroed counters BEFORE anything is recorded: the file on disk is the
    // durable dataset, not the endpoint's source.
    {
        const json summary = ledger.summary();
        INFO("summary over a pre-existing ledger: ", summary.dump());
        CHECK(summary["totalRequests"] == 0);
        CHECK(summary["statusCounts"] == json::object());
        CHECK(summary["promptTokens"] == 0);
        CHECK(summary["completionTokens"] == 0);
        CHECK(summary["waitMsP50"] == 0);
        CHECK(summary["waitMsP95"] == 0);
        CHECK(summary["schemaConformanceRate"].is_null());
    }

    // Construction alone changed NOTHING on disk: no truncation, no rewrite.
    CHECK(readFileText(ledgerPath) == preExisting);

    // K records: the aggregate says exactly K, not K + the prior lines.
    ledger.record(makeRecord("fresh-1", 200, 0));
    ledger.record(makeRecord("fresh-2", 200, 10));
    ledger.record(makeRecord("fresh-3", 503, 20));

    const json summary = ledger.summary();
    CHECK(summary["totalRequests"] == 3);
    CHECK(summary["statusCounts"] == json{ { "200", 2 }, { "503", 1 } });

    // The prior lines are PRESERVED — the file grew by appending only.
    const std::string after = readFileText(ledgerPath);
    REQUIRE(after.size() > preExisting.size());
    CHECK(after.compare(0, preExisting.size(), preExisting) == 0);
    CHECK(ledgerLineCount(ledgerPath) == 5);

    const std::vector<json> lines = ledgerLineJson(ledgerPath);
    REQUIRE(lines.size() == 5);
    CHECK(lines[0].value("model", std::string()) == "prior-a");
    CHECK(lines[1].value("model", std::string()) == "prior-b");
}

// ---------------------------------------------------------------------------
// [11.7-reject-on-missing-ledgered] — ORCHESTRATOR ADDITION.
//
// The 11.7 implementer disclosed, unprompted, that the schema.rejectOnMissing
// 400 exit is ledgered by the "every request entering the handler" rule but
// that NO fixture drives that posture with a ledger attached — so that one
// line-shape was reasoned from the spec rather than executed. Every fixture in
// the file sets rejectOnMissing:false.
//
// That matters because the 400 is one of the FIVE exit paths a ledger line must
// be threaded onto, and it is the only one that answers BEFORE admission and
// before any upstream contact. A missing line there would make the shed tail of
// an opt-in posture invisible in exactly the dataset §4.4 exists to produce —
// and, being opt-in, it would stay invisible until an operator turned it on in
// production. An untested exit path is where a missing line hides.
// ---------------------------------------------------------------------------

TEST_CASE(
    "[11.7-reject-on-missing-ledgered] the schema.rejectOnMissing 400 — answered before admission "
    "and before any upstream contact — still appends exactly one ledger line, recording status 400 "
    "with null upstream and token columns, so an opt-in posture's refusals are visible in the "
    "dataset rather than silently absent from it") {
    TempDir tmp("reject-on-missing");

    StubUpstream upstream;
    answerWith(upstream, kUpstreamAnswer);
    answerModels(upstream);
    upstream.start();

    conductor::router::RouterConfig config = makeConfig(upstream.port(), tmp.ledgerPath());
    config.schema.rejectOnMissing = true;

    conductor::router::Router router(config);
    router.start();

    httplib::Client client(kHost, router.listen_port());
    configureClient(client);

    // Tagged as schema-required, but the body declares no schema: the §4.4
    // opt-in posture refuses it outright.
    const auto refused = client.Post(kChatPath,
                                     httplib::Headers{ { config.schema.observeHeader, "required" } },
                                     chatBody("reject-a"), "application/json");
    REQUIRE(refused);
    CHECK(refused->status == 400);

    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 1));
    const json line = lineForStatus(tmp.ledgerPath(), 400);
    checkLedgerKeys(line);

    // The refusal precedes the upstream entirely, so every upstream-derived
    // column is null rather than zero — zero would assert a measurement that
    // was never taken.
    CHECK(line["upstreamMs"].is_null());
    CHECK(line["promptTokens"].is_null());
    CHECK(line["completionTokens"].is_null());
    CHECK(line["schemaMissing"] == true);
    CHECK(line["schemaConformed"].is_null());

    // And it never reached the upstream at all: the refusal is answered before
    // admission, so the stub saw nothing.
    CHECK(upstream.requestCount() == 0);

    // A conforming request under the SAME posture still proxies and still
    // ledgers, so the row above pins the REFUSAL PATH and not merely the config
    // — without this half, an implementation that 400s everything would pass.
    const auto allowed = client.Post(kChatPath, httplib::Headers{}, chatBody("reject-b"),
                                     "application/json");
    REQUIRE(allowed);
    CHECK(allowed->status == 200);
    CHECK(upstream.requestCount() == 1);
    REQUIRE(awaitLedgerLines(tmp.ledgerPath(), 2));
}
