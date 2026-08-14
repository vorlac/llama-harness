// =============================================================================
// Task 15.2 — `conductor-dashboard` (ftxui, optional target): the pure ledger
// aggregation layer behind the TUI that tails the §4.4 metrics ledger.
//
// This suite is written RED: `dashboard/ledger_view.hpp` does not exist yet, so
// this translation unit fails to COMPILE — the include does not resolve. That is
// the intended red shape. Everything else this file touches is committed code
// (or, for the two build rows, files the orchestrator wires) and must keep
// compiling verbatim. One TEST_CASE per assertion id from
// docs/build/specs/task-15.2.assertions.json (17 rows), named "[<id>] …".
//
// LAYOUT NOTE. The spec's `kind` field still spells the module `src/dashboard/`.
// That spelling is stale: the C++ tree was hoisted, `src/` no longer exists, and
// the REPO ROOT is the only user-code include root (CMakeLists.txt:70-77). The
// spec's own include spelling — `#include "dashboard/ledger_view.hpp"` — is the
// correct one, and it is what this file uses, exactly as metrics_test.cpp
// includes "router/metrics.hpp". The files are therefore `dashboard/
// ledger_view.hpp` and `dashboard/main.cpp` at the repo root.
//
// THE TARGET SURFACE (pinned by the spec's resolutions; header-only and
// ftxui-free, which is what lets row 15.2-header-purity be proved by this
// translation unit compiling into the EXISTING `router-tests` target — SG-H):
//
//   // dashboard/ledger_view.hpp   (REPO ROOT, HEADER-ONLY)
//   #pragma once
//
//   #include <nlohmann/json.hpp>   // the ONLY non-std dependency permitted
//
//   #include <cstddef>
//   #include <cstdint>
//   #include <map>
//   #include <optional>
//   #include <string>
//   #include <string_view>
//   #include <utility>
//   #include <vector>
//
//   namespace conductor::dashboard {
//
//   inline constexpr std::size_t kDefaultWindowSize = 200;              // SG-C/SG-J
//   inline constexpr std::size_t kDefaultMaxCarryBytes = 1024 * 1024;   // 1 MiB
//
//   // ONE ledger line as the dashboard reads it. The field set is
//   // router/metrics.hpp's RequestRecord MINUS `timings`, which the dashboard
//   // never reads. queueWaitMs is optional HERE even though the committed
//   // writer always emits a number for it: the reader is defensive by design
//   // (G5 applied to the reader), and a null must decode rather than reject.
//   struct LedgerRecord {
//       std::string model;
//       std::optional<std::string> role;
//       std::optional<std::string> group;
//       std::string priority;
//       std::optional<std::int64_t> queueWaitMs;
//       std::optional<std::int64_t> upstreamMs;
//       std::optional<std::int64_t> promptTokens;
//       std::optional<std::int64_t> completionTokens;
//       std::optional<bool> schemaMissing;
//       std::optional<bool> schemaConformed;
//       int status{ 0 };
//
//       friend bool operator==(const LedgerRecord&, const LedgerRecord&) = default;
//   };
//
//   // Pure, non-throwing decode of ONE line. nullopt is the ONLY failure
//   // channel. Unknown keys are ignored so a later 11.7 field addition cannot
//   // break the reader; `timings` is ignored for the same reason.
//   [[nodiscard]] std::optional<LedgerRecord> parseLedgerLine(std::string_view line);
//
//   struct TailStep {
//       std::uint64_t offset{ 0 };
//       bool restart{ false };
//
//       friend bool operator==(const TailStep&, const TailStep&) = default;
//   };
//
//   // The follow position, as a pure function so the one piece of the tail loop
//   // that can lose or duplicate data is testable without a filesystem.
//   [[nodiscard]] TailStep nextRead(std::uint64_t consumedOffset,
//                                   std::uint64_t currentSize) noexcept;
//
//   // Arbitrarily-chunked bytes in, whole records out. Never parses a
//   // half-written line; never throws; never grows without bound.
//   class LedgerTail {
//    public:
//     explicit LedgerTail(std::size_t maxCarryBytes = kDefaultMaxCarryBytes);
//
//     [[nodiscard]] std::vector<LedgerRecord> consume(std::string_view chunk);
//     [[nodiscard]] std::uint64_t skipped() const noexcept;
//     void reset();
//   };
//
//   // SG-A's lanes pane: recent completions per group, built from what the
//   // ledger actually carries. NOT a live gauge, and never labelled as one.
//   struct Lane {
//       std::string group;              // "" is the untagged lane
//       std::int64_t completed{ 0 };
//       std::int64_t queued{ 0 };       // records whose queueWaitMs > 0
//       std::int64_t shed{ 0 };         // records whose status is 503
//       std::int64_t waitMsP95{ 0 };
//
//       friend bool operator==(const Lane&, const Lane&) = default;
//   };
//
//   // SG-G's group-affinity marker, defined over LEDGER order and named for
//   // what it measures: adjacent same-group records as OBSERVED.
//   struct AffinitySummary {
//       std::int64_t taggedRequests{ 0 };
//       std::int64_t runs{ 0 };
//       std::int64_t longestRun{ 0 };
//       std::int64_t contiguousFollowers{ 0 };
//       std::optional<double> hitRate;
//
//       friend bool operator==(const AffinitySummary&, const AffinitySummary&) = default;
//   };
//
//   // The first six names are byte-identical to /conductor/metrics and to the
//   // COMMITTED conductor/adapter/router-client.ts MetricsSummary, so the TUI
//   // and the endpoint can never quote two different numbers for one word.
//   struct LedgerAggregate {
//       std::int64_t totalRequests{ 0 };
//       std::int64_t schemaMissing{ 0 };
//       std::int64_t schemaConformed{ 0 };
//       std::map<std::string, std::int64_t> statusCounts;   // decimal status as a string
//       std::int64_t promptTokens{ 0 };
//       std::int64_t completionTokens{ 0 };
//       std::int64_t waitMsP50{ 0 };                        // WINDOWED, per SG-C
//       std::int64_t waitMsP95{ 0 };                        // WINDOWED, per SG-C
//       std::optional<double> schemaConformanceRate;
//       std::optional<double> completionTokensPerUpstreamSecond;   // SG-B
//
//       friend bool operator==(const LedgerAggregate&, const LedgerAggregate&) = default;
//   };
//
//   // Counts and sums are CUMULATIVE since construction or the last restart();
//   // percentiles, lanes and affinity are computed over the BOUNDED RECENT
//   // WINDOW (SG-C). The window size is a constructor parameter, never a config
//   // key and never a CLI flag (SG-J).
//   class LedgerView {
//    public:
//     explicit LedgerView(std::size_t windowSize = kDefaultWindowSize);
//
//     void record(const LedgerRecord& entry);
//     void record(const std::vector<LedgerRecord>& entries);   // the consume() shape
//     void restart();
//
//     [[nodiscard]] LedgerAggregate aggregate() const;
//     [[nodiscard]] std::vector<LedgerRecord> window() const;  // oldest first
//     [[nodiscard]] std::vector<Lane> lanes() const;
//     [[nodiscard]] AffinitySummary affinity() const;
//   };
//
//   // Every string the summary pane prints, produced by a pure function, so the
//   // formatting is under test and ftxui renders pre-formatted text.
//   [[nodiscard]] std::vector<std::pair<std::string, std::string>> summaryRows(
//       const LedgerAggregate& aggregate);
//
//   }  // namespace conductor::dashboard
//
// THE LEDGER LINE THIS READER CONSUMES is whatever router/metrics.hpp actually
// writes, read from the code at HEAD rather than assumed. MetricsLedger::toJson
// (metrics.hpp:200-222) sets exactly twelve keys and appendLine (metrics.hpp:
// 158-197) emits `toJson(entry).dump(-1, ' ', false, replace)` followed by one
// '\n'. nlohmann::json's object type is std::map, so the dumped keys are in
// ALPHABETICAL order, compact, with no whitespace. A full line and an
// everything-absent line are therefore, byte for byte:
//
//   {"completionTokens":21,"group":"g-1","model":"model-a","priority":"review",
//    "promptTokens":7,"queueWaitMs":12,"role":"reviewer","schemaConformed":true,
//    "schemaMissing":false,"status":200,"timings":{...},"upstreamMs":34}
//   {"completionTokens":null,"group":null,"model":"","priority":"interactive",
//    "promptTokens":null,"queueWaitMs":0,"role":null,"schemaConformed":null,
//    "schemaMissing":null,"status":503,"timings":null,"upstreamMs":null}
//
// (shown wrapped; the real line has no newline until its terminator). The
// helpers below render exactly that shape, so the reader is tested against the
// writer's real bytes and not against a paraphrase of them.
//
// This file's final home is router/tests/dashboard_test.cpp. CMake wiring is
// ORCHESTRATOR-ONLY: this file joins the router-tests target source list, and
// the CONDUCTOR_DASHBOARD option plus the conductor-dashboard target are the
// orchestrator's edit. `ledger_view.hpp` is header-only and needs no source-list
// entry.
//
// NOTE: doctest's main() comes from scaffold_test.cpp, which owns
// DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN for the whole router-tests binary. This
// translation unit must not define it again.
//
// NO THREADS, NO SLEEPS, NO CLOCK and NO SOCKET anywhere below: every row but
// the three build/live rows drives pure value transforms, which is the whole
// point of splitting the aggregation out of main.cpp (SG-I). The three
// build/live rows (15.2-optional-target-off-by-default,
// 15.2-dashboard-builds-and-renders, 15.2-ledger-path-from-config) are verified
// END TO END by the orchestrator against a real configure, a real binary and a
// real fixture ledger; what they assert HERE is the source-tree contract those
// runs depend on, so the demand for the files and the wiring is itself under
// test rather than resting on a transcript nobody re-runs.
// =============================================================================

#include <doctest/doctest.h>

#include "dashboard/ledger_view.hpp"

// The purity fence for row 15.2-header-purity, deliberately placed HERE —
// after the subject header and before anything else — so the macro state it
// inspects can only have come from `dashboard/ledger_view.hpp` itself. If the
// header ever reaches for ftxui, httplib, spdlog or (through any router header)
// the schema validator, this translation unit stops compiling with the message
// below instead of silently linking against a dependency the optional target is
// supposed to own alone.
#if defined(CPPHTTPLIB_HTTPLIB_H)
  #error "dashboard/ledger_view.hpp pulled in httplib: the aggregation layer opens no socket"
#endif
#if defined(SPDLOG_VERSION) || defined(SPDLOG_LOGGER_CALL)
  #error "dashboard/ledger_view.hpp pulled in spdlog: it is a pure transform and logs nothing"
#endif
#if defined(FTXUI_DOM_ELEMENTS_HPP) || defined(FTXUI_SCREEN_SCREEN_HPP) || \
    defined(FTXUI_COMPONENT_COMPONENT_HPP)
  #error "dashboard/ledger_view.hpp pulled in ftxui: router-tests must stay ftxui-free"
#endif
#if defined(NLOHMANN_JSON_SCHEMA_HPP__)
  #error "dashboard/ledger_view.hpp pulled in the schema validator: it validates nothing"
#endif

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <vector>

namespace {

    using conductor::dashboard::AffinitySummary;
    using conductor::dashboard::Lane;
    using conductor::dashboard::LedgerAggregate;
    using conductor::dashboard::LedgerRecord;
    using conductor::dashboard::LedgerTail;
    using conductor::dashboard::LedgerView;
    using conductor::dashboard::nextRead;
    using conductor::dashboard::parseLedgerLine;
    using conductor::dashboard::summaryRows;
    using conductor::dashboard::TailStep;

    // --- rendering the writer's real bytes ------------------------------------

    // The pinned §4.4 column set in the ALPHABETICAL order nlohmann::json's
    // std::map object type dumps. Defaults match the "nothing was observed"
    // line: absence is JSON null, never a missing key.
    struct LineSpec {
        std::string model{ "model-a" };
        std::optional<std::string> role{};
        std::optional<std::string> group{};
        std::string priority{ "interactive" };
        std::optional<std::int64_t> queueWaitMs{ 0 };
        std::optional<std::int64_t> upstreamMs{};
        std::optional<std::int64_t> promptTokens{};
        std::optional<std::int64_t> completionTokens{};
        std::string timings{ "null" };  // a raw JSON fragment, copied verbatim
        std::optional<bool> schemaMissing{};
        std::optional<bool> schemaConformed{};
        int status{ 200 };
    };

    // Every value used below is escape-free, so a bare quote pair is the whole
    // of the string encoding this helper needs. Named jsonString rather than
    // quoted so an unqualified call can never resolve to std::quoted by ADL.
    std::string jsonString(std::string_view text) {
        return "\"" + std::string(text) + "\"";
    }

    std::string numberOrNull(const std::optional<std::int64_t>& value) {
        return value ? std::to_string(*value) : std::string("null");
    }

    std::string stringOrNull(const std::optional<std::string>& value) {
        return value ? jsonString(*value) : std::string("null");
    }

    std::string boolOrNull(const std::optional<bool>& value) {
        if (!value)
            return "null";

        return *value ? "true" : "false";
    }

    std::string renderLine(const LineSpec& spec) {
        std::string line = "{";
        line += "\"completionTokens\":" + numberOrNull(spec.completionTokens) + ",";
        line += "\"group\":" + stringOrNull(spec.group) + ",";
        line += "\"model\":" + jsonString(spec.model) + ",";
        line += "\"priority\":" + jsonString(spec.priority) + ",";
        line += "\"promptTokens\":" + numberOrNull(spec.promptTokens) + ",";
        line += "\"queueWaitMs\":" + numberOrNull(spec.queueWaitMs) + ",";
        line += "\"role\":" + stringOrNull(spec.role) + ",";
        line += "\"schemaConformed\":" + boolOrNull(spec.schemaConformed) + ",";
        line += "\"schemaMissing\":" + boolOrNull(spec.schemaMissing) + ",";
        line += "\"status\":" + std::to_string(spec.status) + ",";
        line += "\"timings\":" + spec.timings + ",";
        line += "\"upstreamMs\":" + numberOrNull(spec.upstreamMs);
        line += "}";
        return line;
    }

    // A distinct, well-formed line per marker: the model column names the line,
    // exactly as metrics_test.cpp uses it to name a request.
    std::string lineNamed(std::string model) {
        LineSpec spec;
        spec.model = std::move(model);
        return renderLine(spec);
    }

    std::string joinLines(const std::vector<std::string>& lines) {
        std::string text;
        for (const std::string& line : lines) {
            text += line;
            text.push_back('\n');
        }

        return text;
    }

    // --- record building ------------------------------------------------------

    LedgerRecord baseRecord(int status = 200) {
        LedgerRecord entry;
        entry.model = "model-a";
        entry.priority = "interactive";
        entry.status = status;
        entry.queueWaitMs = 0;
        return entry;
    }

    LedgerRecord waitRecord(std::optional<std::int64_t> queueWaitMs, int status = 200) {
        LedgerRecord entry = baseRecord(status);
        entry.queueWaitMs = queueWaitMs;
        return entry;
    }

    LedgerRecord groupRecord(std::optional<std::string> group, int status = 200,
                             std::optional<std::int64_t> queueWaitMs = std::nullopt) {
        LedgerRecord entry = baseRecord(status);
        entry.group = std::move(group);
        entry.queueWaitMs = queueWaitMs;
        return entry;
    }

    LedgerRecord tokenRecord(std::optional<std::int64_t> completionTokens,
                             std::optional<std::int64_t> upstreamMs,
                             std::optional<std::int64_t> promptTokens = std::nullopt) {
        LedgerRecord entry = baseRecord(200);
        entry.completionTokens = completionTokens;
        entry.upstreamMs = upstreamMs;
        entry.promptTokens = promptTokens;
        return entry;
    }

    LedgerRecord verdictRecord(std::optional<bool> schemaConformed,
                               std::optional<bool> schemaMissing = std::nullopt) {
        LedgerRecord entry = baseRecord(200);
        entry.schemaConformed = schemaConformed;
        entry.schemaMissing = schemaMissing;
        return entry;
    }

    // --- reading the results --------------------------------------------------

    const Lane* laneFor(const std::vector<Lane>& lanes, std::string_view group) {
        const auto found = std::find_if(lanes.begin(), lanes.end(), [group](const Lane& lane) {
            return lane.group == group;
        });

        return found == lanes.end() ? nullptr : &*found;
    }

    std::vector<std::string> laneOrder(const std::vector<Lane>& lanes) {
        std::vector<std::string> order;
        order.reserve(lanes.size());
        for (const Lane& lane : lanes)
            order.push_back(lane.group);

        return order;
    }

    std::vector<std::string> modelsOf(const std::vector<LedgerRecord>& records) {
        std::vector<std::string> models;
        models.reserve(records.size());
        for (const LedgerRecord& entry : records)
            models.push_back(entry.model);

        return models;
    }

    using Row = std::pair<std::string, std::string>;

    std::vector<std::string> labelsOf(const std::vector<Row>& rows) {
        std::vector<std::string> labels;
        labels.reserve(rows.size());
        for (const Row& row : rows)
            labels.push_back(row.first);

        return labels;
    }

    // Returns the value beside `label`, or a sentinel that can never be a
    // rendered value, so a missing label fails loudly instead of comparing
    // equal to an empty string.
    std::string valueOf(const std::vector<Row>& rows, std::string_view label) {
        for (const Row& row : rows) {
            if (row.first == label)
                return row.second;
        }

        return "<no such label>";
    }

    bool mentions(std::string_view haystack, std::string_view needle) {
        return haystack.find(needle) != std::string_view::npos;
    }

    // --- the source tree, for the three build/live rows -----------------------

    bool looksLikeRepoRoot(const std::filesystem::path& dir) {
        return std::filesystem::exists(dir / "CMakeLists.txt") &&
               std::filesystem::exists(dir / "router" / "tests");
    }

    std::optional<std::filesystem::path> walkUpToRoot(std::filesystem::path dir) {
        while (!dir.empty()) {
            if (looksLikeRepoRoot(dir))
                return dir;

            const std::filesystem::path parent = dir.parent_path();
            if (parent == dir)
                break;

            dir = parent;
        }

        return std::nullopt;
    }

    // __FILE__ is absolute (CMake lists these sources by absolute path); the
    // working-directory walk is the fallback that keeps the suite runnable from
    // a build tree. Same idiom as config_test.cpp's exportedSchemaPath().
    std::filesystem::path repoRoot() {
        if (const auto found = walkUpToRoot(std::filesystem::path(__FILE__).parent_path()))
            return *found;

        std::error_code ec;
        const std::filesystem::path cwd = std::filesystem::current_path(ec);
        if (!ec) {
            if (const auto found = walkUpToRoot(cwd))
                return *found;
        }

        // Nothing found: name the expected location in the failure.
        return std::filesystem::path(__FILE__).parent_path().parent_path().parent_path();
    }

    std::string readTextFile(const std::filesystem::path& path) {
        std::ifstream in(path, std::ios::binary);
        if (!in.is_open())
            return {};

        std::ostringstream buffer;
        buffer << in.rdbuf();
        return buffer.str();
    }

    // CMake '#' comments are documentation, and CMakeLists.txt:61-65 already
    // MENTIONS ftxui in prose ("NEVER links `llama` or `ftxui`"). Stripping
    // comments is what keeps the no-ftxui-link assertions from matching that
    // sentence instead of a real link line. No CMake string in this file
    // contains a '#', so cutting each line at its first one is exact here.
    std::string stripCMakeComments(std::string_view text) {
        std::string out;
        out.reserve(text.size());
        std::size_t start = 0;
        while (start <= text.size()) {
            const std::size_t eol = text.find('\n', start);
            const std::size_t end = eol == std::string_view::npos ? text.size() : eol;
            const std::string_view line = text.substr(start, end - start);
            out += line.substr(0, line.find('#'));
            out.push_back('\n');
            if (eol == std::string_view::npos)
                break;

            start = eol + 1;
        }

        return out;
    }

    // Collapses every run of whitespace to one space, so an assertion about a
    // CMake call is indifferent to how the call is wrapped across lines.
    std::string collapseWhitespace(std::string_view text) {
        std::string out;
        out.reserve(text.size());
        bool pendingSpace = false;
        for (const char ch : text) {
            if (std::isspace(static_cast<unsigned char>(ch)) != 0) {
                pendingSpace = !out.empty();
                continue;
            }

            if (pendingSpace) {
                out.push_back(' ');
                pendingSpace = false;
            }

            out.push_back(ch);
        }

        return out;
    }

    // The text of the first CMake call whose opening reads `prefix` (which must
    // end at or before the call's '('), from that '(' through its MATCHING
    // close paren, honouring double-quoted strings so a paren inside a docstring
    // cannot end the call early. Empty when there is no such call.
    std::string cmakeCall(const std::string& collapsed, std::string_view prefix) {
        const std::size_t found = collapsed.find(prefix);
        if (found == std::string::npos)
            return {};

        const std::size_t open = collapsed.find('(', found);
        if (open == std::string::npos)
            return {};

        std::size_t depth = 0;
        bool inString = false;
        for (std::size_t i = open; i < collapsed.size(); ++i) {
            const char ch = collapsed[i];
            if (inString) {
                if (ch == '\\')
                    ++i;
                else if (ch == '"')
                    inString = false;

                continue;
            }

            if (ch == '"')
                inString = true;
            else if (ch == '(')
                ++depth;
            else if (ch == ')') {
                --depth;
                if (depth == 0)
                    return collapsed.substr(found, i - found + 1);
            }
        }

        return {};
    }

    // A CMake call may be written with the first argument on the same line as
    // the command or on the next one; after collapsing, that is the difference
    // between "cmd(arg" and "cmd( arg".
    std::string cmakeCallForTarget(const std::string& collapsed, std::string_view command,
                                   std::string_view target) {
        const std::string tight = std::string(command) + "(" + std::string(target);
        std::string call = cmakeCall(collapsed, tight);
        if (!call.empty())
            return call;

        const std::string loose = std::string(command) + "( " + std::string(target);
        return cmakeCall(collapsed, loose);
    }

}  // namespace

TEST_CASE(
    "[15.2-parse-ledger-line] one ledger line decodes field for field into a LedgerRecord, JSON "
    "null becomes a disengaged optional, `timings` and unknown keys are ignored, and every "
    "malformed shape yields nullopt rather than a throw or a half-filled record") {
    SUBCASE("a full-column line decodes field for field") {
        LineSpec spec;
        spec.model = "model-a";
        spec.role = "reviewer";
        spec.group = "g-1";
        spec.priority = "review";
        spec.queueWaitMs = 12;
        spec.upstreamMs = 34;
        spec.promptTokens = 7;
        spec.completionTokens = 21;
        spec.timings = R"({"predicted_ms":80.25,"prompt_ms":12.5})";
        spec.schemaMissing = false;
        spec.schemaConformed = true;
        spec.status = 200;

        const std::string line = renderLine(spec);
        INFO("line: ", line);
        const std::optional<LedgerRecord> parsed = parseLedgerLine(line);
        REQUIRE(parsed.has_value());
        CHECK(parsed->model == "model-a");
        REQUIRE(parsed->role.has_value());
        CHECK(*parsed->role == "reviewer");
        REQUIRE(parsed->group.has_value());
        CHECK(*parsed->group == "g-1");
        CHECK(parsed->priority == "review");
        REQUIRE(parsed->queueWaitMs.has_value());
        CHECK(*parsed->queueWaitMs == 12);
        REQUIRE(parsed->upstreamMs.has_value());
        CHECK(*parsed->upstreamMs == 34);
        REQUIRE(parsed->promptTokens.has_value());
        CHECK(*parsed->promptTokens == 7);
        REQUIRE(parsed->completionTokens.has_value());
        CHECK(*parsed->completionTokens == 21);
        REQUIRE(parsed->schemaMissing.has_value());
        CHECK(*parsed->schemaMissing == false);
        REQUIRE(parsed->schemaConformed.has_value());
        CHECK(*parsed->schemaConformed == true);
        CHECK(parsed->status == 200);

        // No state: the same bytes decode to the same record every time.
        const std::optional<LedgerRecord> again = parseLedgerLine(line);
        REQUIRE(again.has_value());
        CHECK(*again == *parsed);
    }

    SUBCASE("every JSON null becomes a disengaged optional and an empty model stays empty") {
        // Exactly the shed-request line the committed writer emits when nothing
        // was observed: model "", every optional column null.
        LineSpec spec;
        spec.model = "";
        spec.priority = "interactive";
        spec.queueWaitMs = 0;
        spec.status = 503;

        const std::string line = renderLine(spec);
        INFO("line: ", line);
        const std::optional<LedgerRecord> parsed = parseLedgerLine(line);
        REQUIRE(parsed.has_value());
        CHECK(parsed->model.empty());
        CHECK_FALSE(parsed->role.has_value());
        CHECK_FALSE(parsed->group.has_value());
        CHECK(parsed->priority == "interactive");
        CHECK_FALSE(parsed->upstreamMs.has_value());
        CHECK_FALSE(parsed->promptTokens.has_value());
        CHECK_FALSE(parsed->completionTokens.has_value());
        CHECK_FALSE(parsed->schemaMissing.has_value());
        CHECK_FALSE(parsed->schemaConformed.has_value());
        CHECK(parsed->status == 503);
        // The committed writer's queueWaitMs is a non-optional std::int64_t and
        // is therefore always a number; a 0 must decode ENGAGED, not as "no
        // sample", or every promptly-admitted request would vanish from the
        // percentile input.
        REQUIRE(parsed->queueWaitMs.has_value());
        CHECK(*parsed->queueWaitMs == 0);
    }

    SUBCASE("a null queueWaitMs decodes as disengaged rather than as a rejection") {
        LineSpec spec;
        spec.queueWaitMs = std::nullopt;
        const std::optional<LedgerRecord> parsed = parseLedgerLine(renderLine(spec));
        REQUIRE(parsed.has_value());
        CHECK_FALSE(parsed->queueWaitMs.has_value());
    }

    SUBCASE("timings is ignored and an unknown key is ignored, never rejected") {
        LineSpec spec;
        spec.model = "later-fields";
        spec.timings = R"({"predicted_per_second":52.5,"nested":{"deep":[1,2,3]}})";

        std::string line = renderLine(spec);
        // A field a later 11.7 change might add. The reader must not care.
        line.insert(line.size() - 1, R"(,"someFieldAddedLater":{"a":1})");
        INFO("line: ", line);

        const std::optional<LedgerRecord> parsed = parseLedgerLine(line);
        REQUIRE(parsed.has_value());
        CHECK(parsed->model == "later-fields");
        CHECK(parsed->status == 200);
    }

    SUBCASE("absent columns are tolerated exactly as null columns are") {
        // The symmetric half of "unknown keys are ignored": only `status` is
        // load-bearing, so a line that lost a column still decodes rather than
        // taking the whole pane down with it.
        const std::optional<LedgerRecord> parsed = parseLedgerLine(R"({"status":429})");
        REQUIRE(parsed.has_value());
        CHECK(parsed->status == 429);
        CHECK(parsed->model.empty());
        CHECK_FALSE(parsed->role.has_value());
        CHECK_FALSE(parsed->group.has_value());
        CHECK_FALSE(parsed->queueWaitMs.has_value());
    }

    SUBCASE("every malformed shape yields nullopt") {
        LineSpec spec;
        std::string missingStatus = renderLine(spec);
        const std::size_t statusAt = missingStatus.find(R"("status":200,)");
        REQUIRE(statusAt != std::string::npos);
        missingStatus.erase(statusAt, std::string(R"("status":200,)").size());

        LineSpec stringStatus;
        std::string statusAsString = renderLine(stringStatus);
        const std::size_t numberAt = statusAsString.find(R"("status":200)");
        REQUIRE(numberAt != std::string::npos);
        statusAsString.replace(numberAt, std::string(R"("status":200)").size(),
                               R"("status":"200")");

        const std::vector<std::string> rejected = {
            "",                                    // an empty line
            "   ",                                 // whitespace only
            "\t \t",                               // whitespace only, tabs
            R"({"model":"truncated","status":2)",  // a half-written line
            "42",                                  // valid JSON, not an object
            "-3.5",                                // valid JSON, not an object
            R"("a string")",                       // valid JSON, not an object
            "[]",                                  // valid JSON, not an object
            R"([{"status":200}])",                 // an array of objects
            "null",                                // valid JSON, not an object
            "true",                                // valid JSON, not an object
            missingStatus,                         // an object with no status
            statusAsString,                        // status as a string
            R"({"status":true})",                  // status as a bool
        };

        for (const std::string& text : rejected) {
            INFO("must decode to nullopt: '", text, "'");
            std::optional<LedgerRecord> parsed;
            CHECK_NOTHROW(parsed = parseLedgerLine(text));
            CHECK_FALSE(parsed.has_value());
        }
    }
}

TEST_CASE(
    "[15.2-tail-partial-line] LedgerTail turns an arbitrarily-chunked byte stream into whole "
    "records and never parses a half-written line: a record is emitted only for a "
    "newline-terminated line, every chunking of the same bytes yields the same records in file "
    "order, and a CRLF terminator decodes identically") {
    const std::string lineA = lineNamed("a");
    const std::string lineB = lineNamed("b");
    const std::string lineC = lineNamed("c");

    SUBCASE("one complete line in one chunk emits one record") {
        LedgerTail tail;
        const std::vector<LedgerRecord> out = tail.consume(lineA + "\n");
        REQUIRE(out.size() == 1);
        CHECK(out.front().model == "a");
    }

    SUBCASE("a line split at ANY byte offset emits nothing then exactly that record") {
        const std::string text = lineA + "\n";
        REQUIRE(text.size() > 2);

        // The '\n' is the last byte, so every split below leaves the first
        // chunk unterminated — the half-written-line case a live tail hits.
        for (std::size_t split = 1; split < text.size(); ++split) {
            INFO("split at byte ", split, " of ", text.size());
            LedgerTail tail;
            const std::vector<LedgerRecord> first = tail.consume(std::string_view(text).substr(0, split));
            CHECK(first.empty());

            const std::vector<LedgerRecord> second = tail.consume(std::string_view(text).substr(split));
            REQUIRE(second.size() == 1);
            CHECK(second.front().model == "a");
        }
    }

    SUBCASE("three complete lines in one chunk emit three records in file order") {
        LedgerTail tail;
        const std::vector<LedgerRecord> out = tail.consume(joinLines({ lineA, lineB, lineC }));
        REQUIRE(out.size() == 3);
        CHECK(modelsOf(out) == std::vector<std::string>{ "a", "b", "c" });
    }

    SUBCASE("two-and-a-half lines emit exactly two, and the half completes on the next chunk") {
        LedgerTail tail;
        const std::string halfOfC = lineC.substr(0, lineC.size() / 2);
        const std::vector<LedgerRecord> first =
            tail.consume(lineA + "\n" + lineB + "\n" + halfOfC);
        REQUIRE(first.size() == 2);
        CHECK(modelsOf(first) == std::vector<std::string>{ "a", "b" });

        const std::vector<LedgerRecord> second = tail.consume(lineC.substr(halfOfC.size()) + "\n");
        REQUIRE(second.size() == 1);
        CHECK(second.front().model == "c");
    }

    SUBCASE("a lone newline completes a carried, otherwise-complete line") {
        LedgerTail tail;
        CHECK(tail.consume(lineB).empty());

        const std::vector<LedgerRecord> out = tail.consume("\n");
        REQUIRE(out.size() == 1);
        CHECK(out.front().model == "b");
    }

    SUBCASE("any chunking of the same bytes yields the same records as one chunk") {
        const std::string text =
            joinLines({ lineNamed("l0"), lineNamed("l1"), lineNamed("l2"), lineNamed("l3"),
                        lineNamed("l4") });

        LedgerTail whole;
        const std::vector<LedgerRecord> expected = whole.consume(text);
        REQUIRE(expected.size() == 5);

        for (const std::size_t chunkSize : { std::size_t{ 1 }, std::size_t{ 2 }, std::size_t{ 3 },
                                             std::size_t{ 7 }, std::size_t{ 13 },
                                             std::size_t{ 97 } }) {
            INFO("chunk size ", chunkSize);
            LedgerTail tail;
            std::vector<LedgerRecord> collected;
            for (std::size_t at = 0; at < text.size(); at += chunkSize) {
                const std::vector<LedgerRecord> part =
                    tail.consume(std::string_view(text).substr(at, chunkSize));
                collected.insert(collected.end(), part.begin(), part.end());
            }

            CHECK(collected.size() == expected.size());
            CHECK(collected == expected);
        }
    }

    SUBCASE("a CRLF terminator decodes identically to a bare LF") {
        LedgerTail lf;
        LedgerTail crlf;
        const std::vector<LedgerRecord> viaLf = lf.consume(lineA + "\n" + lineB + "\n");
        const std::vector<LedgerRecord> viaCrLf = crlf.consume(lineA + "\r\n" + lineB + "\r\n");
        REQUIRE(viaLf.size() == 2);
        REQUIRE(viaCrLf.size() == 2);
        CHECK(viaCrLf == viaLf);
        CHECK(crlf.skipped() == 0);
    }
}

TEST_CASE(
    "[15.2-tail-fail-soft] G5 applied to the reader: a malformed complete line is skipped and "
    "counted while the good lines around it still emit, blank lines are not corruption, an "
    "unterminated blob past the carry limit is dropped rather than grown, reset() discards the "
    "carry but not the count, and consume() never throws for any bytes") {
    SUBCASE("a bad line between two good ones costs exactly that line") {
        LedgerTail tail;
        const std::string chunk =
            lineNamed("before") + "\n" + R"({"model":"broken","status":2)" + "\n" +
            lineNamed("after") + "\n";

        const std::vector<LedgerRecord> out = tail.consume(chunk);
        REQUIRE(out.size() == 2);
        CHECK(modelsOf(out) == std::vector<std::string>{ "before", "after" });
        CHECK(tail.skipped() == 1);
    }

    SUBCASE("blank lines are skipped without counting as corruption") {
        LedgerTail tail;
        const std::vector<LedgerRecord> blanks = tail.consume("\n\n\n");
        CHECK(blanks.empty());
        CHECK(tail.skipped() == 0);

        // Interleaved with real lines, the count still stays at zero.
        const std::vector<LedgerRecord> mixed =
            tail.consume("\n" + lineNamed("kept") + "\n" + "\n");
        REQUIRE(mixed.size() == 1);
        CHECK(mixed.front().model == "kept");
        CHECK(tail.skipped() == 0);
    }

    SUBCASE("a whitespace-only line emits no record") {
        LedgerTail tail;
        CHECK(tail.consume("   \n").empty());
        CHECK(tail.consume("\t\n").empty());
    }

    SUBCASE("an unterminated blob past the carry limit is dropped, counted once, and recovered") {
        LedgerTail tail(64);
        const std::string blob(4096, 'x');  // no newline anywhere: pure carry
        CHECK(tail.consume(blob).empty());
        CHECK(tail.skipped() == 1);

        // Everything up to the next newline goes with it — one drop, one count —
        // and the tail resumes cleanly on the following line.
        const std::vector<LedgerRecord> out =
            tail.consume("still-the-same-garbage\n" + lineNamed("recovered") + "\n");
        REQUIRE(out.size() == 1);
        CHECK(out.front().model == "recovered");
        CHECK(tail.skipped() == 1);
    }

    SUBCASE("reset() discards the carry and leaves the skipped count alone") {
        LedgerTail tail;
        CHECK(tail.consume("not json at all\n").empty());
        REQUIRE(tail.skipped() == 1);

        CHECK(tail.consume(R"({"model":"partial","stat)").empty());
        tail.reset();

        // If the carry had survived, the concatenation would be garbage and
        // this record would not exist.
        const std::vector<LedgerRecord> out = tail.consume(lineNamed("after-reset") + "\n");
        REQUIRE(out.size() == 1);
        CHECK(out.front().model == "after-reset");
        CHECK(tail.skipped() == 1);
    }

    SUBCASE("no byte sequence can make consume() throw") {
        LedgerTail tail;
        const std::string withNul = std::string("{\"model\":\"") + '\0' + "\",\"status\":200}\n";
        const std::string invalidUtf8 = std::string("{\"model\":\"\xff\xfe\xfd\"}\n");
        const std::string controlBytes = std::string(1024, '\x01') + "\n";

        std::vector<LedgerRecord> out;
        CHECK_NOTHROW(out = tail.consume(withNul));
        CHECK_NOTHROW(out = tail.consume(invalidUtf8));
        CHECK_NOTHROW(out = tail.consume(controlBytes));
        CHECK_NOTHROW(out = tail.consume(""));

        // Still alive afterwards: the good line that follows the garbage lands.
        CHECK_NOTHROW(out = tail.consume(lineNamed("survivor") + "\n"));
        REQUIRE(out.size() == 1);
        CHECK(out.front().model == "survivor");
    }
}

TEST_CASE(
    "[15.2-tail-cursor] nextRead is the pure follow position: an append reads forward from the "
    "consumed offset, an unchanged size re-reads nothing, and a shrunken file restarts the whole "
    "read from byte 0 — total and noexcept over every input") {
    static_assert(noexcept(nextRead(std::uint64_t{ 0 }, std::uint64_t{ 0 })),
                  "nextRead must be noexcept: it is the one step of the tail loop that runs "
                  "while a file is being replaced under it");
    static_assert(std::is_same_v<decltype(nextRead(std::uint64_t{ 0 }, std::uint64_t{ 0 })),
                                 TailStep>);

    SUBCASE("an append reads forward from where the last read stopped") {
        const TailStep step = nextRead(10, 20);
        CHECK(step.offset == 10);
        CHECK_FALSE(step.restart);
        CHECK(step == TailStep{ 10, false });
    }

    SUBCASE("an unchanged size re-reads nothing, so no record is ever counted twice") {
        const TailStep step = nextRead(4096, 4096);
        CHECK(step.offset == 4096);
        CHECK_FALSE(step.restart);
    }

    SUBCASE("a shrunken file is a replaced file: read it all again and say so") {
        const TailStep truncated = nextRead(4096, 10);
        CHECK(truncated.offset == 0);
        CHECK(truncated.restart);

        // The extreme of the same case: a brand-new empty file where a long one
        // used to be.
        const TailStep emptied = nextRead(1'000'000'000ULL, 0);
        CHECK(emptied.offset == 0);
        CHECK(emptied.restart);
    }

    SUBCASE("a fresh start is not a restart") {
        const TailStep step = nextRead(0, 0);
        CHECK(step.offset == 0);
        CHECK_FALSE(step.restart);
    }

    SUBCASE("the two rules hold over a sweep of offsets and sizes") {
        for (std::uint64_t consumed = 0; consumed <= 8; ++consumed) {
            for (std::uint64_t size = 0; size <= 8; ++size) {
                INFO("consumed ", consumed, " size ", size);
                const TailStep step = nextRead(consumed, size);
                CHECK(step.restart == (size < consumed));
                CHECK(step.offset == (size < consumed ? std::uint64_t{ 0 } : consumed));
            }
        }
    }
}

TEST_CASE(
    "[15.2-aggregate-cumulative] record() folds into cumulative counters whose six shared names "
    "are byte-identical to /conductor/metrics and to router-client.ts's MetricsSummary: exact "
    "counts, sums over non-null values only, statusCounts keyed by the decimal status with no "
    "zero-valued key, and an all-zero empty view") {
    SUBCASE("an empty view reports zeroes and an EMPTY statusCounts") {
        const LedgerView view;
        const LedgerAggregate empty = view.aggregate();
        CHECK(empty.totalRequests == 0);
        CHECK(empty.schemaMissing == 0);
        CHECK(empty.schemaConformed == 0);
        CHECK(empty.statusCounts.empty());
        CHECK(empty.promptTokens == 0);
        CHECK(empty.completionTokens == 0);
        CHECK(view.window().empty());
    }

    SUBCASE("exact hand-computed values over a fixed record set") {
        LedgerView view;

        // Three 200s and one 503, so statusCounts is exactly {"200":3,"503":1}.
        LedgerRecord first = tokenRecord(100, 1000, 7);
        first.schemaMissing = true;
        first.schemaConformed = true;
        view.record(first);

        LedgerRecord second = tokenRecord(21, 500, 3);
        second.schemaMissing = false;  // false contributes 0, exactly like null
        second.schemaConformed = false;
        view.record(second);

        LedgerRecord third = baseRecord(200);  // no tokens at all
        third.schemaConformed = true;
        view.record(third);

        view.record(baseRecord(503));  // the shed line: every column null

        const LedgerAggregate aggregate = view.aggregate();
        CHECK(aggregate.totalRequests == 4);
        CHECK(aggregate.schemaMissing == 1);
        CHECK(aggregate.schemaConformed == 2);
        CHECK(aggregate.promptTokens == 10);
        CHECK(aggregate.completionTokens == 121);

        REQUIRE(aggregate.statusCounts.size() == 2);
        CHECK(aggregate.statusCounts.at("200") == 3);
        CHECK(aggregate.statusCounts.at("503") == 1);
        // No key exists merely because a status could have happened.
        CHECK(aggregate.statusCounts.count("404") == 0);
        CHECK(aggregate.statusCounts.count("502") == 0);
    }

    SUBCASE("token sums are 0, not absent, when no record carries one") {
        LedgerView view;
        view.record(baseRecord(200));
        view.record(baseRecord(503));

        const LedgerAggregate aggregate = view.aggregate();
        CHECK(aggregate.totalRequests == 2);
        CHECK(aggregate.promptTokens == 0);
        CHECK(aggregate.completionTokens == 0);
    }
}

TEST_CASE(
    "[15.2-aggregate-percentiles] waitMsP50/waitMsP95 use /conductor/metrics's own nearest-rank "
    "rule over the queueWaitMs samples in the BOUNDED RECENT WINDOW (SG-C): exact values for a "
    "hand-computed set, 0 when there are no samples, nulls contribute no sample, and record "
    "order never changes the answer") {
    SUBCASE("the hand-computed ten-sample set") {
        // Sorted 1-indexed: rank ceil(0.50*10) == 5 -> 4, rank ceil(0.95*10) == 10 -> 100.
        LedgerView view;
        for (const std::int64_t wait : { 0, 1, 2, 3, 4, 5, 6, 7, 8, 100 })
            view.record(waitRecord(wait));

        const LedgerAggregate aggregate = view.aggregate();
        CHECK(aggregate.waitMsP50 == 4);
        CHECK(aggregate.waitMsP95 == 100);
    }

    SUBCASE("no samples means both percentiles are 0") {
        const LedgerView empty;
        CHECK(empty.aggregate().waitMsP50 == 0);
        CHECK(empty.aggregate().waitMsP95 == 0);

        // A view holding only null-wait records is the same case: N stays 0.
        LedgerView nulls;
        nulls.record(waitRecord(std::nullopt));
        nulls.record(waitRecord(std::nullopt));
        CHECK(nulls.aggregate().totalRequests == 2);
        CHECK(nulls.aggregate().waitMsP50 == 0);
        CHECK(nulls.aggregate().waitMsP95 == 0);
    }

    SUBCASE("a null queueWaitMs contributes no sample and does not change N") {
        LedgerView withNulls;
        LedgerView without;
        for (const std::int64_t wait : { 0, 1, 2, 3, 4, 5, 6, 7, 8, 100 }) {
            withNulls.record(waitRecord(wait));
            withNulls.record(waitRecord(std::nullopt));
            without.record(waitRecord(wait));
        }

        CHECK(withNulls.aggregate().waitMsP50 == without.aggregate().waitMsP50);
        CHECK(withNulls.aggregate().waitMsP95 == without.aggregate().waitMsP95);
        CHECK(withNulls.aggregate().waitMsP50 == 4);
        CHECK(withNulls.aggregate().waitMsP95 == 100);
    }

    SUBCASE("the percentiles are WINDOWED, not whole-history (SG-C)") {
        // Whole history sorted: 0,1,2,3,1000,1000,1000,1000 -> p50 3, p95 1000.
        // Last four only:       0,1,2,3                    -> p50 1, p95 3.
        LedgerView view(4);
        for (const std::int64_t wait : { 1000, 1000, 1000, 1000, 0, 1, 2, 3 })
            view.record(waitRecord(wait));

        const LedgerAggregate aggregate = view.aggregate();
        CHECK(aggregate.totalRequests == 8);  // counts stay cumulative
        CHECK(aggregate.waitMsP50 == 1);
        CHECK(aggregate.waitMsP95 == 3);
        CHECK(aggregate.waitMsP50 != 3);
        CHECK(aggregate.waitMsP95 != 1000);
    }

    SUBCASE("sorting is by value: the same multiset in any order gives the same two numbers") {
        // The window is left at its 200 default so every sample is retained and
        // the only thing varying between the two views is arrival order.
        const std::vector<std::int64_t> samples = { 8, 3, 100, 0, 5, 2, 7, 1, 6, 4 };

        LedgerView ascending;
        std::vector<std::int64_t> sorted = samples;
        std::sort(sorted.begin(), sorted.end());
        for (const std::int64_t wait : sorted)
            ascending.record(waitRecord(wait));

        LedgerView shuffled;
        for (const std::int64_t wait : samples)
            shuffled.record(waitRecord(wait));

        LedgerView descending;
        for (auto it = sorted.rbegin(); it != sorted.rend(); ++it)
            descending.record(waitRecord(*it));

        CHECK(shuffled.aggregate().waitMsP50 == ascending.aggregate().waitMsP50);
        CHECK(shuffled.aggregate().waitMsP95 == ascending.aggregate().waitMsP95);
        CHECK(descending.aggregate().waitMsP50 == ascending.aggregate().waitMsP50);
        CHECK(descending.aggregate().waitMsP95 == ascending.aggregate().waitMsP95);
        CHECK(ascending.aggregate().waitMsP50 == 4);
        CHECK(ascending.aggregate().waitMsP95 == 100);
    }
}

TEST_CASE(
    "[15.2-aggregate-rates] the two derived ratios are defined at their edges: both are "
    "disengaged rather than 0.0 or NaN when their denominator is empty, and a record missing one "
    "half of a pair leaves BOTH sides of that ratio alone so a shed 503 never depresses "
    "throughput") {
    SUBCASE("schemaConformanceRate is verdicts-only and disengaged with no verdict") {
        LedgerView view;
        view.record(verdictRecord(true));
        view.record(verdictRecord(true));
        view.record(verdictRecord(false));
        for (int i = 0; i < 5; ++i)
            view.record(verdictRecord(std::nullopt));

        const LedgerAggregate aggregate = view.aggregate();
        CHECK(aggregate.totalRequests == 8);
        CHECK(aggregate.schemaConformed == 2);
        REQUIRE(aggregate.schemaConformanceRate.has_value());
        CHECK(*aggregate.schemaConformanceRate == doctest::Approx(2.0 / 3.0));

        LedgerView noVerdicts;
        noVerdicts.record(verdictRecord(std::nullopt));
        noVerdicts.record(verdictRecord(std::nullopt));
        CHECK_FALSE(noVerdicts.aggregate().schemaConformanceRate.has_value());
        CHECK_FALSE(LedgerView{}.aggregate().schemaConformanceRate.has_value());
    }

    SUBCASE("completionTokensPerUpstreamSecond is tokens over upstream SECONDS") {
        LedgerView view;
        view.record(tokenRecord(100, 1000));
        view.record(tokenRecord(300, 1000));

        const LedgerAggregate aggregate = view.aggregate();
        REQUIRE(aggregate.completionTokensPerUpstreamSecond.has_value());
        CHECK(*aggregate.completionTokensPerUpstreamSecond == doctest::Approx(200.0));
    }

    SUBCASE("a shed 503 with null columns never depresses the throughput figure") {
        LedgerView view;
        view.record(tokenRecord(100, 1000));
        view.record(tokenRecord(300, 1000));
        view.record(baseRecord(503));  // null tokens, null upstreamMs
        view.record(baseRecord(503));

        const LedgerAggregate aggregate = view.aggregate();
        REQUIRE(aggregate.completionTokensPerUpstreamSecond.has_value());
        CHECK(*aggregate.completionTokensPerUpstreamSecond == doctest::Approx(200.0));
        CHECK(aggregate.totalRequests == 4);
    }

    SUBCASE("half a pair feeds neither side of the ratio, though the sum still counts it") {
        LedgerView view;
        view.record(tokenRecord(100, 1000));
        view.record(tokenRecord(300, 1000));
        view.record(tokenRecord(9999, std::nullopt));   // tokens, no upstream time
        view.record(tokenRecord(std::nullopt, 60000));  // upstream time, no tokens

        const LedgerAggregate aggregate = view.aggregate();
        // The CUMULATIVE token sum takes every non-null value…
        CHECK(aggregate.completionTokens == 10399);
        // …while the RATIO is over the paired records only.
        REQUIRE(aggregate.completionTokensPerUpstreamSecond.has_value());
        CHECK(*aggregate.completionTokensPerUpstreamSecond == doctest::Approx(200.0));
    }

    SUBCASE("a zero upstream total and an empty pair set are both disengaged, never NaN") {
        LedgerView zeroDenominator;
        zeroDenominator.record(tokenRecord(5, 0));
        zeroDenominator.record(tokenRecord(7, 0));
        CHECK(zeroDenominator.aggregate().completionTokens == 12);
        CHECK_FALSE(zeroDenominator.aggregate().completionTokensPerUpstreamSecond.has_value());

        LedgerView noPairs;
        noPairs.record(baseRecord(200));
        noPairs.record(tokenRecord(std::nullopt, 1000));
        CHECK_FALSE(noPairs.aggregate().completionTokensPerUpstreamSecond.has_value());
        CHECK_FALSE(LedgerView{}.aggregate().completionTokensPerUpstreamSecond.has_value());
    }
}

TEST_CASE(
    "[15.2-incremental-equals-batch] the fold is chunk-independent: one record at a time and "
    "arbitrary multi-record batches produce identical aggregates, and the bounded window keeps "
    "ARRIVAL ORDER regardless of how the records were delivered") {
    std::vector<LedgerRecord> sequence;
    sequence.push_back(tokenRecord(100, 1000, 5));
    sequence.push_back(groupRecord("alpha", 200, 3));
    sequence.push_back(verdictRecord(true, true));
    sequence.push_back(baseRecord(503));
    sequence.push_back(tokenRecord(300, 1000, 11));
    sequence.push_back(groupRecord("beta", 503, 40));
    sequence.push_back(verdictRecord(false));
    sequence.push_back(waitRecord(17));
    sequence.push_back(groupRecord("alpha", 200, std::nullopt));
    sequence.push_back(tokenRecord(std::nullopt, 2000, 2));
    sequence.push_back(verdictRecord(true));
    sequence.push_back(waitRecord(std::nullopt, 502));
    for (std::size_t i = 0; i < sequence.size(); ++i)
        sequence[i].model = "seq-" + std::to_string(i);

    LedgerView oneAtATime;
    for (const LedgerRecord& entry : sequence)
        oneAtATime.record(entry);

    LedgerView batched;
    const std::vector<std::size_t> batchSizes = { 1, 2, 3, 4, 2 };
    std::size_t at = 0;
    for (const std::size_t size : batchSizes) {
        const std::vector<LedgerRecord> batch(sequence.begin() + static_cast<std::ptrdiff_t>(at),
                                              sequence.begin() +
                                                  static_cast<std::ptrdiff_t>(at + size));
        batched.record(batch);
        at += size;
    }

    REQUIRE(at == sequence.size());

    const LedgerAggregate one = oneAtATime.aggregate();
    const LedgerAggregate many = batched.aggregate();

    CHECK(one.totalRequests == 12);
    CHECK(many.totalRequests == one.totalRequests);
    CHECK(many.schemaMissing == one.schemaMissing);
    CHECK(many.schemaConformed == one.schemaConformed);
    CHECK(many.statusCounts == one.statusCounts);
    CHECK(many.promptTokens == one.promptTokens);
    CHECK(many.completionTokens == one.completionTokens);
    CHECK(many.waitMsP50 == one.waitMsP50);
    CHECK(many.waitMsP95 == one.waitMsP95);
    CHECK(many.schemaConformanceRate.has_value() == one.schemaConformanceRate.has_value());
    CHECK(many.completionTokensPerUpstreamSecond.has_value() ==
          one.completionTokensPerUpstreamSecond.has_value());
    CHECK(many == one);

    // Arrival order survives batching, which is what makes lanes() and
    // affinity() answer the same way whichever chunking the tail happened to
    // deliver.
    CHECK(batched.window() == oneAtATime.window());
    CHECK(modelsOf(batched.window()) == modelsOf(sequence));
    CHECK(batched.lanes() == oneAtATime.lanes());
    CHECK(batched.affinity() == oneAtATime.affinity());
}

TEST_CASE(
    "[15.2-window-bounded] the window is bounded so a viewer meant to run all day keeps flat "
    "memory: it retains exactly the LAST windowSize records in order, the cumulative counters "
    "still include the evicted ones, and lanes/affinity see only what is retained") {
    SUBCASE("windowSize + K records retain exactly the last windowSize, oldest dropped") {
        constexpr std::size_t kWindow = 5;
        constexpr std::size_t kExtra = 7;

        LedgerView view(kWindow);
        for (std::size_t i = 0; i < kWindow + kExtra; ++i) {
            LedgerRecord entry = baseRecord(200);
            entry.model = "r" + std::to_string(i);
            view.record(entry);
        }

        const std::vector<LedgerRecord> retained = view.window();
        REQUIRE(retained.size() == kWindow);
        CHECK(modelsOf(retained) ==
              std::vector<std::string>{ "r7", "r8", "r9", "r10", "r11" });
    }

    SUBCASE("eviction never touches the cumulative counters") {
        constexpr std::size_t kWindow = 2;

        LedgerView view(kWindow);
        view.record(tokenRecord(10, 1000, 1));  // evicted below
        view.record(tokenRecord(20, 1000, 2));  // evicted below
        view.record(tokenRecord(30, 1000, 3));
        view.record(baseRecord(503));

        const LedgerAggregate aggregate = view.aggregate();
        CHECK(view.window().size() == kWindow);
        CHECK(aggregate.totalRequests == 4);
        CHECK(aggregate.promptTokens == 6);  // includes both evicted records
        CHECK(aggregate.completionTokens == 60);
        REQUIRE(aggregate.statusCounts.size() == 2);
        CHECK(aggregate.statusCounts.at("200") == 3);
        CHECK(aggregate.statusCounts.at("503") == 1);
    }

    SUBCASE("a window of 1 retains exactly the most recent record") {
        LedgerView view(1);
        LedgerRecord older = baseRecord(200);
        older.model = "older";
        LedgerRecord newer = baseRecord(200);
        newer.model = "newer";
        view.record(older);
        view.record(newer);

        const std::vector<LedgerRecord> retained = view.window();
        REQUIRE(retained.size() == 1);
        CHECK(retained.front().model == "newer");
        CHECK(view.aggregate().totalRequests == 2);
    }

    SUBCASE("an evicted record contributes to neither the lanes nor the affinity summary") {
        LedgerView view(2);
        view.record(groupRecord("gone", 200, 500));
        view.record(groupRecord("kept", 200, 1));
        view.record(groupRecord("kept", 200, 2));

        const std::vector<Lane> lanes = view.lanes();
        REQUIRE(lanes.size() == 1);
        CHECK(lanes.front().group == "kept");
        CHECK(lanes.front().completed == 2);
        CHECK(laneFor(lanes, "gone") == nullptr);

        const AffinitySummary affinity = view.affinity();
        CHECK(affinity.taggedRequests == 2);
        CHECK(affinity.runs == 1);
        CHECK(affinity.longestRun == 2);
    }

    SUBCASE("the default window is 200") {
        LedgerView view;
        for (int i = 0; i < 260; ++i)
            view.record(baseRecord(200));

        CHECK(view.window().size() == 200);
        CHECK(view.aggregate().totalRequests == 260);
    }
}

TEST_CASE(
    "[15.2-restart-zeroes] restart() returns the view to its constructed state so a router that "
    "replaced metrics.jsonl produces a reading for the NEW run and never a total spanning two "
    "files; it is idempotent and legal on a never-recorded view") {
    LedgerView view;
    view.record(tokenRecord(100, 1000, 5));
    view.record(groupRecord("alpha", 503, 40));
    view.record(verdictRecord(true, true));
    REQUIRE(view.aggregate().totalRequests == 3);
    REQUIRE_FALSE(view.window().empty());

    view.restart();

    const LedgerAggregate cleared = view.aggregate();
    CHECK(cleared.totalRequests == 0);
    CHECK(cleared.schemaMissing == 0);
    CHECK(cleared.schemaConformed == 0);
    CHECK(cleared.statusCounts.empty());
    CHECK(cleared.promptTokens == 0);
    CHECK(cleared.completionTokens == 0);
    CHECK(cleared.waitMsP50 == 0);
    CHECK(cleared.waitMsP95 == 0);
    CHECK_FALSE(cleared.schemaConformanceRate.has_value());
    CHECK_FALSE(cleared.completionTokensPerUpstreamSecond.has_value());
    CHECK(view.window().empty());
    CHECK(view.lanes().empty());
    CHECK(view.affinity() == AffinitySummary{});

    // A cleared view is field-identical to a freshly constructed one.
    const LedgerView fresh;
    CHECK(cleared == fresh.aggregate());

    SUBCASE("recording after restart() counts from zero") {
        view.record(tokenRecord(7, 1000, 1));
        const LedgerAggregate afterwards = view.aggregate();
        CHECK(afterwards.totalRequests == 1);
        CHECK(afterwards.promptTokens == 1);
        CHECK(afterwards.completionTokens == 7);
        CHECK(view.window().size() == 1);
    }

    SUBCASE("restart() is idempotent and legal on a never-recorded view") {
        view.restart();
        CHECK(view.aggregate() == cleared);
        CHECK(view.window().empty());

        LedgerView untouched;
        CHECK_NOTHROW(untouched.restart());
        CHECK_NOTHROW(untouched.restart());
        CHECK(untouched.aggregate() == cleared);
        CHECK(untouched.lanes().empty());
        CHECK(untouched.affinity() == AffinitySummary{});
    }
}

TEST_CASE(
    "[15.2-lanes] SG-A's lanes pane, built from what the ledger actually carries: one lane per "
    "distinct group in the retained window plus at most one untagged lane, ordered by FIRST "
    "APPEARANCE so the pane never jumps between frames, with per-lane completed/queued/shed and "
    "a lane-local nearest-rank wait p95") {
    SUBCASE("a mixed window: hand-computed lanes in first-appearance order") {
        LedgerView view;
        view.record(groupRecord("alpha", 200, 0));             // 1
        view.record(groupRecord(std::nullopt, 200, 5));        // 2 untagged
        view.record(groupRecord("beta", 503, 12));             // 3
        view.record(groupRecord("alpha", 200, 7));             // 4
        view.record(groupRecord("alpha", 503, std::nullopt));  // 5
        view.record(groupRecord("beta", 200, 0));              // 6

        const std::vector<Lane> lanes = view.lanes();
        REQUIRE(lanes.size() == 3);
        // Never by count: alpha (3) then the untagged lane (1) then beta (2) is
        // first-appearance order, and a count ordering would put beta second.
        CHECK(laneOrder(lanes) == std::vector<std::string>{ "alpha", "", "beta" });

        const Lane* alpha = laneFor(lanes, "alpha");
        REQUIRE(alpha != nullptr);
        CHECK(alpha->completed == 3);
        CHECK(alpha->queued == 1);     // only the 7ms wait is strictly > 0
        CHECK(alpha->shed == 1);
        CHECK(alpha->waitMsP95 == 7);  // samples {0,7}: rank ceil(0.95*2) == 2

        const Lane* untagged = laneFor(lanes, "");
        REQUIRE(untagged != nullptr);
        CHECK(untagged->completed == 1);
        CHECK(untagged->queued == 1);
        CHECK(untagged->shed == 0);
        CHECK(untagged->waitMsP95 == 5);  // one sample: rank ceil(0.95) == 1

        const Lane* beta = laneFor(lanes, "beta");
        REQUIRE(beta != nullptr);
        CHECK(beta->completed == 2);
        CHECK(beta->queued == 1);
        CHECK(beta->shed == 1);
        CHECK(beta->waitMsP95 == 12);  // samples {0,12}: rank 2

        std::int64_t completedTotal = 0;
        for (const Lane& lane : lanes)
            completedTotal += lane.completed;

        CHECK(completedTotal == static_cast<std::int64_t>(view.window().size()));
    }

    SUBCASE("an empty window yields no lanes at all") {
        CHECK(LedgerView{}.lanes().empty());
    }

    SUBCASE("an all-untagged window yields exactly one lane, named with the empty string") {
        LedgerView view;
        view.record(groupRecord(std::nullopt, 200, 0));
        view.record(groupRecord(std::nullopt, 503, 3));
        view.record(groupRecord(std::nullopt, 200, std::nullopt));

        const std::vector<Lane> lanes = view.lanes();
        REQUIRE(lanes.size() == 1);
        CHECK(lanes.front().group.empty());
        CHECK(lanes.front().completed == 3);
        CHECK(lanes.front().queued == 1);
        CHECK(lanes.front().shed == 1);
        CHECK(lanes.front().waitMsP95 == 3);  // samples {0,3}: rank 2
    }

    SUBCASE("an empty-string group is untagged: it shares the one untagged lane") {
        LedgerView view;
        view.record(groupRecord(std::string(), 200, 0));
        view.record(groupRecord(std::nullopt, 200, 0));

        const std::vector<Lane> lanes = view.lanes();
        REQUIRE(lanes.size() == 1);
        CHECK(lanes.front().group.empty());
        CHECK(lanes.front().completed == 2);
    }

    SUBCASE("a lane with no wait samples reports p95 0 rather than inventing one") {
        LedgerView view;
        view.record(groupRecord("quiet", 200, std::nullopt));
        view.record(groupRecord("quiet", 200, std::nullopt));

        const std::vector<Lane> lanes = view.lanes();
        REQUIRE(lanes.size() == 1);
        CHECK(lanes.front().completed == 2);
        CHECK(lanes.front().queued == 0);
        CHECK(lanes.front().waitMsP95 == 0);
    }
}

TEST_CASE(
    "[15.2-affinity-summary] SG-G's observed group-affinity marker over the retained window in "
    "LEDGER order: a run is a maximal block of consecutive same-group records, an untagged "
    "record SPLITS a run, contiguousFollowers is taggedRequests - runs, and hitRate is "
    "disengaged rather than 0.0 when nothing was tagged") {
    const auto summaryOf = [](const std::vector<std::optional<std::string>>& groups) {
        LedgerView view;
        for (const std::optional<std::string>& group : groups)
            view.record(groupRecord(group));

        return view.affinity();
    };

    SUBCASE("[A,A,A]: one run of three, two contiguous followers") {
        const AffinitySummary summary = summaryOf({ "A", "A", "A" });
        CHECK(summary.taggedRequests == 3);
        CHECK(summary.runs == 1);
        CHECK(summary.longestRun == 3);
        CHECK(summary.contiguousFollowers == 2);
        REQUIRE(summary.hitRate.has_value());
        CHECK(*summary.hitRate == doctest::Approx(2.0 / 3.0));
    }

    SUBCASE("[A,B,A,B]: four runs of one, no follower ever landed behind its own group") {
        const AffinitySummary summary = summaryOf({ "A", "B", "A", "B" });
        CHECK(summary.taggedRequests == 4);
        CHECK(summary.runs == 4);
        CHECK(summary.longestRun == 1);
        CHECK(summary.contiguousFollowers == 0);
        REQUIRE(summary.hitRate.has_value());
        CHECK(*summary.hitRate == doctest::Approx(0.0));
    }

    SUBCASE("[A,A,untagged,A]: the untagged record SPLITS the run, it is not a gap to skip") {
        const AffinitySummary summary = summaryOf({ "A", "A", std::nullopt, "A" });
        CHECK(summary.taggedRequests == 3);
        CHECK(summary.runs == 2);
        CHECK(summary.longestRun == 2);
        CHECK(summary.contiguousFollowers == 1);
        REQUIRE(summary.hitRate.has_value());
        CHECK(*summary.hitRate == doctest::Approx(1.0 / 3.0));
    }

    SUBCASE("an all-untagged window: every count 0 and a DISENGAGED rate, never 0.0") {
        const AffinitySummary summary =
            summaryOf({ std::nullopt, std::nullopt, std::nullopt });
        CHECK(summary.taggedRequests == 0);
        CHECK(summary.runs == 0);
        CHECK(summary.longestRun == 0);
        CHECK(summary.contiguousFollowers == 0);
        CHECK_FALSE(summary.hitRate.has_value());

        CHECK(LedgerView{}.affinity() == AffinitySummary{});
    }

    SUBCASE("an empty-string group splits a run exactly as an absent one does") {
        const AffinitySummary summary = summaryOf({ "A", std::string(), "A" });
        CHECK(summary.taggedRequests == 2);
        CHECK(summary.runs == 2);
        CHECK(summary.longestRun == 1);
        CHECK(summary.contiguousFollowers == 0);
        REQUIRE(summary.hitRate.has_value());
        CHECK(*summary.hitRate == doctest::Approx(0.0));
    }

    SUBCASE("contiguousFollowers is exactly taggedRequests - runs over a longer trace") {
        const AffinitySummary summary =
            summaryOf({ "A", "A", "B", "B", "B", "A", std::nullopt, "C", "C" });
        CHECK(summary.taggedRequests == 8);
        CHECK(summary.runs == 4);  // AA | BBB | A | CC
        CHECK(summary.longestRun == 3);
        CHECK(summary.contiguousFollowers == 4);
        CHECK(summary.contiguousFollowers == summary.taggedRequests - summary.runs);
        REQUIRE(summary.hitRate.has_value());
        CHECK(*summary.hitRate == doctest::Approx(4.0 / 8.0));
    }

    SUBCASE("the summary is computed over the WINDOW, in the order records arrived") {
        LedgerView narrow(3);
        narrow.record(groupRecord("A"));
        narrow.record(groupRecord("A"));
        narrow.record(groupRecord("B"));
        narrow.record(groupRecord("B"));
        narrow.record(groupRecord("B"));

        const AffinitySummary summary = narrow.affinity();
        CHECK(summary.taggedRequests == 3);
        CHECK(summary.runs == 1);
        CHECK(summary.longestRun == 3);
        CHECK(summary.contiguousFollowers == 2);
    }
}

TEST_CASE(
    "[15.2-summary-rows] every string the summary pane prints comes from a pure function, so the "
    "formatting is under test and ftxui renders pre-formatted text: exactly ten label/value pairs "
    "in a fixed order, plain decimal integers, ascending-NUMERIC status pairs, one decimal place "
    "on both derived numbers, and a bare '-' wherever there is no data") {
    const std::vector<std::string> kExpectedLabels = {
        "requests",
        "status counts",
        "prompt tokens",
        "completion tokens",
        "wait p50 ms",
        "wait p95 ms",
        "schema missing",
        "schema conformed",
        "schema conformance",
        "tokens/s upstream",
    };

    SUBCASE("a hand-computed aggregate renders every row exactly") {
        LedgerView view;

        LedgerRecord first = tokenRecord(100, 1000, 10);
        first.queueWaitMs = 0;
        first.schemaMissing = true;
        first.schemaConformed = true;
        view.record(first);

        LedgerRecord second = tokenRecord(300, 1000, 20);
        second.queueWaitMs = 5;
        second.schemaConformed = false;
        view.record(second);

        LedgerRecord third = baseRecord(200);
        third.queueWaitMs = 9;
        third.schemaConformed = true;
        view.record(third);

        LedgerRecord fourth = baseRecord(503);
        fourth.queueWaitMs = 40;
        view.record(fourth);

        const std::vector<Row> rows = summaryRows(view.aggregate());
        REQUIRE(rows.size() == 10);
        CHECK(labelsOf(rows) == kExpectedLabels);

        CHECK(valueOf(rows, "requests") == "4");
        CHECK(valueOf(rows, "status counts") == "200:3 503:1");
        CHECK(valueOf(rows, "prompt tokens") == "30");
        CHECK(valueOf(rows, "completion tokens") == "400");
        CHECK(valueOf(rows, "wait p50 ms") == "5");   // waits 0,5,9,40: rank 2
        CHECK(valueOf(rows, "wait p95 ms") == "40");  // rank ceil(0.95*4) == 4
        CHECK(valueOf(rows, "schema missing") == "1");
        CHECK(valueOf(rows, "schema conformed") == "2");
        CHECK(valueOf(rows, "schema conformance") == "66.7%");  // 2/3
        CHECK(valueOf(rows, "tokens/s upstream") == "200.0");   // 400 / 2.0s
    }

    SUBCASE("an empty-view aggregate still yields all ten rows: seven zeroes and three dashes") {
        const std::vector<Row> rows = summaryRows(LedgerView{}.aggregate());
        REQUIRE(rows.size() == 10);
        CHECK(labelsOf(rows) == kExpectedLabels);

        CHECK(valueOf(rows, "requests") == "0");
        CHECK(valueOf(rows, "status counts") == "-");
        CHECK(valueOf(rows, "prompt tokens") == "0");
        CHECK(valueOf(rows, "completion tokens") == "0");
        CHECK(valueOf(rows, "wait p50 ms") == "0");
        CHECK(valueOf(rows, "wait p95 ms") == "0");
        CHECK(valueOf(rows, "schema missing") == "0");
        CHECK(valueOf(rows, "schema conformed") == "0");
        CHECK(valueOf(rows, "schema conformance") == "-");
        CHECK(valueOf(rows, "tokens/s upstream") == "-");
    }

    SUBCASE("integers render as plain decimal with no separators") {
        LedgerAggregate aggregate;
        aggregate.totalRequests = 1234567;
        aggregate.promptTokens = 9876543;
        aggregate.completionTokens = 1000000;
        aggregate.waitMsP50 = 1000;
        aggregate.waitMsP95 = 250000;
        aggregate.schemaMissing = 100000;
        aggregate.schemaConformed = 2500;

        const std::vector<Row> rows = summaryRows(aggregate);
        CHECK(valueOf(rows, "requests") == "1234567");
        CHECK(valueOf(rows, "prompt tokens") == "9876543");
        CHECK(valueOf(rows, "completion tokens") == "1000000");
        CHECK(valueOf(rows, "wait p50 ms") == "1000");
        CHECK(valueOf(rows, "wait p95 ms") == "250000");
        CHECK(valueOf(rows, "schema missing") == "100000");
        CHECK(valueOf(rows, "schema conformed") == "2500");
    }

    SUBCASE("status pairs are ordered by ASCENDING NUMERIC status, not by key text") {
        // Keys are decimal strings, so a lexicographic walk of the map would
        // print "200:1 99:2". The pinned order is numeric.
        LedgerAggregate aggregate;
        aggregate.statusCounts = { { "200", 1 }, { "99", 2 }, { "1000", 3 } };

        const std::vector<Row> rows = summaryRows(aggregate);
        CHECK(valueOf(rows, "status counts") == "99:2 200:1 1000:3");
    }

    SUBCASE("each derived number renders to one decimal place, or a bare dash when absent") {
        LedgerAggregate rounded;
        rounded.schemaConformanceRate = 2.0 / 3.0;
        rounded.completionTokensPerUpstreamSecond = 200.0;
        const std::vector<Row> withValues = summaryRows(rounded);
        CHECK(valueOf(withValues, "schema conformance") == "66.7%");
        CHECK(valueOf(withValues, "tokens/s upstream") == "200.0");

        LedgerAggregate exact;
        exact.schemaConformanceRate = 1.0;
        exact.completionTokensPerUpstreamSecond = 12.34;
        const std::vector<Row> exactRows = summaryRows(exact);
        CHECK(valueOf(exactRows, "schema conformance") == "100.0%");
        CHECK(valueOf(exactRows, "tokens/s upstream") == "12.3");

        LedgerAggregate zeroRate;
        zeroRate.schemaConformanceRate = 0.0;
        zeroRate.completionTokensPerUpstreamSecond = 0.0;
        const std::vector<Row> zeroRows = summaryRows(zeroRate);
        // A real 0 is a number, and must not be confused with the no-data dash.
        CHECK(valueOf(zeroRows, "schema conformance") == "0.0%");
        CHECK(valueOf(zeroRows, "tokens/s upstream") == "0.0");

        const std::vector<Row> absentRows = summaryRows(LedgerAggregate{});
        CHECK(valueOf(absentRows, "schema conformance") == "-");
        CHECK(valueOf(absentRows, "tokens/s upstream") == "-");
    }
}

TEST_CASE(
    "[15.2-header-purity] the aggregation layer is header-only, depends on the standard library "
    "and nlohmann/json and nothing else, and is a pure transform of values handed to it — which "
    "is exactly what lets it be reached from the ftxui-free router-tests target while the "
    "dashboard itself stays an optional build (SG-H)") {
    // The include half of this row is enforced by the preprocessor fence just
    // below this file's includes: ftxui, httplib, spdlog and the schema
    // validator must all be undefined at that point, which they can only be if
    // dashboard/ledger_view.hpp reached for none of them (directly or through a
    // router header). Reaching this case at all means that fence held, and that
    // this translation unit compiled and LINKED into router-tests.

    // The surface half, pinned so the implementer cannot satisfy the tests with
    // a differently-shaped API that happens to compile here.
    static_assert(std::is_same_v<decltype(parseLedgerLine(std::string_view{})),
                                 std::optional<LedgerRecord>>);
    static_assert(std::is_same_v<decltype(std::declval<LedgerTail&>().consume(std::string_view{})),
                                 std::vector<LedgerRecord>>);
    static_assert(
        std::is_same_v<decltype(std::declval<const LedgerTail&>().skipped()), std::uint64_t>);
    static_assert(
        std::is_same_v<decltype(std::declval<const LedgerView&>().aggregate()), LedgerAggregate>);
    static_assert(std::is_same_v<decltype(std::declval<const LedgerView&>().window()),
                                 std::vector<LedgerRecord>>);
    static_assert(
        std::is_same_v<decltype(std::declval<const LedgerView&>().lanes()), std::vector<Lane>>);
    static_assert(
        std::is_same_v<decltype(std::declval<const LedgerView&>().affinity()), AffinitySummary>);
    static_assert(std::is_same_v<decltype(summaryRows(std::declval<const LedgerAggregate&>())),
                                 std::vector<Row>>);

    // The no-I/O half: a path-shaped value is DATA to this layer, never
    // something to open. If any entry point touched the filesystem, this
    // nonexistent path is what it would try to reach.
    static constexpr const char* kNonexistent =
        "/nonexistent-conductor-dashboard-path/does/not/exist/metrics.jsonl";

    LineSpec spec;
    spec.model = kNonexistent;
    spec.group = kNonexistent;

    const std::optional<LedgerRecord> parsed = parseLedgerLine(renderLine(spec));
    REQUIRE(parsed.has_value());
    CHECK(parsed->model == kNonexistent);
    REQUIRE(parsed->group.has_value());
    CHECK(*parsed->group == kNonexistent);
    CHECK_FALSE(std::filesystem::exists(kNonexistent));

    LedgerTail tail;
    LedgerView view;
    std::vector<LedgerRecord> emitted;
    CHECK_NOTHROW(emitted = tail.consume(renderLine(spec) + "\n"));
    REQUIRE(emitted.size() == 1);
    CHECK_NOTHROW(view.record(emitted));
    CHECK(view.aggregate().totalRequests == 1);

    const std::vector<Lane> lanes = view.lanes();
    REQUIRE(lanes.size() == 1);
    CHECK(lanes.front().group == kNonexistent);
    CHECK(summaryRows(view.aggregate()).size() == 10);
}

TEST_CASE(
    "[15.2-optional-target-off-by-default] the CMake wiring this task finally lands (plan line "
    "2759, unbuilt since Task 11.1): a CONDUCTOR_DASHBOARD option defaulting OFF, the "
    "find_package(ftxui) INSIDE that guard so a default configure never needs the port, and "
    "neither llama-router nor router-tests gaining an ftxui link") {
    // The clean-configure half of this row is ORCHESTRATOR-EXECUTED and recorded
    // as a raw transcript; CMakeLists.txt is orchestrator-only and no subagent
    // edits it. What is asserted here is the source-tree contract that transcript
    // depends on, so the wiring is under test rather than resting on a run
    // nobody repeats. A failure here means the CMake edit is missing or shaped
    // differently, not that the aggregation layer is wrong.
    const std::filesystem::path root = repoRoot();
    INFO("repo root: ", root.string());
    REQUIRE(std::filesystem::exists(root / "CMakeLists.txt"));

    const std::string raw = readTextFile(root / "CMakeLists.txt");
    REQUIRE_FALSE(raw.empty());
    const std::string text = collapseWhitespace(stripCMakeComments(raw));

    SUBCASE("the option is declared and defaults OFF") {
        std::string option = cmakeCall(text, "option(CONDUCTOR_DASHBOARD");
        if (option.empty())
            option = cmakeCall(text, "option( CONDUCTOR_DASHBOARD");

        INFO("option call: ", option);
        REQUIRE_FALSE(option.empty());
        CHECK(mentions(option, "CONDUCTOR_DASHBOARD"));

        // option()'s default is its LAST argument, so trimming the closing
        // paren and any padding leaves the default itself — checking that it is
        // OFF rather than merely that "OFF" appears somewhere in the docstring.
        std::string_view trailing(option);
        while (!trailing.empty() && (trailing.back() == ')' || trailing.back() == ' '))
            trailing.remove_suffix(1);

        INFO("option default: '", std::string(trailing), "'");
        REQUIRE(trailing.size() >= 3);
        CHECK(trailing.substr(trailing.size() - 3) == "OFF");
    }

    SUBCASE("find_package(ftxui) sits INSIDE the option guard") {
        const std::size_t guard = std::min(text.find("if(CONDUCTOR_DASHBOARD"),
                                           text.find("if (CONDUCTOR_DASHBOARD"));
        INFO("guard at ", guard);
        REQUIRE(guard != std::string::npos);

        const std::size_t ftxui = text.find("find_package(ftxui");
        REQUIRE(ftxui != std::string::npos);
        CHECK(ftxui > guard);
        // No endif() closes the guard before the find_package: the call really
        // is inside it, so a tree without the port still configures.
        CHECK(text.find("endif", guard) > ftxui);
    }

    SUBCASE("the dashboard target is named verbatim and built from dashboard/main.cpp") {
        std::string target = cmakeCall(text, "add_executable(conductor-dashboard");
        if (target.empty())
            target = cmakeCall(text, "add_executable( conductor-dashboard");

        INFO("target call: ", target);
        REQUIRE_FALSE(target.empty());
        CHECK(mentions(target, "dashboard/main.cpp"));
    }

    SUBCASE("neither committed target gains an ftxui link") {
        const std::string routerLinks =
            cmakeCallForTarget(text, "target_link_libraries", "llama-router");
        INFO("llama-router links: ", routerLinks);
        REQUIRE_FALSE(routerLinks.empty());
        CHECK_FALSE(mentions(routerLinks, "ftxui"));

        const std::string testLinks =
            cmakeCallForTarget(text, "target_link_libraries", "router-tests");
        INFO("router-tests links: ", testLinks);
        REQUIRE_FALSE(testLinks.empty());
        CHECK_FALSE(mentions(testLinks, "ftxui"));

        // The invariant CMakeLists.txt:61-65 states in prose stays literally
        // true of the router executable too.
        const std::string routerSources = cmakeCallForTarget(text, "add_executable", "llama-router");
        REQUIRE_FALSE(routerSources.empty());
        CHECK_FALSE(mentions(routerSources, "dashboard/"));
    }

    SUBCASE("this suite is wired into the existing router-tests target, not a new one") {
        const std::string testSources = cmakeCallForTarget(text, "add_executable", "router-tests");
        INFO("router-tests sources: ", testSources);
        REQUIRE_FALSE(testSources.empty());
        CHECK(mentions(testSources, "router/tests/dashboard_test.cpp"));
        // A dashboard-only test target would be OFF by default along with the
        // dashboard, leaving the pure functions outside every gate (SG-H).
        CHECK_FALSE(mentions(text, "add_executable(dashboard-tests"));
        CHECK_FALSE(mentions(text, "add_test(NAME dashboard-tests"));
    }
}

TEST_CASE(
    "[15.2-dashboard-builds-and-renders] dashboard/main.cpp exists and is the THIN adapter the "
    "split exists to produce: it does the file I/O and the ftxui rendering, and every number on "
    "screen comes from the pure functions this suite tests rather than from a second computation "
    "living in the viewer") {
    // The build-with--DCONDUCTOR_DASHBOARD=ON, run-against-a-fixture-ledger,
    // append-while-running and press-'q' halves of this row are G4 LIVE checks
    // the orchestrator performs and records verbatim. What is asserted here is
    // the adapter contract those runs exercise: the file must exist, must render
    // from the tested layer, and must not re-derive any of it.
    const std::filesystem::path root = repoRoot();
    const std::filesystem::path main = root / "dashboard" / "main.cpp";
    INFO("expected adapter: ", main.string());
    REQUIRE(std::filesystem::exists(main));

    const std::string text = readTextFile(main);
    REQUIRE_FALSE(text.empty());

    SUBCASE("it renders the tested layer with ftxui and nothing else") {
        CHECK(mentions(text, R"(#include "dashboard/ledger_view.hpp")"));
        CHECK(mentions(text, "#include <ftxui/"));
        CHECK(mentions(text, "conductor::dashboard"));
    }

    SUBCASE("all four panes are fed by the pure functions, not recomputed in the viewer") {
        CHECK(mentions(text, "summaryRows"));  // the summary pane
        CHECK(mentions(text, "lanes("));       // the per-group lanes pane
        CHECK(mentions(text, "affinity("));    // the affinity markers pane
        CHECK(mentions(text, "window("));      // the recent-records tail pane
    }

    SUBCASE("the follow loop is the tested one") {
        CHECK(mentions(text, "nextRead"));  // the cursor, including the restart path
        CHECK(mentions(text, "consume("));  // the partial-line-safe chunk reader
        CHECK(mentions(text, "restart("));  // a replaced file resets rather than freezing
    }

    SUBCASE("the ledger location is never hardcoded and never defaulted") {
        // Quoted because a comment explaining what the viewer tails may well
        // say metrics.jsonl in prose; only a string LITERAL is a second source
        // of truth for a location §2.2 already owns.
        CHECK_FALSE(mentions(text, R"("metrics.jsonl")"));
        CHECK_FALSE(mentions(text, R"(".data/router/metrics.jsonl")"));
        CHECK_FALSE(mentions(text, R"(.data/router/metrics.jsonl")"));
    }
}

TEST_CASE(
    "[15.2-ledger-path-from-config] one source of truth for the ledger location (SG-F): "
    "conductor-dashboard takes the same required --config/--schema pair llama-router takes, "
    "reuses the committed pure parseCli rather than minting a second parser, and resolves the "
    "file as parseRouterConfig(...).metrics.ledgerPath — there is no --ledger flag, no default "
    "and no search path") {
    // The four exit-status transcripts (2 for each usage refusal, 3 for a
    // ConfigError carrying field() verbatim, 0 for a clean run) are LIVE checks
    // the orchestrator records against the built binary. What is asserted here
    // is the resolution chain in the adapter's source, which is what makes those
    // exit codes reachable at all.
    const std::filesystem::path root = repoRoot();
    const std::filesystem::path main = root / "dashboard" / "main.cpp";
    INFO("expected adapter: ", main.string());
    REQUIRE(std::filesystem::exists(main));

    const std::string text = readTextFile(main);
    REQUIRE_FALSE(text.empty());

    SUBCASE("the committed pure CLI parser is reused, not duplicated") {
        // SG-F: the same two required flags llama-router takes, parsed by the
        // same committed pure function, so the dashboard and the router can
        // never disagree about what a valid invocation is.
        CHECK(mentions(text, R"(#include "router/cli.hpp")"));
        CHECK(mentions(text, "parseCli"));
    }

    SUBCASE("the ledger path comes from the parsed config and from nowhere else") {
        CHECK(mentions(text, R"(#include "router/config.hpp")"));
        CHECK(mentions(text, "parseRouterConfig"));
        CHECK(mentions(text, "ledgerPath"));
        CHECK(mentions(text, "ConfigError"));  // the exit-3 path carries field()
        CHECK(mentions(text, "field()"));
    }

    SUBCASE("there is no --ledger flag") {
        // Quoted: a comment may well explain that there is deliberately no such
        // flag, and only a string literal would actually mint one.
        CHECK_FALSE(mentions(text, R"("--ledger")"));
    }

    SUBCASE("a refusal is reported on stderr with the parser's own usage text") {
        // The numeric exit statuses themselves (2 for a usage refusal, 3 for a
        // ConfigError, 0 for --help/--version and a clean quit) are LIVE
        // transcripts the orchestrator records against the built binary; what
        // is checkable from the source is that the refusal path exists and
        // reprints the CliParse the committed parser handed back rather than a
        // usage string of its own.
        CHECK(mentions(text, "std::cerr"));
        CHECK(mentions(text, "usage"));
        CHECK(mentions(text, "error"));
    }
}
