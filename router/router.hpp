// =============================================================================
// Tasks 11.3 / 11.4 — llama-router `router`: proxy pass-through + admission.
//
// The §4.4 proxy: an httplib listener in front of a separately launched
// llama-server. /v1/* is proxied, POST /v1/* through Task 11.4's admission
// first (SG-6: GET /v1/models is never admitted, so a saturated queue cannot
// stall opencode's model listing); GET /conductor/health answers outside
// admission entirely; everything else is 404'd without touching the upstream.
// Task 11.7's ledger threads through here: every request that enters the
// /v1/.* handler yields exactly one MetricsLedger line, written when the
// RESPONSE completes, and GET /conductor/metrics serves the in-memory
// aggregate outside admission. Beyond relaying and admitting, this file
// normalizes the four §4.4 conductor tags into one RequestTags value that later
// tasks consume, and hands that value plus the forwarded body to Task 11.6's
// pure schema observer (router/schema-observer.hpp), whose per-request
// SchemaObservation and schemaMissing counter it records. Two of the tags leave
// here: priority and group both go to admission, where 11.5's affinity policy
// does the ordering; this file reads neither back.
//
// G5 fail-soft is the law this file is written to: the router never turns a
// request the direct path would have served into an error, and performs no
// request validation of any kind. Concretely —
//   * a body with no "x_conductor" key (a non-JSON body included) is forwarded
//     BYTE-verbatim: it is never parsed-and-re-serialized, so no whitespace,
//     escape form or key order can shift under the caller;
//   * a JSON parse failure, a malformed x_conductor payload and a body whose
//     re-serialization would not round-trip are all logged and ignored, never
//     rejected;
//   * the upstream status crosses back untouched, non-2xx included; the router
//     mints a status of its own in exactly two situations, both the same
//     per-request 502 envelope and neither latched — an upstream it could not
//     reach at all, and an upstream that answered and then failed MID-BODY
//     while the response was still buffered, so nothing had been written
//     downstream yet. The second is not a G5 exception: relaying the partial
//     bytes under the upstream's own 200 would hand the caller a SHORT answer
//     carrying a Content-Length that matches the truncation, which no client
//     can tell from a complete one — a silent corruption, not a served
//     request. Once bytes ARE downstream that choice is gone, so a STREAMED
//     relay whose upstream failed mid-body aborts the connection instead,
//     leaving the chunked response without its terminating chunk: a detectable
//     error at the client rather than a clean end over an aborted generation.
//
// Header-only, matching Task 11.2's config.hpp, so both llama-router and
// router-tests get it without a translation unit of their own.
// =============================================================================

#pragma once

#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <utility>

#include "router/admission.hpp"
#include "router/config.hpp"
#include "router/metrics.hpp"
#include "router/version.hpp"

namespace conductor::router {
    // Task 0.2's pinned body-field fallback name (conductor/tests/fixtures/
    // wire-markers.ts PARAMS_FALLBACK_FIELD). The C++ literal must be the
    // identical string.
    inline constexpr const char* kParamsFallbackField = "x_conductor";

    // The four §4.4 conductor tags in ONE normalized representation, whichever
    // source supplied them: the X-Conductor-* headers minted by
    // conductor/adapter/inject.ts headersFor, or the x_conductor body field.
    // An absent tag is an empty optional.
    struct RequestTags {
        std::optional<std::string> role;
        std::optional<std::string> priority;
        std::optional<std::string> group;
        std::optional<std::string> schema;

        bool operator==(const RequestTags&) const = default;
    };

    namespace detail {
        // The header names conductor/adapter/inject.ts headersFor mints. Role and
        // priority have no §2.2 config knob; group and schema do (affinity.header /
        // schema.observeHeader), and Router prefers the configured name for those
        // two so a deployment that renames them stays coherent — these are the
        // defaults when the config leaves them blank.
        inline constexpr auto kRoleHeader = "X-Conductor-Role";
        inline constexpr auto kPriorityHeader = "X-Conductor-Priority";
        inline constexpr auto kGroupHeader = "X-Conductor-Group";
        inline constexpr auto kSchemaHeader = "X-Conductor-Schema";

        // Only /v1/* is proxied. httplib compiles a pattern with no ":param"
        // segment into a std::regex matched against the decoded path, so this
        // matches /v1/chat/completions and /v1/models but not /v1, /v1x or
        // /conductor/anything — those fall through to httplib's own 404.
        inline constexpr auto kProxyPathPattern = "/v1/.*";
        inline constexpr auto kUpstreamUnreachableType = "router_upstream_unreachable";

        // Generation streams are long and quiet: a five-second default would cut a
        // healthy SSE relay in half. The connect timeout stays short so a dead
        // upstream becomes a 502 immediately instead of a stall.
        inline constexpr int kUpstreamConnectTimeoutSeconds = 5;
        inline constexpr int kRelayTimeoutSeconds = 600;

        // Back-pressure high-water mark for a streaming relay: once this much
        // upstream payload is queued and still unwritten downstream, the upstream
        // reader parks until the writer drains it, so a slow consumer throttles the
        // producer instead of growing the queue without bound.
        inline constexpr std::size_t kRelayHighWaterBytes = 1u << 20;

        inline bool equalsIgnoreCase(std::string_view lhs, std::string_view rhs) {
            if (lhs.size() != rhs.size())
                return false;

            for (std::size_t i = 0; i < lhs.size(); ++i) {
                const auto left = static_cast<unsigned char>(lhs[i]);
                const auto right = static_cast<unsigned char>(rhs[i]);
                if (std::tolower(left) != std::tolower(right))
                    return false;
            }

            return true;
        }

        inline bool isOneOfIgnoreCase(
            std::string_view name, const std::string_view* names, std::size_t count) {
            for (std::size_t i = 0; i < count; ++i) {
                if (equalsIgnoreCase(name, names[i]))
                    return true;
            }

            return false;
        }

        // "Verbatim" for headers means every END-TO-END header crosses with an
        // unchanged name and value. The fields below cannot: they describe the hop,
        // not the message, and the proxy's own client/server re-derive them for the
        // connection they actually own. Forwarding a stale Content-Length after an
        // x_conductor strip would corrupt the request outright.
        inline bool isRequestHeaderDropped(std::string_view name) {
            static constexpr std::string_view dropped[] = {
                "connection",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailer",
                "transfer-encoding",
                "upgrade",
                "host",
                "content-length",
                "expect",
                "accept-encoding",
            };

            return isOneOfIgnoreCase(name, dropped, std::size(dropped));
        }

        // Response side, same rule. Content-Encoding goes too because the httplib
        // client hands us the DECODED bytes, so the upstream's encoding label no
        // longer describes what we relay. Content-Type is dropped from the copied
        // set only because httplib re-adds it when the body is attached, and its
        // set_header appends rather than replaces.
        inline bool isResponseHeaderDropped(std::string_view name) {
            static constexpr std::string_view dropped[] = {
                "connection",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailer",
                "transfer-encoding",
                "upgrade",
                "content-length",
                "content-encoding",
                "content-type",
            };

            return isOneOfIgnoreCase(name, dropped, std::size(dropped));
        }

        inline bool isEventStream(std::string_view contentType) {
            constexpr std::string_view marker = "text/event-stream";
            return contentType.size() >= marker.size() &&
                   equalsIgnoreCase(contentType.substr(0, marker.size()), marker);
        }

        inline std::string headerValue(const httplib::Headers& headers, const std::string& name) {
            const auto found = headers.find(name);
            return found == headers.end()
                     ? std::string()
                     : found->second;
        }

        inline bool hasHeader(const httplib::Headers& headers, const std::string& name) {
            return headers.find(name) != headers.end();
        }

        // One x_conductor key -> one tag. A present-but-non-string value is logged
        // and skipped rather than coerced: guessing at a caller's intent is exactly
        // the kind of silent reinterpretation §4.4 tagging must not do.
        inline void assignStringTag(std::optional<std::string>& slot, const nlohmann::json& payload, const char* key) {
            const auto found = payload.find(key);
            if (found == payload.end())
                return;

            if (!found->is_string()) {
                spdlog::debug(
                    "router: '{}' in the {} body field is {}, not a string — tag not set",
                    key, kParamsFallbackField, found->type_name());

                return;
            }

            slot = found->get<std::string>();
        }

        // Everything one proxied upstream call shares between the httplib worker
        // thread that drives it and the route handler / content provider that
        // relays it downstream. Every field is guarded by `mutex`; `cv` is
        // notified on every state change so no waiter can miss one.
        struct UpstreamRelay {
            std::mutex mutex;
            std::condition_variable cv;

            // Upstream payload received and not yet written downstream.
            std::string pending;
            // Response line + headers seen (or recovered after a bodyless reply).
            bool headersReady{ false };
            // The upstream call returned, successfully or not.
            bool finished{ false };
            // Downstream is gone; unwind the upstream call.
            bool cancelled{ false };
            // A content provider is draining `pending`, so back-pressure applies.
            bool streaming{ false };
            bool succeeded{ false };
            int status{ 0 };
            httplib::Headers headers;
            httplib::Error error{ httplib::Error::Success };
        };

        // Owns the thread driving ONE upstream call plus the client it drives it
        // with, because httplib runs a streaming response's content provider AFTER
        // the route handler has returned — the relay has to outlive the handler.
        // The destructor is the single teardown path: cancel, shut the upstream
        // socket down so a blocking read cannot pin the join, then join. A
        // downstream disconnect therefore never leaks a thread and never wedges
        // one, whichever leg was in flight.
        class UpstreamCall {
        public:
            UpstreamCall(std::shared_ptr<UpstreamRelay> relay, std::shared_ptr<httplib::Client> client)
                : relay_(std::move(relay))
                , client_(std::move(client)) {
            }

            UpstreamCall(const UpstreamCall&) = delete;
            UpstreamCall& operator=(const UpstreamCall&) = delete;

            // Separate from the constructor so a failed thread spawn leaves a
            // destructible object behind instead of a joinable temporary.
            void run(std::function<void()> body) {
                worker_ = std::thread(std::move(body));
            }

            ~UpstreamCall() {
                {
                    const std::lock_guard<std::mutex> lock(relay_->mutex);
                    relay_->cancelled = true;
                }

                relay_->cv.notify_all();
                client_->stop();

                if (worker_.joinable())
                    worker_.join();
            }

        private:
            std::shared_ptr<UpstreamRelay> relay_;
            std::shared_ptr<httplib::Client> client_;
            std::thread worker_;
        };

        // Task 11.7's aggregate endpoint, registered OUTSIDE admission exactly
        // like kHealthPath so it answers at a full queue, and never ledgered.
        inline constexpr auto kMetricsPath = "/conductor/metrics";

        // Reads token counts and timings out of a BUFFERED response body: the
        // single JSON object's `usage` (prompt_tokens/completion_tokens) and
        // its `timings`, copied verbatim. Anything unparseable or absent
        // leaves the columns null — observation only, never a touched relay.
        inline void readUsageFromBody(const std::string& body, RequestRecord& entry) {
            const nlohmann::json parsed =
                nlohmann::json::parse(body, nullptr, /*allow_exceptions=*/false);
            if (parsed.is_discarded() || !parsed.is_object())
                return;

            const auto usage = parsed.find("usage");
            if (usage != parsed.end() && usage->is_object()) {
                const auto prompt = usage->find("prompt_tokens");
                if (prompt != usage->end() && prompt->is_number())
                    entry.promptTokens = prompt->get<std::int64_t>();

                const auto completion = usage->find("completion_tokens");
                if (completion != usage->end() && completion->is_number())
                    entry.completionTokens = completion->get<std::int64_t>();
            }

            const auto timings = parsed.find("timings");
            if (timings != parsed.end() && !timings->is_null())
                entry.timings = *timings;
        }

        // Inspects SSE bytes AS THEY PASS on the chunked relay — never
        // buffering the stream, only the event in flight — for the `data:`
        // chunk carrying a non-null `usage` object, which under Task 0.2's
        // stream_options:{include_usage:true} arrives before `data: [DONE]`.
        // `timings` is taken verbatim from that same event object.
        class SseUsageScanner {
        public:
            void feed(const std::string& bytes, RequestRecord& entry) {
                buffer_.append(bytes);

                std::size_t boundary;
                while ((boundary = buffer_.find("\n\n")) != std::string::npos) {
                    handleEvent(std::string_view(buffer_).substr(0, boundary), entry);
                    buffer_.erase(0, boundary + 2);
                }

                // An unbounded partial event would grow without limit on a
                // stream that never closes one; a usage chunk is tiny, so an
                // event past the relay's high-water mark carries nothing worth
                // chasing.
                if (buffer_.size() > kRelayHighWaterBytes)
                    buffer_.clear();
            }

        private:
            static void handleEvent(std::string_view event, RequestRecord& entry) {
                // Per the SSE grammar an event's payload is its `data:` lines
                // joined with newlines; llama-server emits exactly one.
                std::string payload;
                std::size_t start = 0;
                while (start <= event.size()) {
                    const std::size_t end = event.find('\n', start);
                    std::string_view line = event.substr(
                        start, end == std::string_view::npos ? std::string_view::npos
                                                             : end - start);
                    if (!line.empty() && line.back() == '\r')
                        line.remove_suffix(1);

                    if (line.substr(0, 5) == "data:") {
                        std::string_view rest = line.substr(5);
                        if (!rest.empty() && rest.front() == ' ')
                            rest.remove_prefix(1);

                        if (!payload.empty())
                            payload.push_back('\n');

                        payload.append(rest);
                    }

                    if (end == std::string_view::npos)
                        break;

                    start = end + 1;
                }

                if (payload.empty() || payload == "[DONE]")
                    return;

                const nlohmann::json parsed =
                    nlohmann::json::parse(payload, nullptr, /*allow_exceptions=*/false);
                if (parsed.is_discarded() || !parsed.is_object())
                    return;

                const auto usage = parsed.find("usage");
                if (usage == parsed.end() || !usage->is_object())
                    return;

                const auto prompt = usage->find("prompt_tokens");
                if (prompt != usage->end() && prompt->is_number())
                    entry.promptTokens = prompt->get<std::int64_t>();

                const auto completion = usage->find("completion_tokens");
                if (completion != usage->end() && completion->is_number())
                    entry.completionTokens = completion->get<std::int64_t>();

                const auto timings = parsed.find("timings");
                if (timings != parsed.end() && !timings->is_null())
                    entry.timings = *timings;
            }

            std::string buffer_;
        };

        // Carries ONE request's RequestRecord to response completion and fires
        // MetricsLedger::record exactly once, when the LAST holder lets go:
        // the buffered return and every error exit drop it at handler return,
        // while a streaming relay's content provider carries a copy so the
        // line lands when httplib destroys the provider — normal end or a
        // dying connection — exactly the AdmissionSlot idiom (the C-033
        // defect class: recording at handler return would ledger a streamed
        // line before any usage chunk existed).
        class LedgerGuard {
        public:
            explicit LedgerGuard(MetricsLedger& ledger)
                : ledger_(ledger) {
            }

            LedgerGuard(const LedgerGuard&) = delete;
            LedgerGuard& operator=(const LedgerGuard&) = delete;

            ~LedgerGuard() {
                if (upstreamStart) {
                    record.upstreamMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                                            std::chrono::steady_clock::now() - *upstreamStart)
                                            .count();
                }

                try {
                    ledger_.record(record);
                } catch (...) {
                    // record() is designed never to throw (G5); a destructor
                    // must not let anything escape regardless.
                }
            }

            RequestRecord record;
            // Engaged the moment the upstream call starts, so upstreamMs is
            // non-null exactly when the upstream was attempted — a shed
            // request never engages it.
            std::optional<std::chrono::steady_clock::time_point> upstreamStart;
            SseUsageScanner scanner;

        private:
            MetricsLedger& ledger_;
        };

    }  // namespace detail

    // Body-field fallback extraction + stripping. ALWAYS removes a top-level
    // "x_conductor" key from `body` when one exists. Tags are produced only when
    // the key's payload is an object of string values {"role"?, "priority"?,
    // "group"?, "schema"?}; any other payload extracts NOTHING (fail-open,
    // spdlog-logged) yet the key is still stripped. A body without the key is
    // left untouched and yields all-empty tags.
    inline RequestTags extract_and_strip_tags(nlohmann::json& body) {
        RequestTags tags;
        if (!body.is_object())
            return tags;

        const auto found = body.find(kParamsFallbackField);
        if (found == body.end())
            return tags;

        // Copy before erasing: `payload` has to outlive the key it came from, and
        // the strip happens whatever the payload turns out to be.
        const nlohmann::json payload = *found;
        body.erase(found);

        if (!payload.is_object()) {
            spdlog::debug(
                "router: {} body field is {}, not an object — no tags extracted, field stripped anyway",
                kParamsFallbackField, payload.type_name());

            return tags;
        }

        detail::assignStringTag(tags.role, payload, "role");
        detail::assignStringTag(tags.priority, payload, "priority");
        detail::assignStringTag(tags.group, payload, "group");
        detail::assignStringTag(tags.schema, payload, "schema");
        return tags;
    }

}  // namespace conductor::router

// Included HERE, between RequestTags and class Router, because the two headers
// include each other: schema-observer.hpp needs RequestTags (and
// detail::equalsIgnoreCase) above this line for observe_request's definition,
// while class Router below stores a SchemaObservation and calls the observe_*
// functions. schema-observer.hpp mirrors this by declaring everything Router
// needs before ITS router.hpp include, so either header can be included first.
#include "router/schema-observer.hpp"

namespace conductor::router {

    // The §4.4 pass-through slice plus the admission hand-off, Task 11.6's
    // observation seam and Task 11.7's ledger threading: one MetricsLedger,
    // built from RouterConfig::metrics.ledgerPath, records exactly one line
    // per request that enters the /v1/.* handler, at response completion.
    //   - Constructed from Task 11.2's parsed RouterConfig (listen + upstream
    //     endpoints). cfg.listen.port == 0 binds an OS-assigned ephemeral port.
    //     Construction and start() need NO live upstream: the upstream
    //     connection is made per proxied request.
    //   - start(): binds cfg.listen, serves on a background thread, and returns
    //     only once the listener is accepting connections. stop(): stops the
    //     listener and joins; the destructor stops a running router.
    //   - listen_port(): the actually-bound listen port, valid after start().
    //   - last_request_tags(): the normalized RequestTags of the most recent
    //     /v1/* request — std::nullopt until one has been handled; a tagless or
    //     unparseable-body request yields an ENGAGED value with four empty
    //     optionals. Per-tag, an X-Conductor-* header wins over the same key in
    //     x_conductor; a body-only key still fills its tag; the field is stripped
    //     regardless. This is the single normalized tag seam that Tasks 11.4+
    //     consume; 11.3 attaches no behaviour to the tags.
    //   - last_schema_observation() / schema_missing_count(): Task 11.6's
    //     observers, mirroring last_request_tags(). Observation runs for EVERY
    //     /v1/* request (GET included); the counter increments on every
    //     tagged-and-missing request WHATEVER schema.rejectOnMissing says — the
    //     refusal is a posture, the count an observation. The opt-in 400
    //     (rejectOnMissing:true, never the shipped default) applies to POST
    //     /v1/* only and answers before admission, so it consumes no slot and
    //     no queue entry.
    class Router {
    public:
        explicit Router(const RouterConfig& config)
            : config_(config)
            , groupHeader_(config.affinity.header.empty() ? detail::kGroupHeader : config.affinity.header)
            , schemaHeader_(config.schema.observeHeader.empty() ? detail::kSchemaHeader
                                                                : config.schema.observeHeader)
            , admission_(config)
            , metrics_(config) {
            // Token-by-token SSE is the point of this proxy: Nagle would coalesce
            // single-chunk writes into 40ms batches on both legs.
            server_.set_tcp_nodelay(true);
            server_.set_read_timeout(detail::kRelayTimeoutSeconds, 0);
            server_.set_write_timeout(detail::kRelayTimeoutSeconds, 0);
            installRoutes();
        }

        ~Router() {
            stop();
        }

        Router(const Router&) = delete;
        Router& operator=(const Router&) = delete;

        void start() {
            if (listener_.joinable())
                return;

            // Admission parks a handler thread per in-flight AND per queued
            // request, so the listener needs a pool that can hold all of them plus
            // the margin that keeps /conductor/health and GET /v1/models
            // answerable. httplib's default pool would starve at a full queue.
            server_.new_task_queue = [threads = computeTaskQueueThreads(config_)] {
                return new httplib::ThreadPool(static_cast<std::size_t>(threads < 1 ? 1 : threads));
            };

            if (config_.listen.port == 0) {
                // The pinned test-only ephemeral-port construction; parseRouterConfig's
                // 1..65535 range check governs config files, not this seam.
                listenPort_ = server_.bind_to_any_port(config_.listen.host);
                if (listenPort_ <= 0) {
                    throw std::runtime_error(
                        "llama-router could not bind an ephemeral port on " +
                        config_.listen.host);
                }
            }
            else {
                if (!server_.bind_to_port(config_.listen.host, config_.listen.port)) {
                    throw std::runtime_error(
                        "llama-router could not bind " + config_.listen.host + ":" +
                        std::to_string(config_.listen.port));
                }

                listenPort_ = config_.listen.port;
            }

            listener_ = std::thread{ [this] {
                server_.listen_after_bind();
            } };

            // bind_to_*() has already called listen(2), so the socket accepts from
            // here on; this only reaps the case where the listen thread tore it
            // back down before we returned.
            server_.wait_until_ready();

            spdlog::info(
                "router: listening on {}:{}, proxying /v1/* to {}:{}",
                config_.listen.host, listenPort_,
                config_.upstream.host, config_.upstream.port);
        }

        void stop() {
            if (!listener_.joinable())
                return;

            server_.stop();
            listener_.join();
        }

        [[nodiscard]] int listen_port() const {
            return listenPort_;
        }

        [[nodiscard]] std::optional<RequestTags> last_request_tags() const {
            const std::lock_guard<std::mutex> lock(tagsMutex_);
            return lastTags_;
        }

        // The most recent /v1/* request's schema observation — std::nullopt
        // until one has been handled. A buffered response that produced a
        // conformance verdict is reflected here with schemaConformed engaged.
        [[nodiscard]] std::optional<SchemaObservation> last_schema_observation() const {
            const std::lock_guard<std::mutex> lock(observationMutex_);
            return lastObservation_;
        }

        // Monotonic count of tagged-and-missing requests since construction,
        // never reset. Per Router instance, not process-global.
        [[nodiscard]] std::uint64_t schema_missing_count() const {
            const std::lock_guard<std::mutex> lock(observationMutex_);
            return schemaMissingCount_;
        }

        [[nodiscard]] const AdmissionController& admission() const {
            return admission_;
        }

    private:
        void installRoutes() {
            const httplib::Server::Handler proxy =
                [this](const httplib::Request& request, httplib::Response& response) {
                    handleProxy(request, response);
                };

            // SG-5: registered OUTSIDE admission, so it answers while every slot
            // and every queue entry is held. The body is 11.7's extended shape;
            // `status` keeps 11.4's committed value and `version` is
            // router_version(), never a second version constant.
            server_.Get(kHealthPath, [](const httplib::Request&, httplib::Response& response) {
                nlohmann::json body;
                body["status"] = "ok";
                body["version"] = router_version();
                response.status = 200;
                sendBuffered(response, "application/json", body.dump());
            });

            // Task 11.7's aggregate, registered OUTSIDE admission exactly like
            // health so it answers at a full queue. Serving it is never
            // ledgered and never counted — polling the endpoint cannot inflate
            // the dataset it reports.
            server_.Get(detail::kMetricsPath,
                        [this](const httplib::Request&, httplib::Response& response) {
                            response.status = 200;
                            sendBuffered(response, "application/json", metrics_.summary().dump());
                        });

            server_.Get(detail::kProxyPathPattern, proxy);
            server_.Post(detail::kProxyPathPattern, proxy);
            server_.Put(detail::kProxyPathPattern, proxy);
            server_.Patch(detail::kProxyPathPattern, proxy);
            server_.Delete(detail::kProxyPathPattern, proxy);
            server_.Options(detail::kProxyPathPattern, proxy);
        }

        // Everything read off the incoming request before a byte is relayed: the
        // normalized §4.4 tags, the bytes to forward, and the admission counter
        // key.
        struct ForwardPlan {
            RequestTags tags;
            std::string body;
            // The body's `model` field. Empty when the body carries no usable one,
            // which SG-3 buckets under that same reserved key rather than
            // rejecting.
            std::string model;
        };

        void handleProxy(const httplib::Request& request, httplib::Response& response) {
            // Every request that enters this handler gets exactly ONE ledger
            // line — the buffered return, the streamed completion, the 503
            // refusals, the 502s — written when the response completes (the
            // guard's destructor), never when the handler returns.
            const auto ledgerGuard = std::make_shared<detail::LedgerGuard>(metrics_);

            try {
                ForwardPlan plan = planForward(request);
                recordTags(plan.tags);

                ledgerGuard->record.model = plan.model;
                ledgerGuard->record.role = plan.tags.role;
                ledgerGuard->record.group = plan.tags.group;
                ledgerGuard->record.priority = resolvedPriorityClass(plan.tags.priority);

                // Task 11.6: observation runs for EVERY /v1/* request over the
                // already-normalized tags and the FORWARDED (post-strip) body —
                // no header is re-read and no second body parse pass is added
                // beyond the observer's own.
                const SchemaObservation observation = observe_request(plan.tags, plan.body);
                recordObservation(observation);
                // The ledger's schema columns are 11.6's observation verbatim:
                // an untagged request made NO observation, so the column is
                // null, never false.
                if (observation.tagged)
                    ledgerGuard->record.schemaMissing = observation.schemaMissing;

                if (observation.tagged && observation.schemaMissing) {
                    // §4.4 "journaled": one warn line per tagged-schema-missing
                    // request naming the role and group tags and the path.
                    spdlog::warn(
                        "router: {} {} carries '{}: required' but declares no schema — counted "
                        "schemaMissing (role '{}', group '{}')",
                        request.method, request.path, schemaHeader_,
                        plan.tags.role.value_or(""), plan.tags.group.value_or(""));
                }

                // SG-6: admission is for the generation calls only. A read like
                // GET /v1/models crosses un-admitted, so a saturated queue cannot
                // turn it into an error the direct path would have served (G5).
                // Never having reached admit(), it records queueWaitMs 0.
                if (request.method != "POST") {
                    relayToUpstream(request, response, std::move(plan.body), nullptr, observation,
                                    ledgerGuard);
                    return;
                }

                // The opt-in refusal posture, POST-only for the same G5 reason
                // SG-6 keeps GET out of admission: a bodyless read can never
                // carry a schema field. Answered before admission — no upstream
                // contact, no slot consumed, no queue entry.
                if (config_.schema.rejectOnMissing && observation.tagged &&
                    observation.schemaMissing) {
                    sendSchemaMissingError(response);
                    ledgerGuard->record.status = 400;
                    return;
                }

                // The group rides along with the priority: 11.5's affinity policy
                // orders the queue with it, and it can never make a request that
                // would have been admitted anything other than admitted (G5).
                // queueWaitMs is measured ACROSS admit(), which parks this thread
                // for exactly the queue wait — one measurement covers Admitted,
                // TimedOut and Overflowed alike, and 11.4's surface is untouched.
                const auto admitStarted = std::chrono::steady_clock::now();
                const AdmissionOutcome outcome =
                    admission_.admit(plan.model, plan.tags.priority, plan.tags.group);
                ledgerGuard->record.queueWaitMs =
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - admitStarted)
                        .count();

                if (outcome != AdmissionOutcome::Admitted) {
                    sendAdmissionError(response, outcome, plan.model);
                    // The shed tail stays visible in the dataset: status 503,
                    // upstreamMs null (never attempted), token counts null.
                    ledgerGuard->record.status = 503;
                    return;
                }

                // The slot is returned when the LAST holder of this pointer goes
                // away: the buffered return and every error exit drop it here,
                // while a streaming relay hands a copy to its content provider so
                // the slot outlives this handler exactly as long as the stream does.
                auto slot = std::make_shared<AdmissionSlot>(admission_, plan.model);
                relayToUpstream(request, response, std::move(plan.body), std::move(slot),
                                observation, ledgerGuard);
            } catch (const std::exception& failure) {
                // Nothing above this point rejects a request on purpose, so reaching
                // here means the router itself broke. Answering with the same
                // parseable envelope the fan-out side already understands beats
                // httplib's bare 500, and the cause is on the log.
                sendRouterError(
                    response,
                    std::string("llama-router failed to relay the request: ") +
                        failure.what());

                ledgerGuard->record.status = 502;
            }
        }

        // SG-4's RESOLVED class, mirroring admission's priorityValue collapse:
        // the ledger records what the queue DID, not what the tag said — a
        // column saying "urgent" for a request queued as interactive would make
        // the POC's wait analysis lie.
        [[nodiscard]] static std::string resolvedPriorityClass(
            const std::optional<std::string>& priority) {
            if (priority && (*priority == "review" || *priority == "batch"))
                return *priority;

            return "interactive";
        }

        [[nodiscard]] ForwardPlan planForward(const httplib::Request& request) const {
            ForwardPlan plan;
            plan.tags = tagsFromHeaders(request);
            plan.body = request.body;

            // The strip is the ONLY reason to touch the body, so it is the only
            // case that re-serializes. Anything else — no key, not an object, not
            // JSON at all — forwards the caller's exact bytes.
            if (request.body.empty())
                return plan;

            nlohmann::json parsed = nlohmann::json::parse(request.body, nullptr, /*allow_exceptions=*/false);
            if (parsed.is_discarded()) {
                spdlog::debug("router: {} {} body is not JSON — forwarded verbatim, no fallback tags",
                              request.method, request.path);

                return plan;
            }

            if (!parsed.is_object())
                return plan;

            const auto model = parsed.find("model");
            if (model != parsed.end() && model->is_string())
                plan.model = model->get<std::string>();

            if (!parsed.contains(std::string(kParamsFallbackField)))
                return plan;

            const RequestTags fallback = extract_and_strip_tags(parsed);
            mergeFallbackTags(plan.tags, fallback);
            try {
                plan.body = parsed.dump();
            } catch (const nlohmann::json::exception& failure) {
                // Re-serialization is the only step that can fail here, and a
                // request that cannot be rewritten still has to be served:
                // forward the original bytes, x_conductor and all.
                spdlog::warn(
                    "router: could not re-serialize the body after stripping {} ({}) — "
                    "forwarding the original bytes",
                    kParamsFallbackField, failure.what());

                plan.body = request.body;
            }

            return plan;
        }

        void relayToUpstream(const httplib::Request& request, httplib::Response& response,
                             std::string forwardBody, std::shared_ptr<AdmissionSlot> slot,
                             const SchemaObservation& observation,
                             const std::shared_ptr<detail::LedgerGuard>& ledgerGuard) {
            httplib::Headers upstreamHeaders;
            for (const auto& [name, value] : request.headers) {
                if (!detail::isRequestHeaderDropped(name))
                    upstreamHeaders.emplace(name, value);
            }

            auto relay = std::make_shared<detail::UpstreamRelay>();
            auto client = std::make_shared<httplib::Client>(config_.upstream.host, config_.upstream.port);

            // The request target arrives already percent-encoded,
            // re-encoding it would rewrite bytes the caller chose.
            client->set_tcp_nodelay(true);
            client->set_path_encode(false);
            client->set_keep_alive(false);
            client->set_connection_timeout(detail::kUpstreamConnectTimeoutSeconds, 0);
            client->set_read_timeout(detail::kRelayTimeoutSeconds, 0);
            client->set_write_timeout(detail::kRelayTimeoutSeconds, 0);

            // req.target is the raw request line target (path + query); req.path is
            // the decoded path only.
            const std::string target = request.target.empty() ? request.path : request.target;
            auto call = std::make_shared<detail::UpstreamCall>(relay, client);

            // From here the upstream IS attempted, so upstreamMs is non-null on
            // every exit below — the connect-failure 502 included, unlike a
            // shed request that never got this far.
            ledgerGuard->upstreamStart = std::chrono::steady_clock::now();

            try {
                call->run(
                    [relay, client, method = request.method, target, headers = std::move(upstreamHeaders), body = std::move(forwardBody)]() mutable {
                        runUpstreamCall(
                            relay, client, method, target,
                            std::move(headers), std::move(body));
                    });
            } catch (const std::system_error& failure) {
                sendRouterError(
                    response,
                    upstreamMessage(
                        std::string("could not start a relay thread: ") +
                        failure.what()));

                ledgerGuard->record.status = 502;
                return;
            }

            bool haveResponse = false;
            int status = 0;

            httplib::Headers responseHeaders;
            httplib::Error error = httplib::Error::Success;

            {
                std::unique_lock<std::mutex> lock(relay->mutex);
                relay->cv.wait(
                    lock, [&relay] {
                        return relay->headersReady ||
                               relay->finished;
                    });

                haveResponse = relay->headersReady;
                status = relay->status;
                responseHeaders = relay->headers;
                error = relay->error;
            }

            if (!haveResponse) {
                // The one status the router mints on its own: it never reached the
                // upstream, so there is no upstream answer to forward. Per-request
                // and never latched — the client is rebuilt on the next request, so
                // the moment something listens again the relay resumes.
                sendRouterError(response, upstreamMessage(httplib::to_string(error)));
                ledgerGuard->record.status = 502;
                return;
            }

            // The upstream's response head, relayed downstream verbatim. Held
            // back rather than applied here because the buffered path below
            // learns the upstream's REAL verdict only after this point, while
            // nothing has yet been written downstream: a 502 the router mints
            // there must carry its own head, not the head of an answer the
            // upstream never finished.
            const auto relayResponseHead = [&] {
                response.status = status;
                // The status column records what the CLIENT gets: the upstream's
                // own answer, non-2xx included, crossing back untouched.
                ledgerGuard->record.status = status;
                for (const auto& [name, value] : responseHeaders) {
                    if (!detail::isResponseHeaderDropped(name))
                        response.set_header(name, value);
                }
            };

            const std::string contentType = detail::headerValue(responseHeaders, "Content-Type");
            // A declared length means the whole body is bounded and known, so relay
            // it as one message with that same length. No length (chunked / read
            // until close) or an SSE content type means the upstream is producing
            // incrementally, and so must we.
            const bool incremental = detail::isEventStream(contentType) ||
                                     !detail::hasHeader(responseHeaders, "Content-Length");

            if (!incremental) {
                std::string body;
                bool truncated = false;

                {
                    std::unique_lock<std::mutex> lock(relay->mutex);
                    relay->cv.wait(
                        lock, [&relay] {
                            return relay->finished;
                        });

                    body.swap(relay->pending);
                    // The upstream's OWN verdict, which exists only once the
                    // call has returned. `headersReady` says an answer STARTED;
                    // nothing before this point can say whether it finished.
                    truncated = !relay->succeeded;
                    error = relay->error;
                }

                if (truncated) {
                    // Not a byte has gone downstream yet, so the choice is still
                    // open — and `body` is not an answer: httplib delivers what
                    // it read before the failure, so relaying it would attach a
                    // Content-Length matching the TRUNCATION under the
                    // upstream's own status. The client could not tell that
                    // from a complete response, and the router would have
                    // corrupted a request rather than served it.
                    sendRouterError(response, truncatedMessage(error, body.size()));
                    ledgerGuard->record.status = 502;
                    return;
                }

                relayResponseHead();

                // Task 11.6's response half runs on the buffered path only —
                // the verdict is recorded off these exact bytes BEFORE they are
                // handed to sendBuffered, which returns them untouched. The
                // ledger's token columns read the same single body's `usage`
                // and copy its `timings` verbatim.
                detail::readUsageFromBody(body, ledgerGuard->record);
                const std::optional<bool> verdict = recordResponseVerdict(observation, body);
                if (verdict)
                    ledgerGuard->record.schemaConformed = *verdict;

                sendBuffered(response, contentType, std::move(body));
                return;
            }

            relayResponseHead();

            {
                const std::lock_guard<std::mutex> lock(relay->mutex);
                relay->streaming = true;
            }

            // httplib calls this back after the handler returns, once per write, on
            // the connection thread. Blocking inside it is how the stream stays
            // unbuffered: the call parks until the upstream has produced something,
            // writes exactly what arrived, and returns for the next round. `call`
            // rides along in the capture so the upstream thread outlives the handler,
            // and `slot` rides along for the same reason: this handler returns as
            // soon as the provider is registered, so a slot left behind on its stack
            // would be released mid-stream and maxInflightPerModel would bound
            // nothing for the streaming traffic it exists to bound. httplib destroys
            // the provider when the response ends — normally, or by the connection
            // dying — so the slot is returned exactly once, on every outcome.
            // `ledgerGuard` rides along under the SAME idiom: the streamed line is
            // written when the provider is destroyed, exactly once, AFTER any
            // usage chunk has crossed — never at handler return (C-033).
            response.set_chunked_content_provider(
                contentType, [relay, call, slot = std::move(slot), ledgerGuard,
                              endpoint = upstreamEndpoint()](std::size_t /*offset*/, httplib::DataSink& sink) {
                    std::string chunk;
                    bool complete = false;
                    bool upstreamFailed = false;
                    httplib::Error cause = httplib::Error::Success;

                    {
                        std::unique_lock<std::mutex> lock(relay->mutex);
                        relay->cv.wait(lock, [&relay] {
                            return !relay->pending.empty() ||
                                   relay->finished ||
                                   relay->cancelled;
                        });

                        chunk.swap(relay->pending);
                        complete = relay->finished || relay->cancelled;
                        // The upstream's OWN verdict, read HERE because this is
                        // the only place it is reachable: `finished` says the
                        // call returned, never that it succeeded. Meaningful
                        // only under `complete`, which is the only thing that
                        // consults it.
                        upstreamFailed = (relay->finished && !relay->succeeded) ||
                                         relay->cancelled;
                        cause = relay->error;
                    }

                    relay->cv.notify_all();

                    // Usage/timings are read from the chunks AS THEY PASS —
                    // the relay below writes these same bytes unchanged. The
                    // provider runs serially on one connection thread, so the
                    // guard's scanner needs no lock of its own.
                    if (!chunk.empty())
                        ledgerGuard->scanner.feed(chunk, ledgerGuard->record);

                    // A zero-length write would tell httplib the body ended, so the
                    // empty-chunk wake-ups (finished, cancelled) skip it.
                    if (!chunk.empty() && !sink.write(chunk.data(), chunk.size())) {
                        {
                            const std::lock_guard<std::mutex> lock(relay->mutex);
                            relay->cancelled = true;
                        }

                        relay->cv.notify_all();
                        return false;
                    }

                    if (complete) {
                        if (upstreamFailed) {
                            // Bytes are already downstream and cannot be
                            // recalled, so no status is left to mint: the only
                            // honest ending is no ending. Returning false makes
                            // httplib abort the connection WITHOUT the
                            // terminating chunk, which the client detects as
                            // the truncation it is — sink.done() would frame an
                            // aborted generation as a normal end, the one
                            // outcome a streamed relay must never produce.
                            spdlog::warn(
                                "router: the upstream at {} failed mid-stream ({}) — the "
                                "downstream stream is aborted without its terminating "
                                "chunk rather than ended cleanly",
                                endpoint, httplib::to_string(cause));

                            return false;
                        }

                        sink.done();
                    }

                    return true;
                });
        }

        // Drives one upstream request to completion on its own thread, publishing
        // the response line/headers the instant they land and every payload byte as
        // it arrives, so the handler can start relaying before the upstream is done.
        static void runUpstreamCall(
            const std::shared_ptr<detail::UpstreamRelay>& relay,
            const std::shared_ptr<httplib::Client>& client, const std::string& method,
            const std::string& target, httplib::Headers&& headers, std::string&& body) {
            httplib::Request upstreamRequest;
            upstreamRequest.method = method;
            upstreamRequest.path = target;
            upstreamRequest.headers = std::move(headers);
            upstreamRequest.body = std::move(body);
            upstreamRequest.response_handler = [relay](const httplib::Response& upstreamResponse) {
                bool proceed = true;

                {
                    const std::lock_guard<std::mutex> lock(relay->mutex);
                    if (relay->cancelled)
                        proceed = false;
                    else {
                        relay->status = upstreamResponse.status;
                        relay->headers = upstreamResponse.headers;
                        relay->headersReady = true;
                    }
                }

                relay->cv.notify_all();
                return proceed;
            };

            upstreamRequest.content_receiver =
                [relay](const char* data, std::size_t length, std::size_t /*offset*/, std::size_t /*total*/) {
                    std::unique_lock<std::mutex> lock(relay->mutex);
                    if (relay->cancelled)
                        return false;

                    relay->pending.append(data, length);
                    relay->cv.notify_all();
                    // Back-pressure only applies once a content provider is actually
                    // draining; the buffered path collects the whole body itself and
                    // would deadlock against a high-water mark.
                    relay->cv.wait(
                        lock, [&relay] {
                            return relay->cancelled ||
                                   !relay->streaming ||
                                   relay->pending.size() <= detail::kRelayHighWaterBytes;
                        });

                    return !relay->cancelled;
                };

            httplib::Response upstreamResponse;
            httplib::Error error = httplib::Error::Success;
            const bool succeeded = client->send(upstreamRequest, upstreamResponse, error);

            {
                const std::lock_guard<std::mutex> lock(relay->mutex);
                // 204s and HEAD replies never reach the response handler, so recover
                // the status line here rather than mistaking them for no answer.
                if (succeeded && !relay->headersReady) {
                    relay->status = upstreamResponse.status;
                    relay->headers = upstreamResponse.headers;
                    relay->headersReady = true;
                }

                relay->succeeded = succeeded;
                relay->error = error;
                relay->finished = true;
            }

            relay->cv.notify_all();
        }

        // Relays a complete body without letting httplib re-encode it: a content
        // provider of known length is written straight through, whereas a plain
        // res.body would be gzip/brotli'd whenever the caller sent Accept-Encoding,
        // changing bytes the upstream chose and adding headers it never sent.
        static void sendBuffered(httplib::Response& response, const std::string& contentType, std::string&& body) {
            if (contentType.empty()) {
                // No Content-Type to attach; httplib derives Content-Length from the
                // body and compresses nothing it cannot classify.
                response.body = std::move(body);
                return;
            }

            if (body.empty()) {
                response.set_header("Content-Type", contentType);
                return;
            }

            auto payload = std::make_shared<const std::string>(std::move(body));
            response.set_content_provider(
                payload->size(), contentType,
                [payload](std::size_t offset, std::size_t length, httplib::DataSink& sink) {
                    const std::size_t remaining = payload->size() - offset;
                    const std::size_t count = length < remaining ? length : remaining;
                    return sink.write(payload->data() + offset, count);
                });
        }

        [[nodiscard]] std::string upstreamEndpoint() const {
            return config_.upstream.host + ":" + std::to_string(config_.upstream.port);
        }

        [[nodiscard]] std::string upstreamMessage(const std::string& cause) const {
            return "llama-router could not reach the upstream at " + upstreamEndpoint() + ": " +
                   cause;
        }

        // The mid-body failure's message. Deliberately NOT upstreamMessage's
        // "could not reach": the router did reach this upstream and it did
        // answer — it stopped partway — and an operator needs those apart. The
        // envelope AROUND it is identical, so the fan-out side still parses one
        // router-origin error shape.
        [[nodiscard]] std::string truncatedMessage(httplib::Error cause,
                                                   std::size_t received) const {
            return "llama-router could not complete the response from the upstream at " +
                   upstreamEndpoint() + ": " + httplib::to_string(cause) + " after " +
                   std::to_string(received) +
                   " byte(s) of body; the truncated body was not relayed";
        }

        // The one router-origin error shape, shared so the TS fan-out side
        // (conductor/adapter/router-client.ts) sees one parseable envelope whatever
        // failed. Task 11.4's 503 reuses it with its own type string.
        static void sendRouterError(httplib::Response& response, const std::string& message) {
            spdlog::warn("router: {}", message);

            nlohmann::json envelope;
            envelope["error"]["message"] = message;
            envelope["error"]["type"] = detail::kUpstreamUnreachableType;
            envelope["error"]["code"] = 502;

            response.status = 502;
            sendBuffered(response, "application/json", envelope.dump());
        }

        // The §4.4 capacity refusal, in the same envelope shape as every other
        // router-origin error so one parser handles them all. `code` carries the
        // discriminator the fan-out side acts on: a timeout means the queue moved
        // too slowly and retrying may work, an overflow means it was already full.
        static void sendAdmissionError(httplib::Response& response, AdmissionOutcome outcome,
                                       const std::string& model) {
            const bool overflowed = outcome == AdmissionOutcome::Overflowed;
            const char* const code = overflowed ? kQueueOverflowCode : kQueueTimeoutCode;
            const std::string message =
                overflowed
                    ? "llama-router queue is full for model '" + model + "'; the request was not queued"
                    : "llama-router queue wait for model '" + model + "' exceeded queueTimeoutMs";

            spdlog::warn("router: {}", message);

            nlohmann::json envelope;
            envelope["error"]["message"] = message;
            envelope["error"]["type"] = kAdmissionErrorType;
            envelope["error"]["code"] = code;

            response.status = 503;
            sendBuffered(response, "application/json", envelope.dump());
        }

        // Task 11.6's opt-in 400, in the committed envelope shape with the
        // 11.4-convention string code. The message names the resolved
        // observe-header AND the literal "schema.rejectOnMissing" so an
        // operator reading it learns which config key produced a refusal the
        // base build never makes.
        void sendSchemaMissingError(httplib::Response& response) const {
            const std::string message =
                "llama-router refused the request: it is tagged '" + schemaHeader_ +
                ": required' but its body declares no schema (response_format json_schema, "
                "grammar or json_schema), and schema.rejectOnMissing is true";

            spdlog::warn("router: {}", message);

            nlohmann::json envelope;
            envelope["error"]["message"] = message;
            envelope["error"]["type"] = kSchemaErrorType;
            envelope["error"]["code"] = kSchemaMissingCode;

            response.status = 400;
            sendBuffered(response, "application/json", envelope.dump());
        }

        [[nodiscard]] RequestTags tagsFromHeaders(const httplib::Request& request) const {
            RequestTags tags;
            readHeaderTag(tags.role, request, detail::kRoleHeader);
            readHeaderTag(tags.priority, request, detail::kPriorityHeader);
            readHeaderTag(tags.group, request, groupHeader_);
            readHeaderTag(tags.schema, request, schemaHeader_);
            return tags;
        }

        // An absent header and a present-but-empty one both mean "no tag": an empty
        // value carries nothing for 11.4+ to route on.
        static void readHeaderTag(std::optional<std::string>& slot, const httplib::Request& request, const std::string& name) {
            if (!request.has_header(name))
                return;

            std::string value = request.get_header_value(name);
            if (value.empty())
                return;

            slot = std::move(value);
        }

        static void mergeFallbackTags(RequestTags& tags, const RequestTags& fallback) {
            applyFallbackTag(tags.role, fallback.role, "role");
            applyFallbackTag(tags.priority, fallback.priority, "priority");
            applyFallbackTag(tags.group, fallback.group, "group");
            applyFallbackTag(tags.schema, fallback.schema, "schema");
        }

        // Per-tag the header wins, so 11.4+ never see two disagreeing sources; a
        // body-only key still fills its own tag.
        static void applyFallbackTag(std::optional<std::string>& slot, const std::optional<std::string>& fallback, const char* name) {
            if (!fallback)
                return;

            if (!slot) {
                slot = fallback;
                return;
            }

            if (*slot != *fallback) {
                spdlog::debug(
                    "router: header tag '{}' = '{}' wins over the {} field's '{}'",
                    name, *slot, kParamsFallbackField, *fallback);
            }
        }

        void recordTags(const RequestTags& tags) {
            const std::lock_guard<std::mutex> lock(tagsMutex_);
            lastTags_ = tags;
        }

        // Stores the request-side observation and advances the schemaMissing
        // counter. Called once per /v1/* request, before any admission or
        // posture decision, so the count is an observation of the traffic and
        // never a consequence of what the router answered.
        void recordObservation(const SchemaObservation& observation) {
            const std::lock_guard<std::mutex> lock(observationMutex_);
            lastObservation_ = observation;
            if (observation.tagged && observation.schemaMissing)
                ++schemaMissingCount_;
        }

        // Completes the stored observation with the buffered response's
        // conformance verdict, and returns that verdict so the caller can put
        // it on the ledger line. An unobservable verdict (empty optional)
        // leaves the request-time record as it stands — schemaConformed
        // unset — rather than re-storing an identical value.
        std::optional<bool> recordResponseVerdict(SchemaObservation observation,
                                                  const std::string& body) {
            const std::optional<bool> verdict =
                observe_response(observation, config_.schema.validateResponses,
                                 /*isStream=*/false, body);
            if (!verdict)
                return verdict;

            observation.schemaConformed = verdict;
            const std::lock_guard<std::mutex> lock(observationMutex_);
            lastObservation_ = std::move(observation);
            return verdict;
        }

        RouterConfig config_;
        std::string groupHeader_;
        std::string schemaHeader_;

        // Declared before server_ so it outlives every handler thread the listener
        // owns: a request parked in admit() holds a reference to it, and server_'s
        // destructor is what joins those threads.
        AdmissionController admission_;

        // Same ordering law as admission_: a LedgerGuard riding a content
        // provider fires on a connection thread server_'s destructor joins, so
        // the ledger must still be alive then. The location comes ONLY from
        // config.metrics.ledgerPath.
        MetricsLedger metrics_;

        httplib::Server server_;
        std::thread listener_;
        int listenPort_{ 0 };

        mutable std::mutex tagsMutex_;
        std::optional<RequestTags> lastTags_;

        // Task 11.6's per-instance observation state, guarded together so the
        // counter and the last observation can never disagree mid-read.
        mutable std::mutex observationMutex_;
        std::optional<SchemaObservation> lastObservation_;
        std::uint64_t schemaMissingCount_{ 0 };
    };

}  // namespace conductor::router
