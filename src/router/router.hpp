// =============================================================================
// Task 11.3 — llama-router `router`: proxy pass-through.
//
// The §4.4 pass-through slice: an httplib listener in front of a separately
// launched llama-server. /v1/* is proxied; everything outside /v1/* (and the
// /conductor/* prefix Task 11.7 owns) is 404'd without touching the upstream.
// Admission (11.4), affinity (11.5), the schema observer (11.6) and metrics
// (11.7) are NOT here yet — the only thing this slice does beyond relaying is
// normalize the four §4.4 conductor tags into one RequestTags value that those
// later tasks consume.
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
//     mints a status of its own in exactly one situation, an upstream it could
//     not reach at all, and that is a per-request 502 envelope, never latched.
//
// Header-only, matching Task 11.2's config.hpp, so both llama-router and
// router-tests get it without a translation unit of their own.
// =============================================================================

#pragma once

#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <cctype>
#include <condition_variable>
#include <cstddef>
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

#include "router/config.hpp"

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

        inline bool isOneOfIgnoreCase(std::string_view name, const std::string_view* names, std::size_t count) {
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
            if (found == payload.end()) {
                return;
            }
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

    }  // namespace detail

    // Body-field fallback extraction + stripping. ALWAYS removes a top-level
    // "x_conductor" key from `body` when one exists. Tags are produced only when
    // the key's payload is an object of string values {"role"?, "priority"?,
    // "group"?, "schema"?}; any other payload extracts NOTHING (fail-open,
    // spdlog-logged) yet the key is still stripped. A body without the key is
    // left untouched and yields all-empty tags.
    inline RequestTags extract_and_strip_tags(nlohmann::json& body) {
        RequestTags tags;
        if (!body.is_object()) {
            return tags;
        }

        const auto found = body.find(kParamsFallbackField);
        if (found == body.end()) {
            return tags;
        }

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

    // The §4.4 pass-through slice only — admission/affinity/schema-observer/
    // metrics are Tasks 11.4-11.7 and are NOT part of this class yet.
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
    class Router {
    public:
        explicit Router(const RouterConfig& config)
            : config_(config)
            , groupHeader_(config.affinity.header.empty() ? detail::kGroupHeader : config.affinity.header)
            , schemaHeader_(config.schema.observeHeader.empty() ? detail::kSchemaHeader
                                                                : config.schema.observeHeader) {
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

            spdlog::info("router: listening on {}:{}, proxying /v1/* to {}:{}", config_.listen.host,
                         listenPort_, config_.upstream.host, config_.upstream.port);
        }

        void stop() {
            if (!listener_.joinable()) {
                return;
            }
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

    private:
        void installRoutes() {
            const httplib::Server::Handler proxy = [this](const httplib::Request& request,
                                                          httplib::Response& response) {
                handleProxy(request, response);
            };
            server_.Get(detail::kProxyPathPattern, proxy);
            server_.Post(detail::kProxyPathPattern, proxy);
            server_.Put(detail::kProxyPathPattern, proxy);
            server_.Patch(detail::kProxyPathPattern, proxy);
            server_.Delete(detail::kProxyPathPattern, proxy);
            server_.Options(detail::kProxyPathPattern, proxy);
        }

        void handleProxy(const httplib::Request& request, httplib::Response& response) {
            try {
                proxyToUpstream(request, response);
            } catch (const std::exception& failure) {
                // Nothing above this point rejects a request on purpose, so reaching
                // here means the router itself broke. Answering with the same
                // parseable envelope the fan-out side already understands beats
                // httplib's bare 500, and the cause is on the log.
                sendRouterError(response, std::string("llama-router failed to relay the request: ") +
                                              failure.what());
            }
        }

        void proxyToUpstream(const httplib::Request& request, httplib::Response& response) {
            RequestTags tags = tagsFromHeaders(request);
            std::string forwardBody = request.body;

            // The strip is the ONLY reason to touch the body, so it is the only
            // case that re-serializes. Anything else — no key, not an object, not
            // JSON at all — forwards the caller's exact bytes.
            if (!request.body.empty()) {
                nlohmann::json parsed = nlohmann::json::parse(request.body, nullptr, /*allow_exceptions=*/false);
                if (parsed.is_discarded()) {
                    spdlog::debug("router: {} {} body is not JSON — forwarded verbatim, no fallback tags",
                                  request.method, request.path);
                }
                else if (parsed.is_object() && parsed.contains(std::string(kParamsFallbackField))) {
                    const RequestTags fallback = extract_and_strip_tags(parsed);
                    mergeFallbackTags(tags, fallback);
                    try {
                        forwardBody = parsed.dump();
                    } catch (const nlohmann::json::exception& failure) {
                        // Re-serialization is the only step that can fail here, and a
                        // request that cannot be rewritten still has to be served:
                        // forward the original bytes, x_conductor and all.
                        spdlog::warn(
                            "router: could not re-serialize the body after stripping {} ({}) — "
                            "forwarding the original bytes",
                            kParamsFallbackField, failure.what());
                        forwardBody = request.body;
                    }
                }
            }

            recordTags(tags);

            httplib::Headers upstreamHeaders;
            for (const auto& [name, value] : request.headers) {
                if (!detail::isRequestHeaderDropped(name)) {
                    upstreamHeaders.emplace(name, value);
                }
            }

            auto relay = std::make_shared<detail::UpstreamRelay>();
            auto client = std::make_shared<httplib::Client>(config_.upstream.host, config_.upstream.port);
            client->set_tcp_nodelay(true);
            // The request target arrives already percent-encoded; re-encoding it
            // would rewrite bytes the caller chose.
            client->set_path_encode(false);
            client->set_keep_alive(false);
            client->set_connection_timeout(detail::kUpstreamConnectTimeoutSeconds, 0);
            client->set_read_timeout(detail::kRelayTimeoutSeconds, 0);
            client->set_write_timeout(detail::kRelayTimeoutSeconds, 0);

            // req.target is the raw request line target (path + query); req.path is
            // the decoded path only.
            const std::string target = request.target.empty() ? request.path : request.target;

            auto call = std::make_shared<detail::UpstreamCall>(relay, client);
            try {
                call->run([relay, client, method = request.method, target,
                           headers = std::move(upstreamHeaders), body = std::move(forwardBody)]() mutable {
                    runUpstreamCall(relay, client, method, target, std::move(headers), std::move(body));
                });
            } catch (const std::system_error& failure) {
                sendRouterError(response, upstreamMessage(std::string("could not start a relay thread: ") +
                                                          failure.what()));
                return;
            }

            bool haveResponse = false;
            int status = 0;
            httplib::Headers responseHeaders;
            httplib::Error error = httplib::Error::Success;
            {
                std::unique_lock<std::mutex> lock(relay->mutex);
                relay->cv.wait(lock, [&relay] {
                    return relay->headersReady || relay->finished;
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
                return;
            }

            response.status = status;
            for (const auto& [name, value] : responseHeaders) {
                if (!detail::isResponseHeaderDropped(name)) {
                    response.set_header(name, value);
                }
            }

            const std::string contentType = detail::headerValue(responseHeaders, "Content-Type");
            // A declared length means the whole body is bounded and known, so relay
            // it as one message with that same length. No length (chunked / read
            // until close) or an SSE content type means the upstream is producing
            // incrementally, and so must we.
            const bool incremental =
                detail::isEventStream(contentType) || !detail::hasHeader(responseHeaders, "Content-Length");

            if (!incremental) {
                std::string body;
                {
                    std::unique_lock<std::mutex> lock(relay->mutex);
                    relay->cv.wait(lock, [&relay] {
                        return relay->finished;
                    });
                    body.swap(relay->pending);
                }
                sendBuffered(response, contentType, std::move(body));
                return;
            }

            {
                const std::lock_guard<std::mutex> lock(relay->mutex);
                relay->streaming = true;
            }

            // httplib calls this back after the handler returns, once per write, on
            // the connection thread. Blocking inside it is how the stream stays
            // unbuffered: the call parks until the upstream has produced something,
            // writes exactly what arrived, and returns for the next round. `call`
            // rides along in the capture so the upstream thread outlives the handler.
            response.set_chunked_content_provider(
                contentType, [relay, call](std::size_t /*offset*/, httplib::DataSink& sink) {
                    std::string chunk;
                    bool complete = false;
                    {
                        std::unique_lock<std::mutex> lock(relay->mutex);
                        relay->cv.wait(lock, [&relay] {
                            return !relay->pending.empty() || relay->finished || relay->cancelled;
                        });
                        chunk.swap(relay->pending);
                        complete = relay->finished || relay->cancelled;
                    }
                    relay->cv.notify_all();

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
                        sink.done();
                    }
                    return true;
                });
        }

        // Drives one upstream request to completion on its own thread, publishing
        // the response line/headers the instant they land and every payload byte as
        // it arrives, so the handler can start relaying before the upstream is done.
        static void runUpstreamCall(const std::shared_ptr<detail::UpstreamRelay>& relay,
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
                    if (relay->cancelled) {
                        proceed = false;
                    }
                    else {
                        relay->status = upstreamResponse.status;
                        relay->headers = upstreamResponse.headers;
                        relay->headersReady = true;
                    }
                }
                relay->cv.notify_all();
                return proceed;
            };

            upstreamRequest.content_receiver = [relay](const char* data, std::size_t length,
                                                       std::size_t /*offset*/, std::size_t /*total*/) {
                std::unique_lock<std::mutex> lock(relay->mutex);
                if (relay->cancelled) {
                    return false;
                }
                relay->pending.append(data, length);
                relay->cv.notify_all();
                // Back-pressure only applies once a content provider is actually
                // draining; the buffered path collects the whole body itself and
                // would deadlock against a high-water mark.
                relay->cv.wait(lock, [&relay] {
                    return relay->cancelled || !relay->streaming ||
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
        static void sendBuffered(httplib::Response& response, const std::string& contentType,
                                 std::string&& body) {
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

        [[nodiscard]] std::string upstreamMessage(const std::string& cause) const {
            return "llama-router could not reach the upstream at " + config_.upstream.host + ":" +
                   std::to_string(config_.upstream.port) + ": " + cause;
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
        static void readHeaderTag(std::optional<std::string>& slot, const httplib::Request& request,
                                  const std::string& name) {
            if (!request.has_header(name)) {
                return;
            }
            std::string value = request.get_header_value(name);
            if (value.empty()) {
                return;
            }
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
        static void applyFallbackTag(std::optional<std::string>& slot,
                                     const std::optional<std::string>& fallback, const char* name) {
            if (!fallback) {
                return;
            }
            if (!slot) {
                slot = fallback;
                return;
            }
            if (*slot != *fallback) {
                spdlog::debug("router: header tag '{}' = '{}' wins over the {} field's '{}'", name, *slot,
                              kParamsFallbackField, *fallback);
            }
        }

        void recordTags(const RequestTags& tags) {
            const std::lock_guard<std::mutex> lock(tagsMutex_);
            lastTags_ = tags;
        }

        RouterConfig config_;
        std::string groupHeader_;
        std::string schemaHeader_;

        httplib::Server server_;
        std::thread listener_;
        int listenPort_{ 0 };

        mutable std::mutex tagsMutex_;
        std::optional<RequestTags> lastTags_;
    };

}  // namespace conductor::router
