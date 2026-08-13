// =============================================================================
// Task 11.5 — llama-router `affinity`: prefix-group contiguous dequeue.
//
// The §1.1 dequeue-ordering policy that Task 11.4's committed
// AdmissionController consults at grant time. It is a POLICY, never a second
// queue and never a second lock: no mutex, no thread, no clock, no I/O and no
// config file of its own. The parsed §2.2 affinity block arrives from the
// controller, the queued entries arrive from the controller's queue, and the
// next choice is a function of those two plus the burst this object carries
// between calls. That purity is what lets the ordering law be tested without a
// thread or a fake clock.
//
// The group VALUE is 11.3's already-normalized RequestTags.group, read there
// with the CONFIGURED header name (Router::groupHeader_) or the x_conductor
// body fallback. Affinity re-reads no header and introduces no second
// precedence rule.
//
// The ordering law, as resolved in docs/build/specs/task-11.5.assertions.json:
//   1. strict priority is the OUTER order. Only entries at the MINIMUM priority
//      value present are ever eligible, so 11.4's interactive < review < batch
//      survives verbatim and a higher-class arrival mid-drain wins the next
//      dequeue even when it breaks a group's run;
//   2. affinity.contiguousDequeue == false makes this class fully INERT — the
//      selection is the plain 11.4 (priority, arrival) head, for every arrival
//      sequence;
//   3. otherwise, while a burst is active in the eligible class, the
//      lowest-arrival member of the burst's group that was QUEUED AT SELECTION
//      TIME is chosen. Membership needs no clock and no extra parameter: the
//      arrival ordinal is assigned under the controller's queue lock and only
//      ever grows, so "queued when the burst started" is exactly "arrival at or
//      below the highest ordinal the burst saw". Members arriving mid-drain are
//      therefore outside the burst and wait for the group's NEXT turn, which is
//      what stops a busy group from starving its neighbours;
//   4. otherwise a new burst starts at the eligible class's oldest-waiting
//      head. An untagged head starts no burst, so affinity can push an untagged
//      request back but can never pull one forward.
//
// Swap batching (G13) is not built here: one model, no swaps, so there is
// nothing to batch and no clock to batch against.
//
// Header-only, matching Task 11.2's config.hpp, 11.3's router.hpp and 11.4's
// admission.hpp.
// =============================================================================

#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "router/config.hpp"

namespace conductor::router {

    // ONE queued request as the dequeue policy sees it. Nothing else about the
    // request is policy input: no model, no clock, no header.
    struct AffinityEntry {
        // 11.4's priority VALUE (the §2.2 priorities block), lower dequeues
        // first. Never the tag string — affinity does not re-derive a class.
        int priority{};
        // 11.3's RequestTags.group verbatim; an empty optional is untagged.
        std::optional<std::string> group;
        // The arrival ordinal 11.4 assigns under its queue lock (QueueKey's
        // second element). Ties break on this, never on wall-clock time, and
        // only its RELATIVE order is ever read.
        std::uint64_t arrival{};
    };

    /**
     * The §1.1 prefix-group contiguous dequeue policy.
     *
     * @param config the parsed §2.2 affinity block. Only contiguousDequeue is
     *        policy input; the header NAME was already consumed by 11.3 when it
     *        produced RequestTags.group.
     */
    class AffinityPolicy {
    public:
        explicit AffinityPolicy(const Affinity& config)
            : contiguous_(config.contiguousDequeue) {
        }

        // Index into `entries` of the request to grant next, or nullopt when
        // `entries` is empty. Advances the burst, so it is called exactly once
        // per grant.
        [[nodiscard]] std::optional<std::size_t> selectNext(const std::vector<AffinityEntry>& entries) {
            if (entries.empty())
                return std::nullopt;

            // Strict priority is the outer order, so the eligible set is fixed
            // before contiguity is consulted at all. Every return below picks
            // from this class and no other.
            const int eligible = lowestPriority(entries);

            // The toggle is inert by construction rather than by a special case
            // downstream: this IS plain 11.4 priority+FIFO, and no burst is
            // started or read, so nothing can leak into a later call.
            if (!contiguous_)
                return oldestInClass(entries, eligible);

            // A burst belongs to the class it started in. When a higher class is
            // queued the burst is not eligible, and the entry chosen below
            // starts a fresh one; the interrupted group resumes on its own terms
            // once the higher class clears.
            if (burst_ && burst_->priority == eligible) {
                const std::optional<std::size_t> member = oldestBurstMember(entries, eligible);
                if (member)
                    return member;
            }

            const std::size_t head = oldestInClass(entries, eligible);
            const AffinityEntry& chosen = entries[head];
            if (chosen.group) {
                // The ceiling is read once, here, from the queue as it stands at
                // SELECTION time. Every later arrival carries a strictly greater
                // ordinal, so it falls outside this burst without the policy
                // having to observe the arrival at all.
                burst_ = Burst{ eligible, *chosen.group, highestArrival(entries) };
            }
            else {
                // An untagged head is not a group, so it opens no run: the next
                // call starts over at whatever is then oldest.
                burst_.reset();
            }

            return head;
        }

    private:
        // The group currently draining, and how far into the queue its run
        // reaches.
        struct Burst {
            int priority{};
            std::string group;
            // Highest arrival ordinal queued when the burst started. Members at
            // or below it are the burst; anything above it arrived mid-drain.
            std::uint64_t queuedThrough{};
        };

        [[nodiscard]] static int lowestPriority(const std::vector<AffinityEntry>& entries) {
            int lowest = entries.front().priority;
            for (const AffinityEntry& entry : entries)
                lowest = std::min(lowest, entry.priority);

            return lowest;
        }

        [[nodiscard]] static std::uint64_t highestArrival(const std::vector<AffinityEntry>& entries) {
            std::uint64_t highest = entries.front().arrival;
            for (const AffinityEntry& entry : entries)
                highest = std::max(highest, entry.arrival);

            return highest;
        }

        // The class's oldest-waiting head. Compared on the arrival ordinal and
        // never on the vector's storage position, so the caller may hand the
        // entries over in any order and get the same answer.
        [[nodiscard]] static std::size_t oldestInClass(const std::vector<AffinityEntry>& entries, int priority) {
            std::size_t oldest = entries.size();
            for (std::size_t index = 0; index < entries.size(); ++index) {
                if (entries[index].priority != priority)
                    continue;

                if (oldest == entries.size() || entries[index].arrival < entries[oldest].arrival)
                    oldest = index;
            }

            // `priority` was derived from these entries, so at least one matches.
            return oldest;
        }

        [[nodiscard]] std::optional<std::size_t> oldestBurstMember(const std::vector<AffinityEntry>& entries, int priority) const {
            std::optional<std::size_t> oldest;
            for (std::size_t index = 0; index < entries.size(); ++index) {
                const AffinityEntry& entry = entries[index];
                if (entry.priority != priority)
                    continue;

                if (!entry.group || *entry.group != burst_->group)
                    continue;

                // Queued after the burst began: it waits for the group's next
                // turn instead of extending this one.
                if (entry.arrival > burst_->queuedThrough)
                    continue;

                if (!oldest || entry.arrival < entries[*oldest].arrival)
                    oldest = index;
            }

            return oldest;
        }

        bool contiguous_;
        std::optional<Burst> burst_;
    };

}  // namespace conductor::router
