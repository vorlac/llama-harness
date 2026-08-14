// =============================================================================
// Task 15.2 — `conductor-dashboard`: the pure ledger-aggregation layer behind
// the ftxui TUI that tails the §4.4 metrics ledger.
//
// Everything here is a transform of values handed to it. No file is opened, no
// clock is read, no global is touched and nothing is logged — dashboard/main.cpp
// owns all of that. The split is what lets router/tests/dashboard_test.cpp reach
// every one of these functions from the EXISTING, ftxui-free `router-tests`
// target while the dashboard binary itself stays an OFF-by-default build
// (spec SG-H, row 15.2-header-purity). The single non-std dependency permitted
// here is nlohmann/json, which both committed targets already link.
//
// WHAT THIS READS. router/metrics.hpp's MetricsLedger::appendLine writes one
// `<compact json>\n` per COMPLETED request, flushed per line, append-only. Its
// toJson sets twelve keys; this reader takes eleven of them and ignores
// `timings`, which no pane displays. Unknown keys are ignored too, so a later
// field added to the writer cannot break the viewer. Only `status` is
// load-bearing: a line without a numeric one is not a request record and is
// refused. Absence and JSON null are the same thing to every optional column.
//
// queueWaitMs is OPTIONAL here even though the committed writer declares it a
// non-optional std::int64_t and therefore always emits a number. The reader is
// defensive by design (G5 applied to the reader); a 0 decodes ENGAGED, because
// 0 is a real sample meaning "admitted promptly" and dropping it would empty
// the percentile input of every request that never queued.
//
// WHAT IS CUMULATIVE AND WHAT IS WINDOWED (spec SG-C). Counts and sums are
// cumulative over every record fed since construction or the last restart().
// The percentiles, the lanes and the affinity summary are computed over a
// BOUNDED RECENT WINDOW so a viewer meant to run all day keeps flat memory —
// which is also why the dashboard's p50/p95 are recent-window percentiles and
// may legitimately differ from GET /conductor/metrics, the authority for
// whole-run percentiles. The window size is a constructor parameter, never a
// config key and never a CLI flag (SG-J).
//
// WHAT THE LANES PANE IS (spec SG-A). The ledger records completions only and
// /conductor/metrics publishes no live gauge, so instantaneous in-flight depth
// is not observable by any consumer. The lanes are therefore RECENT COMPLETIONS
// PER GROUP over the retained window, each carrying completed / queued / shed
// and a lane-local wait p95. That is the question the pane exists to answer —
// is this group backing up, and is it being shed — and every input is already
// on the line. It is not a live gauge and is never labelled as one.
//
// Header-only, matching router/config.hpp / metrics.hpp / affinity.hpp.
// =============================================================================

#pragma once

#include <nlohmann/json.hpp>

#include <algorithm>
#include <charconv>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <format>
#include <limits>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace conductor::dashboard {

    // The retained-window default (SG-C) and the tail's carry ceiling: one
    // unterminated garbage blob can never grow the process past this.
    inline constexpr std::size_t kDefaultWindowSize = 200;
    inline constexpr std::size_t kDefaultMaxCarryBytes = 1024 * 1024;

    /**
     * ONE ledger line as the dashboard reads it: router/metrics.hpp's
     * RequestRecord minus `timings`. Every column but `status` is optional or
     * defaulted, because a line that lost a field must still decode rather than
     * taking the whole pane down with it.
     */
    struct LedgerRecord {
        std::string model;
        std::optional<std::string> role;
        std::optional<std::string> group;
        std::string priority;
        std::optional<std::int64_t> queueWaitMs;
        std::optional<std::int64_t> upstreamMs;
        std::optional<std::int64_t> promptTokens;
        std::optional<std::int64_t> completionTokens;
        std::optional<bool> schemaMissing;
        std::optional<bool> schemaConformed;
        int status{ 0 };

        friend bool operator==(const LedgerRecord&, const LedgerRecord&) = default;
    };

    namespace detail {

        // A key that is absent, null, or of the wrong JSON type reads as "not
        // observed" rather than as a rejection — the same tolerance that makes
        // an added writer field non-breaking here.
        [[nodiscard]] inline std::optional<std::string> optionalString(const nlohmann::json& object, const char* key) {
            const auto found = object.find(key);
            if (found == object.end() || !found->is_string())
                return std::nullopt;

            return found->get<std::string>();
        }

        [[nodiscard]] inline std::optional<std::int64_t> optionalInteger(const nlohmann::json& object, const char* key) {
            const auto found = object.find(key);
            if (found == object.end() || !found->is_number_integer())
                return std::nullopt;

            return found->get<std::int64_t>();
        }

        [[nodiscard]] inline std::optional<bool> optionalBoolean(const nlohmann::json& object, const char* key) {
            const auto found = object.find(key);
            if (found == object.end() || !found->is_boolean())
                return std::nullopt;

            return found->get<bool>();
        }

        // NEAREST-RANK, byte-identical in rule to MetricsLedger::percentile
        // (router/metrics.hpp): N > 0 sorted ascending 1-indexed, rank
        // ceil(percent/100 * N) in exact integer arithmetic; 0 when N == 0. The
        // TUI and the endpoint must never quote two different numbers for the
        // same word, which starts with computing them the same way.
        [[nodiscard]] inline std::int64_t nearestRank(std::vector<std::int64_t> samples, std::size_t percent) {
            if (samples.empty())
                return 0;

            std::sort(samples.begin(), samples.end());

            const std::size_t rank = (percent * samples.size() + 99) / 100;
            return samples[rank == 0 ? 0 : rank - 1];
        }

        // A whole decimal integer, or nothing. Used to order the status-count
        // pairs numerically: the keys are decimal strings, so a lexicographic
        // walk of the map would print "1000" before "200".
        [[nodiscard]] inline std::optional<std::int64_t> decimalValue(std::string_view text) {
            std::int64_t value = 0;
            const char* const first = text.data();
            const char* const last = first + text.size();
            const std::from_chars_result parsed = std::from_chars(first, last, value);
            if (parsed.ec != std::errc{} || parsed.ptr != last)
                return std::nullopt;

            return value;
        }

        // A line of nothing but whitespace is not corruption — the writer never
        // emits one, but a partially-flushed tail or an editor can leave one.
        [[nodiscard]] inline bool isBlank(std::string_view text) {
            return std::ranges::all_of(text, [](const char ch) {
                return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' || ch == '\v' || ch == '\f';
            });
        }

    }  // namespace detail

    // Pure, non-throwing decode of ONE ledger line. std::nullopt is the only
    // failure channel: an empty or whitespace-only line, a half-written line
    // that is not valid JSON, valid JSON that is not an object, an object with
    // no `status`, and an object whose `status` is not a number all yield
    // nothing rather than a partially-filled record. `timings` and every
    // unknown key are ignored.
    [[nodiscard]] inline std::optional<LedgerRecord> parseLedgerLine(std::string_view line) {
        const nlohmann::json document = nlohmann::json::parse(line.begin(), line.end(), nullptr, false);
        if (!document.is_object())
            return std::nullopt;

        const auto status = document.find("status");
        if (status == document.end() || !status->is_number_integer())
            return std::nullopt;

        LedgerRecord entry;
        entry.model = detail::optionalString(document, "model").value_or(std::string{});
        entry.role = detail::optionalString(document, "role");
        entry.group = detail::optionalString(document, "group");
        entry.priority = detail::optionalString(document, "priority").value_or(std::string{});
        entry.queueWaitMs = detail::optionalInteger(document, "queueWaitMs");
        entry.upstreamMs = detail::optionalInteger(document, "upstreamMs");
        entry.promptTokens = detail::optionalInteger(document, "promptTokens");
        entry.completionTokens = detail::optionalInteger(document, "completionTokens");
        entry.schemaMissing = detail::optionalBoolean(document, "schemaMissing");
        entry.schemaConformed = detail::optionalBoolean(document, "schemaConformed");
        entry.status = static_cast<int>(status->get<std::int64_t>());
        return entry;
    }

    struct TailStep {
        std::uint64_t offset{ 0 };
        bool restart{ false };

        friend bool operator==(const TailStep&, const TailStep&) = default;
    };

    // The follow position, as a pure function: the one step of the tail loop
    // that can lose or duplicate data is testable without a filesystem. An
    // append reads forward from where the last read stopped; an unchanged size
    // re-reads nothing, so no record is ever counted twice; a SHRUNKEN file was
    // replaced by a new run, so the whole file is re-read from byte 0 and the
    // caller is told to restart its counters.
    [[nodiscard]] inline TailStep nextRead(std::uint64_t consumedOffset, std::uint64_t currentSize) noexcept {
        if (currentSize < consumedOffset)
            return TailStep{ 0, true };

        return TailStep{ consumedOffset, false };
    }

    /**
     * Arbitrarily-chunked bytes in, whole records out. A live router appends to
     * the ledger while this reads it, so a read can land mid-line: a record is
     * emitted ONLY for a line terminated by '\n', and the unterminated
     * remainder is carried to the next chunk. Records always come out in file
     * order, and any chunking of the same byte sequence emits the same records
     * as consuming it whole.
     *
     * G5 applied to the reader: a complete line that fails to decode is skipped
     * and counted while the good lines around it still emit, blank lines are
     * skipped without counting (they are not corruption), and consume() never
     * throws for any bytes at all.
     */
    class LedgerTail {
    public:
        explicit LedgerTail(std::size_t maxCarryBytes = kDefaultMaxCarryBytes)
            : maxCarryBytes_(maxCarryBytes) {
        }

        [[nodiscard]] std::vector<LedgerRecord> consume(std::string_view chunk) {
            std::vector<LedgerRecord> records;

            while (!chunk.empty()) {
                const std::size_t newline = chunk.find('\n');
                if (newline == std::string_view::npos)
                    break;

                const std::string_view line = chunk.substr(0, newline);
                chunk.remove_prefix(newline + 1);

                if (dropping_) {
                    // The tail of a blob already dropped and already counted
                    // when it passed the carry ceiling. It ends here.
                    dropping_ = false;
                    continue;
                }

                if (carry_.empty()) {
                    admit(line, records);
                }
                else {
                    carry_.append(line);
                    admit(carry_, records);
                    carry_.clear();
                }
            }

            if (chunk.empty() || dropping_)
                return records;

            carry_.append(chunk);
            if (carry_.size() > maxCarryBytes_) {
                // One unterminated blob must not grow the process without
                // bound. Everything up to the next newline goes with it, as a
                // single drop and a single count.
                carry_.clear();
                dropping_ = true;
                ++skipped_;
            }

            return records;
        }

        // Complete lines that could not be decoded. Blank lines never count.
        [[nodiscard]] std::uint64_t skipped() const noexcept {
            return skipped_;
        }

        // Discards any carried partial — what the follow loop calls when the
        // file it was reading has been replaced. The skipped count is history
        // and survives.
        void reset() {
            carry_.clear();
            dropping_ = false;
        }

    private:
        void admit(std::string_view line, std::vector<LedgerRecord>& records) {
            // A CRLF-terminated line must decode identically to a bare LF one.
            if (!line.empty() && line.back() == '\r')
                line.remove_suffix(1);

            if (detail::isBlank(line))
                return;

            std::optional<LedgerRecord> parsed = parseLedgerLine(line);
            if (!parsed) {
                ++skipped_;
                return;
            }

            records.push_back(std::move(*parsed));
        }

        std::size_t maxCarryBytes_;
        std::string carry_;
        std::uint64_t skipped_{ 0 };
        bool dropping_{ false };
    };

    // SG-A's lanes pane: recent completions per group over the retained window.
    // NOT a live gauge, and never labelled as one.
    struct Lane {
        std::string group;            // "" is the untagged lane
        std::int64_t completed{ 0 };  // records in the window carrying this group
        std::int64_t queued{ 0 };     // of those, the ones whose queueWaitMs > 0
        std::int64_t shed{ 0 };       // of those, the ones whose status is 503
        std::int64_t waitMsP95{ 0 };  // nearest-rank over this lane's samples

        friend bool operator==(const Lane&, const Lane&) = default;
    };

    // SG-G's group-affinity marker, defined over LEDGER order and named for
    // what it measures: adjacent same-group records as OBSERVED. AffinityPolicy
    // produces runs of adjacent same-group GRANTS, but the ledger is written in
    // response-completion order, and under concurrency completions can reorder
    // relative to grants. This is a faithful proxy that becomes exact for a
    // serialised stream and degrades gracefully under concurrency.
    struct AffinitySummary {
        std::int64_t taggedRequests{ 0 };
        std::int64_t runs{ 0 };
        std::int64_t longestRun{ 0 };
        std::int64_t contiguousFollowers{ 0 };
        std::optional<double> hitRate;

        friend bool operator==(const AffinitySummary&, const AffinitySummary&) = default;
    };

    // The first six names are byte-identical to the /conductor/metrics
    // aggregate and to the committed conductor/adapter/router-client.ts
    // MetricsSummary, so the TUI and the endpoint can never quote two different
    // numbers for one word.
    struct LedgerAggregate {
        std::int64_t totalRequests{ 0 };
        std::int64_t schemaMissing{ 0 };
        std::int64_t schemaConformed{ 0 };
        std::map<std::string, std::int64_t> statusCounts;  // decimal status as a string
        std::int64_t promptTokens{ 0 };
        std::int64_t completionTokens{ 0 };
        std::int64_t waitMsP50{ 0 };                              // WINDOWED, per SG-C
        std::int64_t waitMsP95{ 0 };                              // WINDOWED, per SG-C
        std::optional<double> schemaConformanceRate;
        std::optional<double> completionTokensPerUpstreamSecond;  // SG-B

        friend bool operator==(const LedgerAggregate&, const LedgerAggregate&) = default;
    };

    /**
     * The fold behind every pane. Counts and sums are cumulative since
     * construction or the last restart(); the percentiles, the lanes and the
     * affinity summary are computed over the bounded recent window. Folding is
     * chunk-independent by construction: record() over one entry and record()
     * over a batch do the same arithmetic in the same order, so however the
     * tail happened to chunk the file, the aggregates agree.
     */
    class LedgerView {
    public:
        explicit LedgerView(std::size_t windowSize = kDefaultWindowSize)
            : windowSize_(windowSize) {
        }

        void record(const LedgerRecord& entry) {
            ++totalRequests_;
            ++statusCounts_[entry.status];

            if (entry.promptTokens)
                promptTokens_ += *entry.promptTokens;

            if (entry.completionTokens)
                completionTokens_ += *entry.completionTokens;

            if (entry.schemaMissing && *entry.schemaMissing)
                ++schemaMissingTrue_;

            if (entry.schemaConformed) {
                ++schemaVerdicts_;
                if (*entry.schemaConformed)
                    ++schemaConformedTrue_;
            }

            // A record missing either half feeds NEITHER side of the
            // throughput ratio, so a shed 503 with null tokens and null
            // upstream time never depresses the figure.
            if (entry.completionTokens && entry.upstreamMs) {
                pairedCompletionTokens_ += *entry.completionTokens;
                pairedUpstreamMs_ += *entry.upstreamMs;
            }

            window_.push_back(entry);
            while (window_.size() > windowSize_)
                window_.pop_front();
        }

        void record(const std::vector<LedgerRecord>& entries) {
            for (const LedgerRecord& entry : entries)
                record(entry);
        }

        // The constructed state again. A router restart that replaced the
        // ledger produces a reading for the NEW run, never a total spanning two
        // files. Idempotent, and legal on a never-recorded view.
        void restart() {
            totalRequests_ = 0;
            schemaMissingTrue_ = 0;
            schemaConformedTrue_ = 0;
            schemaVerdicts_ = 0;
            promptTokens_ = 0;
            completionTokens_ = 0;
            pairedCompletionTokens_ = 0;
            pairedUpstreamMs_ = 0;
            statusCounts_.clear();
            window_.clear();
        }

        [[nodiscard]] LedgerAggregate aggregate() const {
            LedgerAggregate out;
            out.totalRequests = totalRequests_;
            out.schemaMissing = schemaMissingTrue_;
            out.schemaConformed = schemaConformedTrue_;

            // No key exists merely because a status could have happened.
            for (const auto& [status, count] : statusCounts_)
                out.statusCounts.emplace(std::to_string(status), count);

            out.promptTokens = promptTokens_;
            out.completionTokens = completionTokens_;

            std::vector<std::int64_t> waits = windowWaits();
            out.waitMsP50 = detail::nearestRank(waits, 50);
            out.waitMsP95 = detail::nearestRank(std::move(waits), 95);

            // Zero verdicts exist: disengaged, which a 0.0 would misreport as
            // "nothing ever conformed".
            if (schemaVerdicts_ > 0) {
                out.schemaConformanceRate =
                    static_cast<double>(schemaConformedTrue_) / static_cast<double>(schemaVerdicts_);
            }

            // SG-B: generation throughput per SECOND OF UPSTREAM TIME, the
            // number the line actually supports. Not wall-clock requests per
            // second — the ledger carries no time of day, and a clock owned by
            // the viewer would make the answer depend on when someone looked.
            if (pairedUpstreamMs_ > 0) {
                out.completionTokensPerUpstreamSecond = static_cast<double>(pairedCompletionTokens_) /
                                                        (static_cast<double>(pairedUpstreamMs_) / 1000.0);
            }

            return out;
        }

        // The retained records, oldest first — arrival order, whatever chunking
        // delivered them.
        [[nodiscard]] std::vector<LedgerRecord> window() const {
            return std::vector<LedgerRecord>(window_.begin(), window_.end());
        }

        // One lane per distinct group in the retained window, plus at most one
        // untagged lane, ordered by FIRST APPEARANCE — stable and jitter-free,
        // where a count ordering would make the pane jump between frames.
        [[nodiscard]] std::vector<Lane> lanes() const {
            std::vector<Lane> lanes;
            std::vector<std::vector<std::int64_t>> waits;
            std::map<std::string, std::size_t> position;

            for (const LedgerRecord& entry : window_) {
                std::string group = entry.group.value_or(std::string{});
                const auto [slot, inserted] = position.emplace(std::move(group), lanes.size());
                if (inserted) {
                    Lane fresh;
                    fresh.group = slot->first;
                    lanes.push_back(std::move(fresh));
                    waits.emplace_back();
                }

                Lane& lane = lanes[slot->second];
                ++lane.completed;

                if (entry.queueWaitMs) {
                    waits[slot->second].push_back(*entry.queueWaitMs);
                    if (*entry.queueWaitMs > 0)
                        ++lane.queued;
                }

                if (entry.status == 503)
                    ++lane.shed;
            }

            for (std::size_t i = 0; i < lanes.size(); ++i)
                lanes[i].waitMsP95 = detail::nearestRank(std::move(waits[i]), 95);

            return lanes;
        }

        // A RUN is a maximal block of consecutive window positions all carrying
        // the same non-empty group. An untagged record SPLITS a run — it is a
        // position in the sequence, not a gap to be skipped over.
        [[nodiscard]] AffinitySummary affinity() const {
            AffinitySummary summary;

            std::string previous;
            bool previousTagged = false;
            std::int64_t current = 0;

            for (const LedgerRecord& entry : window_) {
                const std::string group = entry.group.value_or(std::string{});
                if (group.empty()) {
                    previous.clear();
                    previousTagged = false;
                    current = 0;
                    continue;
                }

                ++summary.taggedRequests;
                if (previousTagged && previous == group) {
                    ++current;
                }
                else {
                    ++summary.runs;
                    current = 1;
                }

                summary.longestRun = std::max(summary.longestRun, current);
                previous = group;
                previousTagged = true;
            }

            // Every tagged record that immediately followed a record of its own
            // group: each run contributes its length minus its first member.
            summary.contiguousFollowers = summary.taggedRequests - summary.runs;

            if (summary.taggedRequests > 0) {
                summary.hitRate = static_cast<double>(summary.contiguousFollowers) /
                                  static_cast<double>(summary.taggedRequests);
            }

            return summary;
        }

    private:
        // Records whose queueWaitMs is null contribute no sample and do not
        // change N.
        [[nodiscard]] std::vector<std::int64_t> windowWaits() const {
            std::vector<std::int64_t> waits;
            waits.reserve(window_.size());
            for (const LedgerRecord& entry : window_) {
                if (entry.queueWaitMs)
                    waits.push_back(*entry.queueWaitMs);
            }

            return waits;
        }

        std::size_t windowSize_;
        std::deque<LedgerRecord> window_;

        std::int64_t totalRequests_{ 0 };
        std::int64_t schemaMissingTrue_{ 0 };
        std::int64_t schemaConformedTrue_{ 0 };
        std::int64_t schemaVerdicts_{ 0 };
        std::int64_t promptTokens_{ 0 };
        std::int64_t completionTokens_{ 0 };
        std::int64_t pairedCompletionTokens_{ 0 };
        std::int64_t pairedUpstreamMs_{ 0 };
        std::map<int, std::int64_t> statusCounts_;
    };

    namespace detail {

        // `<status>:<count>` pairs in ascending NUMERIC status order, and the
        // single ASCII hyphen when nothing has been counted. A key that is not
        // a decimal integer sorts after every key that is, so a malformed
        // aggregate still renders rather than reordering the real statuses.
        [[nodiscard]] inline std::string renderStatusCounts(const std::map<std::string, std::int64_t>& counts) {
            if (counts.empty())
                return "-";

            struct Pair {
                std::int64_t order;
                const std::string* key;
                std::int64_t count;
            };

            std::vector<Pair> ordered;
            ordered.reserve(counts.size());
            for (const auto& [key, count] : counts) {
                ordered.push_back(Pair{ decimalValue(key).value_or(std::numeric_limits<std::int64_t>::max()),
                                        &key, count });
            }

            std::ranges::sort(ordered, [](const Pair& left, const Pair& right) {
                if (left.order != right.order)
                    return left.order < right.order;

                return *left.key < *right.key;
            });

            std::string out;
            for (const Pair& pair : ordered) {
                if (!out.empty())
                    out.push_back(' ');

                out += *pair.key;
                out.push_back(':');
                out += std::to_string(pair.count);
            }

            return out;
        }

    }  // namespace detail

    // One decimal place, and a bare hyphen when there is no data. A real 0 is a
    // number and must never be confused with the no-data hyphen. Public because
    // the affinity pane formats its own rate with the identical rule.
    [[nodiscard]] inline std::string renderPercent(const std::optional<double>& rate) {
        if (!rate)
            return "-";

        return std::format("{:.1f}%", *rate * 100.0);
    }

    [[nodiscard]] inline std::string renderRate(const std::optional<double>& value) {
        if (!value)
            return "-";

        return std::format("{:.1f}", *value);
    }

    // Every string the summary pane prints, produced here so the formatting is
    // under test and ftxui renders pre-formatted text. Pure and total: an
    // empty-view aggregate still yields all ten rows.
    [[nodiscard]] inline std::vector<std::pair<std::string, std::string>> summaryRows(const LedgerAggregate& aggregate) {
        std::vector<std::pair<std::string, std::string>> rows;
        rows.reserve(10);
        rows.emplace_back("requests", std::to_string(aggregate.totalRequests));
        rows.emplace_back("status counts", detail::renderStatusCounts(aggregate.statusCounts));
        rows.emplace_back("prompt tokens", std::to_string(aggregate.promptTokens));
        rows.emplace_back("completion tokens", std::to_string(aggregate.completionTokens));
        rows.emplace_back("wait p50 ms", std::to_string(aggregate.waitMsP50));
        rows.emplace_back("wait p95 ms", std::to_string(aggregate.waitMsP95));
        rows.emplace_back("schema missing", std::to_string(aggregate.schemaMissing));
        rows.emplace_back("schema conformed", std::to_string(aggregate.schemaConformed));
        rows.emplace_back("schema conformance", renderPercent(aggregate.schemaConformanceRate));
        rows.emplace_back("tokens/s upstream", renderRate(aggregate.completionTokensPerUpstreamSecond));
        return rows;
    }

}  // namespace conductor::dashboard
