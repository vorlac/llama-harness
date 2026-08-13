// =============================================================================
// Task 11.4 — llama-router `admission`: per-model caps, priority queueing and
// the queue-timeout / queue-overflow 503s.
//
// The §4.4 admission slice. One mutex + one condition variable per waiter guard
// a per-model in-flight counter table and a single priority-ordered queue, both
// driven by the ALREADY-PARSED §2.2 admission + priorities blocks — no config
// file is re-read and no X-Conductor-* header is re-parsed here (11.3's
// RequestTags is the one tag seam).
//
// G5 fail-soft still governs: admission never rejects a request for what it
// says. An untagged priority, a priority outside interactive|review|batch and a
// body with no usable `model` field are all admitted normally (the last under
// the reserved empty-string counter key); the only two refusals are capacity
// ones — a wait longer than admission.queueTimeoutMs and a queue already
// holding admission.maxQueued entries.
//
// Which of the queued entries a freed slot goes to is Task 11.5's call:
// grantNext projects the queue for one model into AffinityEntry values and asks
// affinity.hpp's AffinityPolicy for an index, under this module's existing
// mutex. Strict priority is unchanged by that — the policy only reorders within
// the highest-priority class still queued.
//
// Header-only, matching Task 11.2's config.hpp and Task 11.3's router.hpp.
// =============================================================================

#pragma once

#include <spdlog/spdlog.h>

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "router/affinity.hpp"
#include "router/config.hpp"

namespace conductor::router {

    // SG-5: the minimal health route 11.4 owns, registered outside admission so
    // it answers while every slot and queue entry is held. Task 11.7 extends the
    // BODY on this same route without changing that property.
    inline constexpr const char* kHealthPath = "/conductor/health";

    // SG-1's pinned 503 envelope, the OpenAI-compatible shape llama-server itself
    // emits: {"error":{"message":…,"type":"unavailable_error",
    //                  "code":"queue_timeout"|"queue_overflow"}}.
    inline constexpr const char* kAdmissionErrorType = "unavailable_error";
    inline constexpr const char* kQueueTimeoutCode = "queue_timeout";
    inline constexpr const char* kQueueOverflowCode = "queue_overflow";

    // SG-2's fixed thread budget and the +8 margin of the plan's
    // threads >= maxQueued + sum(maxInflightPerModel) + 8. The values live in
    // config.hpp because the maxQueued clamp is part of that module's validation
    // path and config.hpp cannot depend on this header; these are the names the
    // admission surface publishes them under.
    inline constexpr int kAdmissionThreadBudget = detail::kAdmissionThreadBudget;
    inline constexpr int kTaskQueueThreadMargin = detail::kTaskQueueThreadMargin;

    enum class AdmissionOutcome {
        Admitted,
        TimedOut,
        Overflowed
    };

    /**
     * Per-model concurrency caps with one priority-ordered wait queue.
     *
     * admit() BLOCKS its caller — an httplib handler thread — while the model is
     * at admission.maxInflightPerModel, which is why the listener's task queue is
     * sized from computeTaskQueueThreads() rather than left at httplib's default.
     * It returns Admitted as soon as a slot is claimed, TimedOut when the entry
     * waited longer than admission.queueTimeoutMs, and Overflowed immediately —
     * never after a wait — when the queue already holds admission.maxQueued
     * entries.
     *
     * @param model the request body's `model` field; an absent or unusable one
     *        buckets under the reserved empty-string key (SG-3).
     * @param priority 11.3's RequestTags.priority verbatim. An empty optional and
     *        any value outside interactive|review|batch (SG-4) both order as
     *        interactive. Ordering is by the §2.2 priorities VALUE, lower first,
     *        FIFO within a class.
     * @param group 11.3's RequestTags.group verbatim, carried to the queue so
     *        Task 11.5's AffinityPolicy can order same-group entries
     *        contiguously WITHIN a class. G5 still governs: a group tag can only
     *        move an entry later in its class, never turn it into a refusal and
     *        never delay it past what the capacity rules above already do.
     */
    class AdmissionController {
    public:
        explicit AdmissionController(const RouterConfig& config)
            : maxInflightPerModel_(config.admission.maxInflightPerModel)
            , maxQueued_(config.admission.maxQueued < 0
                             ? 0u
                             : static_cast<std::size_t>(config.admission.maxQueued))
            , queueTimeout_(config.admission.queueTimeoutMs)
            , priorities_(config.priorities)
            , affinity_(config.affinity) {
        }

        AdmissionController(const AdmissionController&) = delete;
        AdmissionController& operator=(const AdmissionController&) = delete;

        // An omitted `group` is an untagged request: it queues by priority and
        // arrival alone, which is the whole of the ordering when no caller tags
        // anything.
        AdmissionOutcome admit(const std::string& model, const std::optional<std::string>& priority,
                               const std::optional<std::string>& group = std::nullopt) {
            std::unique_lock<std::mutex> lock(mutex_);

            if (hasFreeSlot(model)) {
                ++inflight_[model];
                return AdmissionOutcome::Admitted;
            }

            if (queue_.size() >= maxQueued_)
                return AdmissionOutcome::Overflowed;

            // The waiter lives on this blocked thread's stack: it is reachable
            // from the queue for exactly as long as this call is parked on it, and
            // every field is read and written under mutex_.
            Waiter waiter{ model, group };
            const QueueKey key{ priorityValue(priority), nextSequence_++ };
            queue_.emplace(key, &waiter);

            const auto deadline = std::chrono::steady_clock::now() + queueTimeout_;
            waiter.woken.wait_until(
                lock, deadline,
                [&waiter] {
                    return waiter.granted;
                });

            // A grant that landed while this thread was waking still counts: the
            // releaser holds mutex_ for the whole grant, so the predicate above is
            // evaluated after it, never across it.
            if (waiter.granted)
                return AdmissionOutcome::Admitted;

            // The timed-out entry removes ITSELF, leaving no hole for the next
            // release to trip over.
            queue_.erase(key);
            return AdmissionOutcome::TimedOut;
        }

        // Returns one in-flight slot and hands it straight to the entry Task
        // 11.5's affinity policy picks out of the highest-priority class waiting
        // on the same model, so a freed slot can never be claimed out of order by
        // an arrival that came later.
        void release(const std::string& model) {
            const std::lock_guard<std::mutex> lock(mutex_);
            const auto counted = inflight_.find(model);
            if (counted != inflight_.end() && counted->second > 0) {
                if (--counted->second == 0)
                    inflight_.erase(counted);
            }

            grantNext(model);
        }

        [[nodiscard]] std::size_t queued_count() const {
            const std::lock_guard<std::mutex> lock(mutex_);
            return queue_.size();
        }

        [[nodiscard]] std::size_t inflight_count(const std::string& model) const {
            const std::lock_guard<std::mutex> lock(mutex_);
            const auto counted = inflight_.find(model);
            return counted == inflight_.end() ? 0u : counted->second;
        }

    private:
        struct Waiter {
            std::string model;
            // 11.3's RequestTags.group, parked here so grantNext can ask the
            // affinity policy about this entry without a second tag seam.
            std::optional<std::string> group;
            std::condition_variable woken;
            bool granted{ false };
        };

        // Priority value first, arrival sequence second: that IS the dequeue
        // order, so std::map's ordering does the queueing.
        using QueueKey = std::pair<int, std::uint64_t>;
        using QueueMap = std::map<QueueKey, Waiter*>;

        [[nodiscard]] std::size_t inflightFor(const std::string& model) const {
            const auto counted = inflight_.find(model);
            return counted == inflight_.end() ? 0u : counted->second;
        }

        // A slot is free only when nothing is already waiting for this model:
        // release() grants to the queue head, and an arrival must not overtake it.
        [[nodiscard]] bool hasFreeSlot(const std::string& model) const {
            if (maxInflightPerModel_ <= 0)
                return false;

            if (inflightFor(model) >= static_cast<std::size_t>(maxInflightPerModel_))
                return false;

            for (const auto& [key, waiter] : queue_) {
                if (waiter->model == model)
                    return false;
            }

            return true;
        }

        void grantNext(const std::string& model) {
            if (maxInflightPerModel_ <= 0)
                return;

            if (inflightFor(model) >= static_cast<std::size_t>(maxInflightPerModel_))
                return;

            // The affinity policy PROJECTS this queue, it does not duplicate it:
            // one pass turns this model's slice of queue_ into what the policy
            // reads, under the mutex this call already holds. The parallel
            // iterator vector is how the chosen index gets back to its waiter.
            std::vector<AffinityEntry> entries;
            std::vector<QueueMap::iterator> waiting;
            for (auto entry = queue_.begin(); entry != queue_.end(); ++entry) {
                if (entry->second->model != model)
                    continue;

                entries.push_back(
                    AffinityEntry{ entry->first.first, entry->second->group, entry->first.second });
                waiting.push_back(entry);
            }

            if (entries.empty()) {
                policies_.erase(model);
                return;
            }

            const std::optional<std::size_t> chosen = policyFor(model).selectNext(entries);
            if (!chosen)
                return;

            const QueueMap::iterator selected = waiting[*chosen];
            Waiter* const waiter = selected->second;
            queue_.erase(selected);
            waiter->granted = true;
            ++inflight_[model];
            waiter->woken.notify_one();

            // A model with nothing left queued carries no burst worth keeping:
            // every later arrival gets an ordinal past the burst's ceiling, so a
            // restart is what the policy would decide anyway. Dropping the entry
            // bounds this table by the models actually waiting.
            if (entries.size() == 1)
                policies_.erase(model);
        }

        // One policy per counter key, so two models can never share a burst.
        [[nodiscard]] AffinityPolicy& policyFor(const std::string& model) {
            return policies_.try_emplace(model, affinity_).first->second;
        }

        // SG-4: an unrecognized tag is not an error, it is an interactive
        // request. The §2.2 priorities block stays three keys.
        [[nodiscard]] int priorityValue(const std::optional<std::string>& priority) const {
            if (!priority)
                return priorities_.interactive;
            if (*priority == "interactive")
                return priorities_.interactive;
            if (*priority == "review")
                return priorities_.review;
            if (*priority == "batch")
                return priorities_.batch;

            spdlog::debug(
                "router: priority tag '{}' is outside interactive|review|batch — queued as interactive",
                *priority);

            return priorities_.interactive;
        }

        const int maxInflightPerModel_;
        const std::size_t maxQueued_;
        const std::chrono::milliseconds queueTimeout_;
        const Priorities priorities_;
        const Affinity affinity_;

        mutable std::mutex mutex_;
        std::unordered_map<std::string, std::size_t> inflight_;
        QueueMap queue_;
        // Guarded by mutex_ like every other queue state: the policy is consulted
        // only from grantNext, which is only ever reached holding it.
        std::map<std::string, AffinityPolicy> policies_;
        std::uint64_t nextSequence_{ 0 };
    };

    // The plan's startup arithmetic, consumed BOTH by Router::start() (the
    // listener's new_task_queue) and by the maxQueued clamp in 11.2's validation
    // path: maxQueued + sum(maxInflightPerModel) + kTaskQueueThreadMargin.
    [[nodiscard]] inline int computeTaskQueueThreads(const RouterConfig& config) {
        return detail::taskQueueThreadsFor(config.admission);
    }

    // Owns ONE admitted slot for as long as the request that claimed it is being
    // served. The Router keeps it in a shared_ptr that the streaming relay's
    // content provider also captures, so the slot is returned when the LAST
    // holder goes away — the buffered return, the streamed one, an upstream
    // failure and a thrown exception all release exactly once.
    class AdmissionSlot {
    public:
        AdmissionSlot(AdmissionController& controller, std::string model)
            : controller_(controller)
            , model_(std::move(model)) {
        }

        ~AdmissionSlot() {
            controller_.release(model_);
        }

        AdmissionSlot(const AdmissionSlot&) = delete;
        AdmissionSlot& operator=(const AdmissionSlot&) = delete;

    private:
        AdmissionController& controller_;
        std::string model_;
    };

}  // namespace conductor::router
