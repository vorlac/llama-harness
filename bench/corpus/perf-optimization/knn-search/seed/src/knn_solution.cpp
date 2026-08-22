// knn_solution.cpp - THIS IS THE FILE YOU OPTIMISE.
//
// It ships as a thin driver that calls the reference algorithm, so out of the
// box it is correct and exactly as slow as the baseline. Your job is to replace
// the call to knn_naive::search with a fast exact implementation and to keep
// the output byte-identical.
//
// What you may change
//   * this file, freely, including its includes and its main;
//   * any new source or header files you add under src/;
//   * the SOLUTION_FLAGS line in build.sh (compiler flags are yours);
//   * run.sh and test.sh, as long as they keep the command-line contract
//     below and tools/visible_check.py keeps passing.
//
// What you must not change
//   * src/knn_naive.hpp, src/knn_reference.cpp, src/knn_io.hpp,
//     tools/gen_workload.cpp, tools/verify_correctness.py, tools/bench.py,
//     tools/checksums.txt, sample/, workload.conf.
//     Their checksums are verified; a mismatch is an automatic fail.
//
// Command-line contract, which the harness depends on and you must preserve:
//
//   build/knn_solution --workload <dir> --out <file> [--quiet]
//
// Reads <dir>/base.bin and <dir>/queries.bin, writes the results file in the
// format documented in knn_io.hpp, prints "results: <file>" on stdout. Timing
// and any other chatter goes to stderr.

#include <chrono>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <iostream>
#include <string>

#include "knn_io.hpp"
#include "knn_naive.hpp"

namespace {

void usage() {
    std::cerr << "usage: knn_solution --workload <dir> --out <file> [--quiet]\n";
}

// Replace this with your own exact k-NN search.
//
// Contract: returns nq * min(k, n) base-point ids, row-major, one row per
// query, each row ordered by ascending Euclidean distance with ties broken by
// ascending base-point index.
std::vector<std::uint32_t> solve(const knnio::Workload& w) {
    return knn_naive::search(w);
}

}  // namespace

int main(int argc, char** argv) {
    std::string workload;
    std::string out;
    bool quiet = false;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--workload" && i + 1 < argc) {
            workload = argv[++i];
        } else if (arg == "--out" && i + 1 < argc) {
            out = argv[++i];
        } else if (arg == "--quiet") {
            quiet = true;
        } else if (arg == "-h" || arg == "--help") {
            usage();
            return 0;
        } else {
            std::cerr << "unknown argument: " << arg << "\n";
            usage();
            return 2;
        }
    }
    if (workload.empty() || out.empty()) {
        usage();
        return 2;
    }

    try {
        const auto t0 = std::chrono::steady_clock::now();
        const knnio::Workload w = knnio::loadWorkload(workload);
        const auto t1 = std::chrono::steady_clock::now();

        const std::vector<std::uint32_t> neighbours = solve(w);
        const auto t2 = std::chrono::steady_clock::now();

        const std::size_t perQuery =
            w.base.rows == 0 ? 0
                             : std::min<std::size_t>(w.k, w.base.rows);
        const std::filesystem::path outPath(out);
        if (outPath.has_parent_path() && !outPath.parent_path().empty()) {
            std::filesystem::create_directories(outPath.parent_path());
        }
        knnio::writeResults(out, neighbours, w.queries.rows, perQuery);
        const auto t3 = std::chrono::steady_clock::now();

        if (!quiet) {
            const auto ms = [](auto a, auto b) {
                return std::chrono::duration<double, std::milli>(b - a).count();
            };
            std::cerr << "knn_solution n=" << w.base.rows << " d=" << w.base.cols
                      << " queries=" << w.queries.rows << " k=" << w.k
                      << " load_ms=" << ms(t0, t1)
                      << " search_ms=" << ms(t1, t2)
                      << " write_ms=" << ms(t2, t3) << "\n";
        }
        std::cout << "results: " << out << "\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "knn_solution: " << e.what() << "\n";
        return 1;
    }
}
