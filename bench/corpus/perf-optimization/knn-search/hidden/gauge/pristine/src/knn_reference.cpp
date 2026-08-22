// knn_reference.cpp - command-line driver for the reference implementation.
//
// READ-ONLY. This program is both the correctness oracle and the performance
// baseline. Its checksum is verified by tools/verify_correctness.py; editing it
// fails the task.
//
//   build/knn_reference --workload <dir> --out <file> [--quiet]
//
// Reads <dir>/base.bin and <dir>/queries.bin, writes the results file, prints
// "results: <file>" on stdout and a timing line on stderr.

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
    std::cerr << "usage: knn_reference --workload <dir> --out <file> [--quiet]\n";
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

        const std::vector<std::uint32_t> neighbours = knn_naive::search(w);
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
            std::cerr << "knn_reference n=" << w.base.rows << " d=" << w.base.cols
                      << " queries=" << w.queries.rows << " k=" << w.k
                      << " load_ms=" << ms(t0, t1)
                      << " search_ms=" << ms(t1, t2)
                      << " write_ms=" << ms(t2, t3) << "\n";
        }
        std::cout << "results: " << out << "\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "knn_reference: " << e.what() << "\n";
        return 1;
    }
}
