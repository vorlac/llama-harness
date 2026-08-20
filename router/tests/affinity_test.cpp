// =============================================================================
// Task 11.5 — llama-router `affinity`: prefix-group contiguous dequeue.
//
// Everything this file touches beyond affinity.hpp — config.hpp, router.hpp,
// admission.hpp — must keep compiling verbatim.
//
// One TEST_CASE per assertion id from docs/build/specs/task-11.5.assertions.json,
// named "[<id>] …". Six of the seven rows drive the POLICY directly: it is pure,
// so they are deterministic, thread-free and clock-free. Only
// [11.5-header-from-config] needs a live Router, because its whole point is that
// 11.5 must NOT re-read a header — it consumes 11.3's already-parsed
// RequestTags.group.
//
// THE TARGET SURFACE
//
//   // router/affinity.hpp   (HEADER-ONLY, matching 11.2/11.3/11.4)
//   #pragma once
//
//   #include <cstddef>
//   #include <cstdint>
//   #include <optional>
//   #include <string>
//   #include <vector>
//
//   #include "router/config.hpp"
//
//   namespace conductor::router {
//
//   // ONE queued request as the dequeue policy sees it. Nothing else about the
//   // request is policy input: no model, no clock, no header.
//   struct AffinityEntry {
//       // 11.4's priority VALUE (the §2.2 priorities block), lower dequeues
//       // first. NOT the tag string — affinity never re-derives a class.
//       int priority{};
//       // 11.3's RequestTags.group verbatim; an empty optional is untagged.
//       std::optional<std::string> group;
//       // The arrival ordinal 11.4 assigns under the queue lock (QueueKey's
//       // second element). Ties break on this, never on wall-clock time.
//       std::uint64_t arrival{};
//   };
//
//   // The §1.1 prefix-group contiguous dequeue policy. Pure in the sense that
//   // matters: no lock, no thread, no clock, no I/O — the next choice is a
//   // function of the entries handed in, the parsed §2.2 affinity block, and
//   // the burst this object carries between calls.
//   //
//   // Ordering law, as resolved in the assertions file:
//   //   1. strict priority is the OUTER order: only entries at the MINIMUM
//   //      priority value present are ever eligible, so 11.4's
//   //      interactive < review < batch survives verbatim and a higher-class
//   //      arrival mid-drain wins the next dequeue;
//   //   2. contiguousDequeue == false makes this class fully INERT — the
//   //      selection is the plain 11.4 (priority, arrival) head;
//   //   3. otherwise, while a burst is active in that class, the lowest-arrival
//   //      member of the burst's group that was QUEUED AT SELECTION TIME is
//   //      chosen; members that arrive mid-drain are NOT in the burst and wait
//   //      for the group's next turn (this is what keeps a busy group from
//   //      starving its neighbours);
//   //   4. otherwise a new burst starts at the class's oldest-waiting head. An
//   //      untagged head starts no burst, which is why affinity can push an
//   //      untagged request back but never pulls one forward.
//   class AffinityPolicy {
//    public:
//     explicit AffinityPolicy(const Affinity& config);
//
//     // Index into `entries` of the request to grant next, or nullopt when
//     // `entries` is empty. Advances the burst.
//     [[nodiscard]] std::optional<std::size_t> selectNext(
//         const std::vector<AffinityEntry>& entries);
//   };
//
//   }  // namespace conductor::router
//
// THE ADMISSION SEAM (router/admission.hpp, Task 11.4, extended IN PLACE —
// affinity is never a second queue and never a second lock):
//   - the committed Waiter gains the group it was tagged with, so the queue can
//     be asked about it at grant time:
//         struct Waiter {
//             std::string model;
//             std::optional<std::string> group;   // 11.3's RequestTags.group
//             std::condition_variable woken;
//             bool granted{false};
//         };
//   - admit() gains that group, alongside the priority it already takes:
//         AdmissionOutcome admit(const std::string& model,
//                                const std::optional<std::string>& priority,
//                                const std::optional<std::string>& group);
//   - grantNext(model) stops taking the first map-order match. Under the mutex
//     it ALREADY holds it projects the queue_ entries for `model` into a
//     std::vector<AffinityEntry> — priority = key.first, arrival = key.second,
//     group = waiter->group — asks AffinityPolicy::selectNext for an index, and
//     grants that entry. One policy per model keeps two counter keys from
//     sharing a burst; G13 pins one model, so a single instance is equivalent
//     today.
//   - the controller builds its policy from the config it is already given:
//     AffinityPolicy(config.affinity). No config file is re-read.
//
// THE ROUTER SEAM (router/router.hpp, Task 11.3/11.4, extended IN PLACE):
//   handleProxy already computes plan.tags; it passes plan.tags.group to
//   admit(). The group VALUE was resolved by 11.3 with the CONFIGURED header
//   name (Router::groupHeader_, falling back to X-Conductor-Group when
//   config.affinity.header is blank) or by the x_conductor body fallback. 11.5
//   introduces no second precedence rule and reads no header of its own.
//
// affinity.hpp is header-only and needs no source-list entry.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
//
// NO SLEEPS AS SYNCHRONIZATION anywhere below, and NO fake clock: the policy
// rows are straight-line calls, and the one live-Router row synchronizes on
// observable state (queued_count(), the stub's request log) exactly as 11.3 and
// 11.4 do. The client read timeout and the poll deadline bound a FAILING run
// only — no passing assertion depends on either. Swap batching (G13) is not
// built and not tested here.
// =============================================================================

#include <doctest/doctest.h>
#include <httplib.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <iterator>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include "router/admission.hpp"
#include "router/affinity.hpp"
#include "router/config.hpp"
#include "router/router.hpp"

namespace {

    using conductor::router::AdmissionOutcome;
    using conductor::router::Affinity;
    using conductor::router::AffinityEntry;
    using conductor::router::AffinityPolicy;
    using nlohmann::json;

    using Order = std::vector<std::string>;

    constexpr const char* kHost = "127.0.0.1";
    constexpr const char* kChatPath = "/v1/chat/completions";
    constexpr const char* kModelA = "model-a";

    // The §2.2 priorities VALUES, lower dequeues first. The policy is told the
    // value, never the tag string, so these are just the numbers 11.4 computes.
    constexpr int kInteractive = 0;
    constexpr int kReview = 1;
    constexpr int kBatch = 2;

    // A DIFFERENT priorities block, to pin that the ordering follows the
    // configured values rather than a hardcoded 0/1/2.
    constexpr int kSlowInteractive = 10;
    constexpr int kSlowReview = 20;
    constexpr int kSlowBatch = 30;

    Affinity affinityConfig(bool contiguousDequeue) {
        Affinity config;
        config.header = "X-Conductor-Group";
        config.contiguousDequeue = contiguousDequeue;
        return config;
    }

    std::optional<std::string> grouped(std::string name) {
        return std::optional<std::string>{ std::move(name) };
    }

    // An absent tag, spelled out where it matters that the request is UNTAGGED
    // rather than in some catch-all group.
    const std::optional<std::string> kUntagged{};

    std::string join(const Order& names) {
        std::string out;
        for (const std::string& name : names) {
            if (!out.empty())
                out += " -> ";

            out += name;
        }

        return out;
    }

    std::size_t indexOf(const Order& names, std::string_view wanted) {
        const auto found = std::find(names.begin(), names.end(), wanted);
        REQUIRE(found != names.end());
        return static_cast<std::size_t>(found - names.begin());
    }

    // Keeps only the names that appear in `subset`, in observed order, so an
    // untagged subsequence can be compared across two orderings.
    Order keepOnly(const Order& names, const Order& subset) {
        Order kept;
        for (const std::string& name : names) {
            if (std::find(subset.begin(), subset.end(), name) != subset.end())
                kept.push_back(name);
        }

        return kept;
    }

    struct Queued {
        std::string name;
        AffinityEntry entry;
    };

    /**
     * The queue 11.4 owns, modelled around the policy under test: entries arrive
     * with a monotonically increasing arrival ordinal (exactly what
     * AdmissionController assigns under its lock) and leave one at a time through
     * AffinityPolicy::selectNext, which is precisely how grantNext() consumes it.
     *
     * Everything here is straight-line: no thread, no condvar, no clock. The
     * OBSERVED dequeue order is the only thing any case asserts on.
     */
    class QueueModel {
    public:
        explicit QueueModel(const Affinity& config)
            : policy_(config) {
        }

        void arrive(std::string name, int priority, const std::optional<std::string>& group) {
            arriveAt(std::move(name), priority, group, nextArrival_);
        }

        // Same logical arrival, but with the ordinal chosen by the caller — used
        // to prove that only the RELATIVE order of ordinals matters.
        void arriveAt(std::string name, int priority, const std::optional<std::string>& group,
                      std::uint64_t arrival) {
            Queued queued;
            queued.name = std::move(name);
            queued.entry.priority = priority;
            queued.entry.group = group;
            queued.entry.arrival = arrival;
            queued_.push_back(std::move(queued));
            nextArrival_ = std::max(nextArrival_, arrival + 1);
        }

        [[nodiscard]] bool empty() const {
            return queued_.empty();
        }

        // The lowest priority VALUE still queued — what strict priority says the
        // next dequeue must come from, whatever affinity wants.
        [[nodiscard]] int minQueuedPriority() const {
            REQUIRE_FALSE(queued_.empty());
            int lowest = queued_.front().entry.priority;
            for (const Queued& queued : queued_)
                lowest = std::min(lowest, queued.entry.priority);

            return lowest;
        }

        Queued dequeueEntry() {
            REQUIRE_FALSE(queued_.empty());

            std::vector<AffinityEntry> entries;
            entries.reserve(queued_.size());
            for (const Queued& queued : queued_)
                entries.push_back(queued.entry);

            const std::optional<std::size_t> chosen = policy_.selectNext(entries);
            REQUIRE(chosen.has_value());
            REQUIRE(*chosen < queued_.size());

            const Queued taken = queued_[*chosen];
            queued_.erase(queued_.begin() + static_cast<std::ptrdiff_t>(*chosen));
            return taken;
        }

        std::string dequeue() {
            return dequeueEntry().name;
        }

        Order drain() {
            Order order;
            while (!queued_.empty())
                order.push_back(dequeue());

            return order;
        }

        // The plain Task 11.4 answer for whatever is queued right now: priority
        // class, then FIFO on the arrival ordinal. Affinity is measured against
        // this.
        [[nodiscard]] Order plainOrder() const {
            std::vector<Queued> sorted = queued_;
            std::sort(sorted.begin(), sorted.end(), [](const Queued& lhs, const Queued& rhs) {
                if (lhs.entry.priority != rhs.entry.priority)
                    return lhs.entry.priority < rhs.entry.priority;

                return lhs.entry.arrival < rhs.entry.arrival;
            });

            Order order;
            order.reserve(sorted.size());
            for (const Queued& queued : sorted)
                order.push_back(queued.name);

            return order;
        }

        [[nodiscard]] Order untaggedNames() const {
            Order names;
            for (const Queued& queued : queued_) {
                if (!queued.entry.group.has_value())
                    names.push_back(queued.name);
            }

            return names;
        }

        // Reorders the STORAGE without touching a single arrival ordinal. A
        // policy that read its input's position instead of the ordinal assigned
        // under the queue lock changes its answer here; a correct one cannot.
        void permuteStorage(std::mt19937& rng) {
            for (std::size_t i = queued_.size(); i > 1; --i) {
                const std::size_t j = static_cast<std::size_t>(rng()) % i;
                std::swap(queued_[i - 1], queued_[j]);
            }
        }

    private:
        AffinityPolicy policy_;
        std::vector<Queued> queued_;
        std::uint64_t nextArrival_{ 0 };
    };

    // One logical arrival, independent of any policy instance, so the same
    // sequence can be replayed into several QueueModels.
    struct Arrival {
        std::string name;
        int priority{};
        std::optional<std::string> group;
    };

    void replay(QueueModel& queue, const std::vector<Arrival>& arrivals) {
        for (const Arrival& arrival : arrivals)
            queue.arrive(arrival.name, arrival.priority, arrival.group);
    }

    // A fixed, mixed arrival sequence: three priority classes, two groups and
    // untagged requests interleaved. Reused by several rows so they all speak
    // about the same queue.
    std::vector<Arrival> mixedArrivals() {
        return {
            { "j0", kInteractive, grouped("alpha") },
            { "j1", kReview, grouped("beta") },
            { "j2", kInteractive, kUntagged },
            { "j3", kInteractive, grouped("alpha") },
            { "j4", kBatch, grouped("alpha") },
            { "j5", kReview, grouped("beta") },
            { "j6", kInteractive, grouped("beta") },
            { "j7", kReview, kUntagged },
        };
    }

    // Deterministic pseudo-random arrival sequences: std::mt19937 with a fixed
    // seed and raw modulo (never a distribution, whose mapping is
    // implementation-defined), so every ctest run — repeated, or in any order —
    // sees the identical sequences.
    std::vector<Arrival> randomArrivals(std::mt19937& rng, std::size_t count) {
        static const int priorities[] = { kInteractive, kReview, kBatch };
        static const char* const groups[] = { nullptr, "g1", "g2", "g3" };

        std::vector<Arrival> arrivals;
        arrivals.reserve(count);
        for (std::size_t i = 0; i < count; ++i) {
            Arrival arrival;
            arrival.name = "r" + std::to_string(i);
            arrival.priority = priorities[static_cast<std::size_t>(rng()) % 3];
            const char* const group = groups[static_cast<std::size_t>(rng()) % 4];
            if (group != nullptr)
                arrival.group = std::string(group);

            arrivals.push_back(std::move(arrival));
        }

        return arrivals;
    }

    // Every same-group run in `order` is contiguous: a group that appears, stops
    // and appears again has been interrupted by a foreign request. Untagged
    // requests form no group, so they are not held to this.
    bool groupsAreContiguous(const Order& order, const std::vector<Arrival>& arrivals) {
        const auto groupOf = [&arrivals](const std::string& name) -> std::optional<std::string> {
            for (const Arrival& arrival : arrivals) {
                if (arrival.name == name)
                    return arrival.group;
            }

            return std::nullopt;
        };

        Order closed;
        std::optional<std::string> current;
        for (const std::string& name : order) {
            const std::optional<std::string> group = groupOf(name);
            if (group == current)
                continue;

            if (current.has_value()) {
                if (std::find(closed.begin(), closed.end(), *current) != closed.end())
                    return false;

                closed.push_back(*current);
            }

            current = group;
        }

        return true;
    }

    // =========================================================================
    // The live-Router harness for [11.5-header-from-config], the 11.3/11.4 idiom
    // verbatim: an in-process stub upstream on an EPHEMERAL port that HOLDS each
    // request until the test frees it, so a backlog forms behind the admission
    // cap without anything sleeping on an assumed duration.
    // =========================================================================

    // Client read timeout: a FAILURE backstop only. Every request here is meant
    // to be released long before this elapses; it exists so a wrong
    // implementation unwinds instead of wedging ctest forever.
    constexpr int kClientReadTimeoutSeconds = 60;

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
            return markers_.size();
        }

        // Dispatch order as the upstream observed it.
        [[nodiscard]] Order markers() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return markers_;
        }

    private:
        void handle(const httplib::Request& request, httplib::Response& response) {
            const json body = json::parse(request.body, nullptr, /*allow_exceptions=*/false);
            const bool object = !body.is_discarded() && body.is_object();
            const std::string marker = object ? body.value("marker", std::string()) : std::string();
            const bool hold = object && body.value("hold", false);

            std::size_t holdIndex = 0;

            {
                const std::lock_guard<std::mutex> lock(mutex_);
                markers_.push_back(marker);
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
            answer["served"] = marker;
            response.set_content(answer.dump(), "application/json");
        }

        httplib::Server server_;
        std::thread listen_;
        int port_{ 0 };

        mutable std::mutex mutex_;
        std::condition_variable gate_;
        Order markers_;
        std::size_t held_{ 0 };
        std::size_t released_{ 0 };
    };

    // Frees every hold when the enclosing scope unwinds — including on a failed
    // REQUIRE, which throws. Declared AFTER the in-flight/queued clients so it is
    // destroyed BEFORE them: the clients can then finish and join instead of
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

    // One request in flight on its own thread, because an admitted-and-held or
    // queued request BLOCKS its caller — that is the property this row leans on.
    class AsyncRequest {
    public:
        AsyncRequest(int port, httplib::Headers headers, std::string body) {
            thread_ = std::thread(
                [this, port, headers = std::move(headers), body = std::move(body)]() mutable {
                    httplib::Client client(kHost, port);
                    client.set_connection_timeout(10, 0);
                    client.set_read_timeout(kClientReadTimeoutSeconds, 0);
                    client.set_write_timeout(kClientReadTimeoutSeconds, 0);
                    result_.emplace(client.Post(kChatPath, headers, body, "application/json"));
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

    // Readiness poll on OBSERVABLE state (the 11.3/11.4 idiom): the predicate is
    // the synchronization, the 2ms interval is only poll granularity, and the
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

    // The Router consumes Task 11.2's PARSED RouterConfig, so the row builds the
    // struct directly (the 11.3/11.4 makeConfig idiom). listen.port 0 is the
    // pinned test-only "bind an ephemeral port" construction, which is what keeps
    // repeated and out-of-order ctest runs independent.
    conductor::router::RouterConfig makeConfig(int upstreamPort, const std::string& groupHeader,
                                               bool contiguousDequeue) {
        conductor::router::RouterConfig config;
        config.version = 1;
        config.listen = { kHost, 0 };
        config.upstream = { kHost, upstreamPort };
        config.admission = { /*maxInflightPerModel=*/1, /*maxQueued=*/16,
                             /*queueTimeoutMs=*/600000 };
        config.priorities = { kInteractive, kReview, kBatch };
        config.affinity = { groupHeader, contiguousDequeue };
        config.schema = { "X-Conductor-Schema", true, false };
        config.metrics = {
            (std::filesystem::temp_directory_path() / "conductor-router-11.5" / "metrics.jsonl")
                .string()
        };
        config.logging = { "info" };
        return config;
    }

    std::string requestBody(const std::string& marker, const char* bodyGroup) {
        json body;
        body["model"] = kModelA;
        body["marker"] = marker;
        body["hold"] = true;
        body["messages"] = json::array({ json{ { "role", "user" }, { "content", marker } } });
        // The §4.4 body-field fallback carrying the group and nothing else: 11.3
        // normalizes it into RequestTags.group whatever the configured header is
        // called, so a router that re-parsed a header itself would see no group
        // here at all.
        if (bodyGroup != nullptr)
            body[conductor::router::kParamsFallbackField] = json{ { "group", bodyGroup } };

        return body.dump();
    }

    // ONE tagged arrival for the live row.
    struct TaggedArrival {
        const char* marker;
        const char* headerName;  // nullptr: no group header at all.
        const char* headerValue;
        const char* bodyGroup;   // nullptr: no x_conductor group.
    };

    // The identical arrival sequence is replayed under two different configured
    // header names. Only the CONFIGURED one may group.
    const TaggedArrival kTaggedArrivals[] = {
        { "t-alpha-1", "X-Team-Bucket", "alpha", nullptr },
        { "c-alpha-1", "X-Conductor-Group", "alpha", nullptr },
        { "t-alpha-2", "X-Team-Bucket", "alpha", nullptr },
        { "c-alpha-2", "X-Conductor-Group", "alpha", nullptr },
        { "body-alpha", nullptr, nullptr, "alpha" },
        { "plain", nullptr, nullptr, nullptr },
    };

    // Drives one dispatch-order observation through a live Router configured with
    // `groupHeader`: a held request fills the single in-flight slot, the six
    // arrivals above are queued ONE AT A TIME (each observed queued before the
    // next is sent, so the arrival order is a fact and not a race), then one slot
    // is freed per release and the order the upstream saw is read back.
    Order dispatchOrderFor(const std::string& groupHeader) {
        HoldingUpstream upstream;
        upstream.start();

        conductor::router::Router router(makeConfig(upstream.port(), groupHeader, true));
        router.start();

        RequestPtr held;
        std::vector<RequestPtr> queued;
        DrainGuard drain(upstream);

        held = std::make_unique<AsyncRequest>(router.listen_port(), httplib::Headers{},
                                              requestBody("hold", nullptr));
        REQUIRE(waitUntil([&upstream] {
            return upstream.seenCount() == 1;
        }));

        std::size_t depth = 0;
        for (const TaggedArrival& arrival : kTaggedArrivals) {
            httplib::Headers headers;
            if (arrival.headerName != nullptr)
                headers.emplace(arrival.headerName, arrival.headerValue);

            queued.push_back(std::make_unique<AsyncRequest>(
                router.listen_port(), headers, requestBody(arrival.marker, arrival.bodyGroup)));

            ++depth;
            REQUIRE(waitUntil([&router, depth] {
                return router.admission().queued_count() == depth;
            }));
        }

        // Nothing was dispatched by arriving: the whole sequence is a backlog.
        REQUIRE(upstream.seenCount() == 1);

        // One release frees exactly one slot, which grants exactly one queued
        // entry, so the upstream's arrival log IS the dequeue order.
        for (std::size_t dispatched = 0; dispatched < std::size(kTaggedArrivals); ++dispatched) {
            upstream.releaseNext();
            const std::size_t want = dispatched + 2;
            REQUIRE(waitUntil([&upstream, want] {
                return upstream.seenCount() == want;
            }));
        }

        CHECK(router.admission().queued_count() == 0);

        upstream.releaseAll();
        held->join();
        for (const RequestPtr& request : queued) {
            request->join();
            REQUIRE(request->result());
            CHECK(request->result()->status == 200);
        }

        const Order markers = upstream.markers();
        REQUIRE(markers.size() == std::size(kTaggedArrivals) + 1);
        REQUIRE(markers.front() == "hold");
        return Order(markers.begin() + 1, markers.end());
    }

}  // namespace

TEST_CASE(
    "[11.5-contiguous-dequeue] among QUEUED requests, one group's members dequeue CONTIGUOUSLY: "
    "every same-group member queued at selection time goes before any other-group or untagged "
    "request of the same class") {
    const std::vector<Arrival> arrivals = {
        { "a-1", kInteractive, grouped("alpha") },
        { "b-1", kInteractive, grouped("beta") },
        { "a-2", kInteractive, grouped("alpha") },
        { "b-2", kInteractive, grouped("beta") },
        { "untagged", kInteractive, kUntagged },
        { "a-3", kInteractive, grouped("alpha") },
    };

    QueueModel queue(affinityConfig(true));
    replay(queue, arrivals);

    const Order plain = queue.plainOrder();
    const Order order = queue.drain();

    const std::string observed = join(order);
    const std::string plainTrace = join(plain);
    INFO("affinity:   ", observed);
    INFO("plain 11.4: ", plainTrace);

    // The whole point: alpha's three members and beta's two each come out as one
    // run, oldest-waiting head first.
    const Order expected = { "a-1", "a-2", "a-3", "b-1", "b-2", "untagged" };
    CHECK(order == expected);
    CHECK(groupsAreContiguous(order, arrivals));

    // Stated the way the row states it, so the assertion survives any re-spelling
    // of the expected vector: no foreign request lands inside a group's run.
    CHECK(indexOf(order, "a-3") < indexOf(order, "b-1"));
    CHECK(indexOf(order, "a-3") < indexOf(order, "untagged"));
    CHECK(indexOf(order, "b-2") < indexOf(order, "untagged"));

    // And it really is a REORDERING — plain 11.4 order interleaves these — so
    // nothing here passes by doing nothing.
    const Order expectedPlain = { "a-1", "b-1", "a-2", "b-2", "untagged", "a-3" };
    CHECK(plain == expectedPlain);
    CHECK(order != plain);
}

TEST_CASE(
    "[11.5-fair-interleave] a group that keeps receiving new members cannot hold the queue: its "
    "burst covers only the members queued at selection time, so the next group drains within a "
    "bounded number of dequeues, and a batch-class group drains once higher-class pressure clears") {
    // A busy group against a quiet one, same class. Alpha gains a fresh member
    // after EVERY dequeue, which is exactly the shape that starves a naive "keep
    // draining the selected group" policy.
    QueueModel queue(affinityConfig(true));
    queue.arrive("a-1", kInteractive, grouped("alpha"));
    queue.arrive("a-2", kInteractive, grouped("alpha"));
    queue.arrive("b-1", kInteractive, grouped("beta"));
    queue.arrive("b-2", kInteractive, grouped("beta"));

    Order order;
    for (int step = 0; step < 12; ++step) {
        order.push_back(queue.dequeue());
        queue.arrive("a-fresh-" + std::to_string(step), kInteractive, grouped("alpha"));
    }

    const std::string busyTrace = join(order);
    INFO("under continuous alpha arrivals: ", busyTrace);

    // Beta was served in full while alpha never stopped arriving, and inside the
    // first four dequeues rather than "eventually".
    CHECK(indexOf(order, "b-1") < 4u);
    CHECK(indexOf(order, "b-2") < 4u);

    const Order firstFour(order.begin(), order.begin() + 4);
    const Order expectedFirstFour = { "a-1", "a-2", "b-1", "b-2" };
    CHECK(firstFour == expectedFirstFour);

    // The members that arrived DURING alpha's burst waited for alpha's next turn
    // instead of extending it.
    CHECK(indexOf(order, "a-fresh-0") > indexOf(order, "b-2"));

    // Cross-class half of the row: a batch-class group waits behind every higher
    // class and then drains — 11.4's strict priority plus queueTimeoutMs, not a
    // starvation affinity introduced.
    const std::vector<Arrival> mixed = {
        { "x-1", kBatch, grouped("xray") },
        { "x-2", kBatch, grouped("xray") },
        { "i-1", kInteractive, grouped("india") },
        { "i-2", kInteractive, grouped("india") },
        { "r-1", kReview, kUntagged },
    };

    QueueModel classes(affinityConfig(true));
    replay(classes, mixed);

    const Order drained = classes.drain();
    const std::string drainedTrace = join(drained);
    INFO("across classes: ", drainedTrace);

    const Order expectedDrained = { "i-1", "i-2", "r-1", "x-1", "x-2" };
    CHECK(drained == expectedDrained);
    CHECK(groupsAreContiguous(drained, mixed));
    // The batch group drained completely: nothing was dropped or left behind.
    CHECK(indexOf(drained, "x-2") == drained.size() - 1);
}

TEST_CASE(
    "[11.5-jitter-stable] the dequeue order is a deterministic function of (priority value, group "
    "id, arrival ordinal): replaying the same logical arrivals with different interleavings, and "
    "with different absolute ordinals, yields the identical order every run") {
    const std::vector<Arrival> arrivals = mixedArrivals();

    QueueModel baselineQueue(affinityConfig(true));
    replay(baselineQueue, arrivals);
    const Order baseline = baselineQueue.drain();

    const std::string baselineTrace = join(baseline);
    INFO("baseline: ", baselineTrace);

    // The order this queue must produce, spelled out: alpha's queued class-0 run
    // first, then the class-0 stragglers oldest-first, then class 1's beta run,
    // then class 2. Nothing in it depends on when anything was observed.
    const Order expected = { "j0", "j3", "j2", "j6", "j1", "j5", "j7", "j4" };
    CHECK(baseline == expected);

    // Same logical sequence, replayed from scratch several times: identical.
    for (int run = 0; run < 5; ++run) {
        QueueModel repeat(affinityConfig(true));
        replay(repeat, arrivals);
        const Order order = repeat.drain();

        const std::string trace = join(order);
        INFO("run ", run, ": ", trace);
        CHECK(order == baseline);
    }

    // Same logical sequence, but the queue's STORAGE is permuted before every
    // single selection — the jitter a real queue sees between arrival and
    // observation. Ties must break on the arrival ordinal, so the answer cannot
    // move.
    std::mt19937 rng(20250811u);
    for (int run = 0; run < 8; ++run) {
        QueueModel jittered(affinityConfig(true));
        replay(jittered, arrivals);

        Order order;
        while (!jittered.empty()) {
            jittered.permuteStorage(rng);
            order.push_back(jittered.dequeue());
        }

        const std::string trace = join(order);
        INFO("permuted run ", run, ": ", trace);
        CHECK(order == baseline);
    }

    // Same RELATIVE arrival order, wildly different absolute ordinals: a policy
    // that read a clock, a duration or an ordinal's magnitude would answer
    // differently.
    const std::uint64_t gapped[] = { 7, 19, 44, 45, 900, 1201, 1202, 98765 };
    REQUIRE(std::size(gapped) == arrivals.size());

    QueueModel sparse(affinityConfig(true));
    for (std::size_t index = 0; index < arrivals.size(); ++index) {
        sparse.arriveAt(arrivals[index].name, arrivals[index].priority, arrivals[index].group,
                        gapped[index]);
    }

    const Order sparseOrder = sparse.drain();
    const std::string sparseTrace = join(sparseOrder);
    INFO("gapped ordinals: ", sparseTrace);
    CHECK(sparseOrder == baseline);
}

TEST_CASE(
    "[11.5-untagged-never-jump] affinity never ADVANCES an untagged request: it never dequeues "
    "earlier than plain 11.4 order would place it, and untagged requests keep FIFO order among "
    "themselves") {
    const std::vector<Arrival> arrivals = {
        { "u-1", kInteractive, kUntagged },
        { "a-1", kInteractive, grouped("alpha") },
        { "u-2", kInteractive, kUntagged },
        { "a-2", kInteractive, grouped("alpha") },
        { "b-1", kInteractive, grouped("beta") },
        { "u-3", kInteractive, kUntagged },
        { "a-3", kInteractive, grouped("alpha") },
    };

    QueueModel queue(affinityConfig(true));
    replay(queue, arrivals);

    const Order plain = queue.plainOrder();
    const Order untagged = queue.untaggedNames();
    const Order order = queue.drain();

    const std::string observed = join(order);
    const std::string plainTrace = join(plain);
    INFO("affinity:   ", observed);
    INFO("plain 11.4: ", plainTrace);

    const Order expected = { "u-1", "a-1", "a-2", "a-3", "u-2", "b-1", "u-3" };
    CHECK(order == expected);

    // The law itself: every untagged request is at or BEHIND the position plain
    // priority+FIFO gives it. Grouped peers may be pulled forward past it; it is
    // never pulled forward past anything.
    for (const std::string& name : untagged) {
        const std::size_t plainAt = indexOf(plain, name);
        const std::size_t affinityAt = indexOf(order, name);
        INFO("untagged '", name, "' plain=", plainAt, " affinity=", affinityAt);
        CHECK(affinityAt >= plainAt);
    }

    CHECK(keepOnly(order, untagged) == keepOnly(plain, untagged));

    // Swept over many deterministic arrival sequences, so the property is a law
    // and not an artefact of the sequence above.
    std::mt19937 rng(99001u);
    for (int trial = 0; trial < 200; ++trial) {
        const std::vector<Arrival> sample =
            randomArrivals(rng, 3 + static_cast<std::size_t>(rng()) % 10);

        QueueModel swept(affinityConfig(true));
        replay(swept, sample);

        const Order sweptPlain = swept.plainOrder();
        const Order sweptUntagged = swept.untaggedNames();
        const Order sweptOrder = swept.drain();

        const std::string sweptTrace = join(sweptOrder);
        const std::string sweptPlainTrace = join(sweptPlain);
        INFO("trial ", trial, " affinity: ", sweptTrace);
        INFO("trial ", trial, " plain:    ", sweptPlainTrace);

        for (const std::string& name : sweptUntagged) {
            const std::size_t plainAt = indexOf(sweptPlain, name);
            const std::size_t affinityAt = indexOf(sweptOrder, name);
            INFO("untagged '", name, "' plain=", plainAt, " affinity=", affinityAt);
            CHECK(affinityAt >= plainAt);
        }

        CHECK(keepOnly(sweptOrder, sweptUntagged) == keepOnly(sweptPlain, sweptUntagged));
    }
}

TEST_CASE(
    "[11.5-priority-precedence] affinity reorders only WITHIN a priority class: a lower-class "
    "group member never rides its group's drain ahead of a queued higher-class request, and a "
    "higher-class arrival mid-drain wins the next dequeue — 11.4's ordering survives verbatim") {
    // One group spanning three classes. Contiguity must NOT pull alpha's batch
    // members forward behind their interactive sibling.
    const std::vector<Arrival> spanning = {
        { "alpha-batch-1", kBatch, grouped("alpha") },
        { "alpha-batch-2", kBatch, grouped("alpha") },
        { "alpha-interactive", kInteractive, grouped("alpha") },
        { "beta-review", kReview, grouped("beta") },
    };

    QueueModel queue(affinityConfig(true));
    replay(queue, spanning);

    Order order;
    std::vector<int> priorities;
    while (!queue.empty()) {
        // Read BEFORE the removal: strict priority says the next dequeue can only
        // come from the lowest class still queued, whatever the burst wants.
        const int lowest = queue.minQueuedPriority();
        const Queued taken = queue.dequeueEntry();
        INFO("selected '", taken.name, "' at priority ", taken.entry.priority, ", lowest queued ",
             lowest);
        CHECK(taken.entry.priority == lowest);
        order.push_back(taken.name);
        priorities.push_back(taken.entry.priority);
    }

    const std::string spanningTrace = join(order);
    INFO("spanning: ", spanningTrace);

    const Order expectedSpanning = { "alpha-interactive", "beta-review", "alpha-batch-1",
                                     "alpha-batch-2" };
    CHECK(order == expectedSpanning);
    CHECK(std::is_sorted(priorities.begin(), priorities.end()));

    // A higher-class arrival lands mid-drain and wins the NEXT dequeue, breaking
    // the batch group's run; the run resumes afterwards.
    QueueModel interrupted(affinityConfig(true));
    interrupted.arrive("batch-1", kBatch, grouped("alpha"));
    interrupted.arrive("batch-2", kBatch, grouped("alpha"));
    interrupted.arrive("batch-3", kBatch, grouped("alpha"));

    Order interruptedOrder;
    interruptedOrder.push_back(interrupted.dequeue());
    interrupted.arrive("interactive-late", kInteractive, grouped("gamma"));
    while (!interrupted.empty())
        interruptedOrder.push_back(interrupted.dequeue());

    const std::string interruptedTrace = join(interruptedOrder);
    INFO("interrupted: ", interruptedTrace);

    const Order expectedInterrupted = { "batch-1", "interactive-late", "batch-2", "batch-3" };
    CHECK(interruptedOrder == expectedInterrupted);

    // The ordering follows the §2.2 priorities VALUES, not a hardcoded 0/1/2.
    const std::vector<Arrival> renumbered = {
        { "slow-batch-1", kSlowBatch, grouped("alpha") },
        { "slow-batch-2", kSlowBatch, grouped("alpha") },
        { "slow-interactive", kSlowInteractive, grouped("alpha") },
        { "slow-review", kSlowReview, grouped("beta") },
    };

    QueueModel renumberedQueue(affinityConfig(true));
    replay(renumberedQueue, renumbered);
    const Order renumberedOrder = renumberedQueue.drain();

    const std::string renumberedTrace = join(renumberedOrder);
    INFO("renumbered priorities: ", renumberedTrace);

    const Order expectedRenumbered = { "slow-interactive", "slow-review", "slow-batch-1",
                                       "slow-batch-2" };
    CHECK(renumberedOrder == expectedRenumbered);

    // Swept: at EVERY selection the chosen entry sits in the lowest class still
    // queued. This is the assertion that fails the moment contiguity is allowed
    // to outrank priority.
    std::mt19937 rng(31337u);
    for (int trial = 0; trial < 200; ++trial) {
        const std::vector<Arrival> sample =
            randomArrivals(rng, 3 + static_cast<std::size_t>(rng()) % 10);

        QueueModel swept(affinityConfig(true));
        replay(swept, sample);

        while (!swept.empty()) {
            const int lowest = swept.minQueuedPriority();
            const Queued taken = swept.dequeueEntry();
            INFO("trial ", trial, ": selected '", taken.name, "' at priority ",
                 taken.entry.priority, ", lowest queued ", lowest);
            CHECK(taken.entry.priority == lowest);
        }
    }

    // The SAME committed AdmissionController, now threading the group through:
    // admit() takes it alongside the priority and, with a free slot, still admits
    // immediately. A group tag changes ORDERING, never admission (G5).
    conductor::router::AdmissionController controller(makeConfig(1, "X-Conductor-Group", true));
    CHECK(controller.admit(kModelA, "batch", grouped("alpha")) == AdmissionOutcome::Admitted);
    CHECK(controller.inflight_count(kModelA) == 1);
    controller.release(kModelA);
    CHECK(controller.admit(kModelA, std::nullopt, kUntagged) == AdmissionOutcome::Admitted);
    CHECK(controller.inflight_count(kModelA) == 1);
    controller.release(kModelA);
    CHECK(controller.inflight_count(kModelA) == 0);
    CHECK(controller.queued_count() == 0);
}

TEST_CASE(
    "[11.5-header-from-config] the group id comes from config.affinity.header via 11.3's parsed "
    "RequestTags.group: the same arrivals group differently under a different configured header "
    "name, a request tagged only with the other name counts as untagged, and the body fallback "
    "still groups") {
    // Plain 11.4 order for this arrival sequence — one priority class, so it is
    // simply the arrival order. Both phases below must differ from it, otherwise
    // affinity did nothing at all.
    const Order plain = { "t-alpha-1", "c-alpha-1", "t-alpha-2",
                          "c-alpha-2", "body-alpha", "plain" };

    // Phase 1: the deployment renamed the header. Only X-Team-Bucket groups, so
    // the two X-Conductor-Group requests are UNTAGGED and cannot be pulled
    // forward, while the body-fallback request joins alpha.
    const Order teamOrder = dispatchOrderFor("X-Team-Bucket");
    const std::string teamTrace = join(teamOrder);
    INFO("X-Team-Bucket: ", teamTrace);

    const Order expectedTeam = { "t-alpha-1", "t-alpha-2", "body-alpha",
                                 "c-alpha-1", "c-alpha-2", "plain" };
    CHECK(teamOrder == expectedTeam);

    // Phase 2: the SAME six requests under the shipped header name. Now the
    // X-Conductor-Group pair groups and the X-Team-Bucket pair is untagged — the
    // shipped name is config data, not a constant compiled into affinity.
    const Order shippedOrder = dispatchOrderFor("X-Conductor-Group");
    const std::string shippedTrace = join(shippedOrder);
    INFO("X-Conductor-Group: ", shippedTrace);

    const Order expectedShipped = { "t-alpha-1", "c-alpha-1", "c-alpha-2",
                                    "body-alpha", "t-alpha-2", "plain" };
    CHECK(shippedOrder == expectedShipped);

    // The configured name is what decided the grouping: identical wire traffic,
    // two different dequeue orders, neither of them plain FIFO.
    CHECK(teamOrder != shippedOrder);
    CHECK(teamOrder != plain);
    CHECK(shippedOrder != plain);

    // In BOTH phases the body-fallback request grouped with alpha, which is only
    // possible if 11.5 consumed RequestTags.group rather than re-reading a header
    // of its own.
    CHECK(indexOf(teamOrder, "body-alpha") == indexOf(teamOrder, "t-alpha-2") + 1);
    CHECK(indexOf(shippedOrder, "body-alpha") == indexOf(shippedOrder, "c-alpha-2") + 1);

    // An untagged request is never advanced, under either configured name.
    const Order untaggedUnderTeam = { "c-alpha-1", "c-alpha-2", "plain" };
    for (const std::string& name : untaggedUnderTeam) {
        const std::size_t plainAt = indexOf(plain, name);
        const std::size_t affinityAt = indexOf(teamOrder, name);
        INFO("untagged '", name, "' plain=", plainAt, " affinity=", affinityAt);
        CHECK(affinityAt >= plainAt);
    }

    const Order untaggedUnderShipped = { "t-alpha-1", "t-alpha-2", "plain" };
    for (const std::string& name : untaggedUnderShipped) {
        const std::size_t plainAt = indexOf(plain, name);
        const std::size_t affinityAt = indexOf(shippedOrder, name);
        INFO("untagged '", name, "' plain=", plainAt, " affinity=", affinityAt);
        CHECK(affinityAt >= plainAt);
    }
}

TEST_CASE(
    "[11.5-toggle-off-plain-order] affinity.contiguousDequeue:false disables the reordering "
    "ENTIRELY: for the same arrivals the dequeue order is exactly plain 11.4 priority+FIFO, "
    "grouped and untagged alike") {
    const std::vector<std::vector<Arrival>> sequences = {
        mixedArrivals(),
        {
            { "a-1", kInteractive, grouped("alpha") },
            { "b-1", kInteractive, grouped("beta") },
            { "a-2", kInteractive, grouped("alpha") },
            { "b-2", kInteractive, grouped("beta") },
            { "untagged", kInteractive, kUntagged },
            { "a-3", kInteractive, grouped("alpha") },
        },
        {
            { "u-1", kInteractive, kUntagged },
            { "a-1", kInteractive, grouped("alpha") },
            { "u-2", kInteractive, kUntagged },
            { "a-2", kBatch, grouped("alpha") },
            { "b-1", kReview, grouped("beta") },
            { "u-3", kInteractive, kUntagged },
            { "a-3", kInteractive, grouped("alpha") },
        },
    };

    for (std::size_t index = 0; index < sequences.size(); ++index) {
        const std::vector<Arrival>& arrivals = sequences[index];

        QueueModel off(affinityConfig(false));
        replay(off, arrivals);
        const Order plain = off.plainOrder();
        const Order offOrder = off.drain();

        QueueModel on(affinityConfig(true));
        replay(on, arrivals);
        const Order onOrder = on.drain();

        const std::string offTrace = join(offOrder);
        const std::string plainTrace = join(plain);
        const std::string onTrace = join(onOrder);
        INFO("sequence ", index, " off:   ", offTrace);
        INFO("sequence ", index, " plain: ", plainTrace);
        INFO("sequence ", index, " on:    ", onTrace);

        CHECK(offOrder == plain);
        // Not vacuous: with the toggle ON these very sequences DO get reordered,
        // so "identical to plain" is a property of the toggle, not of the input.
        CHECK(onOrder != plain);
    }

    // Swept over deterministic sequences: with the toggle off, affinity is inert
    // for EVERY arrival sequence, whatever the mix of groups and classes.
    std::mt19937 rng(4242u);
    for (int trial = 0; trial < 200; ++trial) {
        const std::vector<Arrival> sample =
            randomArrivals(rng, 3 + static_cast<std::size_t>(rng()) % 10);

        QueueModel off(affinityConfig(false));
        replay(off, sample);
        const Order plain = off.plainOrder();
        const Order offOrder = off.drain();

        const std::string offTrace = join(offOrder);
        const std::string plainTrace = join(plain);
        INFO("trial ", trial, " off:   ", offTrace);
        INFO("trial ", trial, " plain: ", plainTrace);
        CHECK(offOrder == plain);
    }
}
