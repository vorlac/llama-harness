// =============================================================================
// Task 15.2 — `conductor-dashboard` entry point: the ftxui TUI over the §4.4
// metrics ledger, and nothing more than an adapter.
//
// Every number this file puts on screen is computed by dashboard/ledger_view.hpp
// and is under doctest in router/tests/dashboard_test.cpp. What lives HERE is
// only what cannot be a pure transform: opening the ledger, following it as the
// router appends, drawing four panes, and mapping startup verdicts onto exit
// codes. Nothing is re-derived in the viewer — if a number is wrong on screen it
// is wrong in a tested function, not in a second computation hiding behind the
// rendering.
//
// EXIT CODES, the same table C-041 pinned for llama-router, because 12.1's
// supervisor may end up launching both:
//   0  clean quit ('q'), and the --help / --version paths;
//   2  usage error — stderr carries the parse error naming the offending or
//      missing flag, then the usage text;
//   3  ConfigError — stderr carries what(), which contains field() verbatim,
//      plus field() on its own line; an unreadable config file lands here too.
//
// HOW IT FINDS THE LEDGER (spec SG-F). `--config <path> --schema <path>`, both
// required, parsed by the committed pure conductor::router::parseCli — the same
// two flags llama-router takes, so the dashboard cannot be pointed at a file the
// router is not writing. The location is then
// parseRouterConfig(...).metrics.ledgerPath and comes from nowhere else: there
// is no flag of its own for it, no default, and no search path. A second way to
// name that file is exactly what §2.2's single source of truth exists to
// prevent.
//
// THREADS. One poll thread does the file I/O and folds what it read into the
// LedgerView; the ftxui loop thread renders snapshots of it. `consumed_` and the
// LedgerTail belong to the poll thread alone and need no lock; the LedgerView
// and the status line are shared, and every touch of them is under mutex_.
// =============================================================================

#include <ftxui/component/component.hpp>
#include <ftxui/component/event.hpp>
#include <ftxui/component/screen_interactive.hpp>
#include <ftxui/dom/elements.hpp>

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <format>
#include <fstream>
#include <iostream>
#include <iterator>
#include <mutex>
#include <span>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#include "dashboard/ledger_view.hpp"
#include "router/cli.hpp"
#include "router/config.hpp"
#include "router/version.hpp"

namespace {

    using conductor::dashboard::AffinitySummary;
    using conductor::dashboard::Lane;
    using conductor::dashboard::LedgerAggregate;
    using conductor::dashboard::LedgerRecord;
    using conductor::dashboard::LedgerTail;
    using conductor::dashboard::LedgerView;

    constexpr std::chrono::milliseconds kPollInterval{ 200 };
    constexpr int kLabelColumnWidth = 22;
    constexpr int kLeftColumnWidth = 44;
    constexpr std::size_t kTailPaneRows = 14;

    // Follows one ledger file. Every failure mode is a status line, never a
    // throw: the file may not exist yet because the router has not started, and
    // a viewer that aborts on that is useless for watching a run come up.
    class LedgerFollower {
    public:
        // What one frame draws. Snapshotted under the lock so a redraw can never
        // read a half-updated view.
        struct Frame {
            LedgerAggregate aggregate;
            std::vector<Lane> lanes;
            AffinitySummary affinity;
            std::vector<LedgerRecord> recent;
            std::string status;
        };

        explicit LedgerFollower(std::string path)
            : path_(std::move(path))
            , status_("waiting for the ledger to appear: " + path_) {
        }

        // Reads whatever was appended since the last call. Called from the poll
        // thread only.
        void poll() {
            std::error_code ec;
            const std::uintmax_t size = std::filesystem::file_size(path_, ec);
            if (ec) {
                setStatus("ledger not readable yet (the router may not have started): " + path_);
                return;
            }

            const conductor::dashboard::TailStep step =
                conductor::dashboard::nextRead(consumed_, static_cast<std::uint64_t>(size));

            if (step.restart) {
                // The file shrank: a new run replaced it. The counters start
                // over rather than showing a total spanning two files, and the
                // whole of the new file is read from byte 0.
                tail_.reset();
                consumed_ = 0;

                const std::lock_guard<std::mutex> lock(mutex_);
                view_.restart();
            }

            if (static_cast<std::uint64_t>(size) <= step.offset) {
                setStatus(describe());
                return;
            }

            std::ifstream in(path_, std::ios::binary);
            if (!in.is_open()) {
                setStatus("ledger not readable yet (the router may not have started): " + path_);
                return;
            }

            in.seekg(static_cast<std::streamoff>(step.offset));

            std::string chunk(static_cast<std::size_t>(size - step.offset), '\0');
            in.read(chunk.data(), static_cast<std::streamsize>(chunk.size()));
            chunk.resize(static_cast<std::size_t>(in.gcount()));
            consumed_ = step.offset + chunk.size();

            // A read can land mid-line — the append fires at response
            // completion and is a separate write from the client's last byte —
            // so the chunk goes through the tail, which never parses a half
            // line and carries the remainder to the next poll.
            const std::vector<LedgerRecord> records = tail_.consume(chunk);
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                view_.record(records);
            }

            setStatus(describe());
        }

        [[nodiscard]] Frame frame() const {
            const std::lock_guard<std::mutex> lock(mutex_);

            Frame out;
            out.aggregate = view_.aggregate();
            out.lanes = view_.lanes();
            out.affinity = view_.affinity();
            out.recent = view_.window();
            out.status = status_;
            return out;
        }

    private:
        [[nodiscard]] std::string describe() const {
            return "following " + path_ + " — " + std::to_string(consumed_) + " bytes read, " +
                   std::to_string(tail_.skipped()) + " unreadable lines skipped";
        }

        void setStatus(std::string text) {
            const std::lock_guard<std::mutex> lock(mutex_);
            status_ = std::move(text);
        }

        std::string path_;

        mutable std::mutex mutex_;
        LedgerView view_;
        std::string status_;

        // Poll-thread-only state: one thread reads the file, so these need no
        // lock and taking one would only hide that fact.
        LedgerTail tail_;
        std::uint64_t consumed_{ 0 };
    };

    [[nodiscard]] ftxui::Element labelledRow(const std::string& label, const std::string& value) {
        return ftxui::hbox({
            ftxui::text(label) | ftxui::size(ftxui::WIDTH, ftxui::EQUAL, kLabelColumnWidth),
            ftxui::text(value) | ftxui::bold,
        });
    }

    // Pane 1: the ten pre-formatted rows of summaryRows(). The strings are the
    // ones under test; this only stacks them.
    [[nodiscard]] ftxui::Element summaryPane(const LedgerFollower::Frame& frame) {
        ftxui::Elements rows;
        for (const auto& [label, value] : conductor::dashboard::summaryRows(frame.aggregate))
            rows.push_back(labelledRow(label, value));

        return ftxui::window(ftxui::text(" summary — cumulative over the tail "),
                             ftxui::vbox(std::move(rows)));
    }

    // One lane row, laid out with fixed field widths so the columns line up and
    // a narrow terminal clips the right edge instead of squeezing the labels
    // into each other.
    [[nodiscard]] std::string laneRow(std::string_view group, std::string_view completed,
                                      std::string_view queued, std::string_view shed,
                                      std::string_view waitMsP95) {
        return std::format("{:<14}{:>5}{:>8}{:>6}{:>8}", group, completed, queued, shed, waitMsP95);
    }

    // Pane 2: SG-A's lanes. Labelled with what it is — recent COMPLETIONS per
    // group over the retained window — because the ledger publishes no live
    // gauge and a pane that implied one would be lying.
    [[nodiscard]] ftxui::Element lanesPane(const LedgerFollower::Frame& frame) {
        ftxui::Elements rows;
        rows.push_back(ftxui::text(laneRow("group", "done", "queued", "shed", "p95 ms")) | ftxui::dim);

        for (const Lane& lane : frame.lanes) {
            rows.push_back(ftxui::text(laneRow(lane.group.empty() ? "(untagged)" : lane.group,
                                               std::to_string(lane.completed),
                                               std::to_string(lane.queued), std::to_string(lane.shed),
                                               std::to_string(lane.waitMsP95))));
        }

        if (frame.lanes.empty())
            rows.push_back(ftxui::text("no completions in the window yet") | ftxui::dim);

        return ftxui::window(ftxui::text(" lanes — recent completions per group, not a live gauge "),
                             ftxui::vbox(std::move(rows)));
    }

    // Pane 3: SG-G's affinity markers, over ledger order and labelled OBSERVED,
    // because the ledger is completion-ordered and grants are not.
    [[nodiscard]] ftxui::Element affinityPane(const LedgerFollower::Frame& frame) {
        const AffinitySummary summary = frame.affinity;

        ftxui::Elements rows;
        rows.push_back(labelledRow("tagged requests", std::to_string(summary.taggedRequests)));
        rows.push_back(labelledRow("runs", std::to_string(summary.runs)));
        rows.push_back(labelledRow("longest run", std::to_string(summary.longestRun)));
        rows.push_back(labelledRow("contiguous followers", std::to_string(summary.contiguousFollowers)));
        rows.push_back(labelledRow("hit rate", conductor::dashboard::renderPercent(summary.hitRate)));

        return ftxui::window(ftxui::text(" group affinity — observed in ledger order "),
                             ftxui::vbox(std::move(rows)));
    }

    [[nodiscard]] std::string describeRecord(const LedgerRecord& entry) {
        const std::string group = entry.group.value_or(std::string{});

        std::string line = std::to_string(entry.status);
        line += "  ";
        line += entry.priority.empty() ? std::string("-") : entry.priority;
        line += "  ";
        line += group.empty() ? std::string("-") : group;
        line += "  ";
        line += entry.model.empty() ? std::string("-") : entry.model;
        line += "  wait ";
        line += entry.queueWaitMs ? std::to_string(*entry.queueWaitMs) : std::string("-");
        line += "ms  upstream ";
        line += entry.upstreamMs ? std::to_string(*entry.upstreamMs) : std::string("-");
        line += "ms  ";
        line += entry.completionTokens ? std::to_string(*entry.completionTokens) : std::string("-");
        line += " tok";
        return line;
    }

    // Pane 4: the most recent records the view retained, newest last so the
    // pane reads like the file it is following.
    [[nodiscard]] ftxui::Element tailPane(const LedgerFollower::Frame& frame) {
        const std::vector<LedgerRecord>& recent = frame.recent;
        const std::size_t from = recent.size() > kTailPaneRows ? recent.size() - kTailPaneRows : 0;

        ftxui::Elements rows;
        for (std::size_t at = from; at < recent.size(); ++at)
            rows.push_back(ftxui::text(describeRecord(recent[at])));

        if (rows.empty())
            rows.push_back(ftxui::text("no records read yet") | ftxui::dim);

        return ftxui::window(ftxui::text(" recent records "), ftxui::vbox(std::move(rows)));
    }

    [[nodiscard]] ftxui::Element statusPane(const LedgerFollower::Frame& frame) {
        return ftxui::hbox({
            ftxui::text(" " + frame.status) | ftxui::flex,
            ftxui::text("q to quit ") | ftxui::dim,
        });
    }

    // parseCli is llama-router's, deliberately (SG-F: one CLI contract for both
    // binaries), so its usage text names that binary. Only the program name
    // differs between them.
    [[nodiscard]] std::string usageFor(std::string usage) {
        constexpr std::string_view from = "llama-router";
        constexpr std::string_view to = "conductor-dashboard";

        for (std::size_t at = usage.find(from); at != std::string::npos;
             at = usage.find(from, at + to.size()))
            usage.replace(at, from.size(), to);

        return usage;
    }

}  // namespace

int main(int argc, char** argv) {
    std::vector<std::string_view> args;
    args.reserve(argc > 0 ? static_cast<std::size_t>(argc - 1) : 0);
    for (int i = 1; i < argc; ++i)
        args.emplace_back(argv[i]);

    const conductor::router::CliParse verdict =
        conductor::router::parseCli(std::span<const std::string_view>(args.data(), args.size()));

    if (!verdict.options.has_value()) {
        // The refusal names the offending or missing flag, then the parser's
        // own usage text — never a usage string minted here.
        std::cerr << verdict.error << '\n'
                  << usageFor(verdict.usage);
        return 2;
    }

    if (verdict.options->showHelp) {
        std::cout << usageFor(verdict.usage);
        return 0;
    }

    if (verdict.options->showVersion) {
        std::cout << "conductor-dashboard " << conductor::router::router_version() << '\n';
        return 0;
    }

    std::string configText;
    {
        std::ifstream in(verdict.options->configPath, std::ios::binary);
        if (!in.is_open()) {
            std::cerr << "conductor-dashboard: cannot read router config file: "
                      << verdict.options->configPath << '\n';
            return 3;
        }

        configText.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }

    conductor::router::RouterConfig config;
    try {
        // The IDENTICAL parse the router performs, against the same exported
        // schema, so the two can never disagree about where the ledger is.
        config = conductor::router::parseRouterConfig(configText, verdict.options->schemaPath);
    } catch (const conductor::router::ConfigError& failure) {
        std::cerr << "conductor-dashboard: " << failure.what() << '\n';
        if (!failure.field().empty())
            std::cerr << "conductor-dashboard: offending field: " << failure.field() << '\n';

        return 3;
    }

    LedgerFollower follower{ config.metrics.ledgerPath };

    auto screen = ftxui::ScreenInteractive::Fullscreen();

    std::mutex wakeMutex;
    std::condition_variable wake;
    bool running = true;

    std::thread poller([&] {
        std::unique_lock<std::mutex> lock(wakeMutex);
        while (running) {
            lock.unlock();
            follower.poll();
            screen.PostEvent(ftxui::Event::Custom);
            lock.lock();
            wake.wait_for(lock, kPollInterval, [&running] {
                return !running;
            });
        }
    });

    const ftxui::Component renderer = ftxui::Renderer([&follower] {
        const LedgerFollower::Frame frame = follower.frame();
        return ftxui::vbox({
            ftxui::hbox({
                summaryPane(frame) | ftxui::size(ftxui::WIDTH, ftxui::EQUAL, kLeftColumnWidth),
                lanesPane(frame) | ftxui::flex,
            }),
            ftxui::hbox({
                affinityPane(frame) | ftxui::size(ftxui::WIDTH, ftxui::EQUAL, kLeftColumnWidth),
                tailPane(frame) | ftxui::flex,
            }) | ftxui::flex,
            statusPane(frame),
        });
    });

    const ftxui::Component root = ftxui::CatchEvent(renderer, [&screen](const ftxui::Event& event) {
        if (event == ftxui::Event::Character('q') || event == ftxui::Event::Character('Q')) {
            screen.Exit();
            return true;
        }

        return false;
    });

    screen.Loop(root);

    {
        const std::lock_guard<std::mutex> lock(wakeMutex);
        running = false;
    }

    wake.notify_all();
    poller.join();
    return 0;
}
