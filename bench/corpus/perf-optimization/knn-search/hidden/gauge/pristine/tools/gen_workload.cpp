// gen_workload.cpp - deterministic workload generator.
//
// READ-ONLY. Its checksum is verified by tools/verify_correctness.py.
//
//   build/gen_workload --n 400000 --d 32 --queries 1024 --k 10 \
//                      --seed 20260820 --out data/generated
//
// Optional: --pattern clustered|identical   (default clustered)
//           --dup-rate <int>                (default 64; 1-in-N base points is
//                                            an exact copy of an earlier point,
//                                            0 disables duplicates)
//
// Determinism
//   Every value is produced by integer arithmetic on a splitmix64 stream seeded
//   only by --seed, then stored as a float. No floating-point rounding, no
//   locale, no libc RNG, no thread ordering. The same arguments produce
//   byte-identical files on every machine and every compiler.
//
// Value range
//   Components are integers in [-64, 63] stored as float32. That bound is what
//   makes squared distances exactly representable and therefore makes this task
//   verifiable by byte comparison. See README.md.

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {

const int kMinValue = -64;
const int kMaxValue = 63;

struct Rng {
    std::uint64_t state;

    explicit Rng(std::uint64_t seed) : state(seed) {}

    std::uint64_t next() {
        state += 0x9E3779B97F4A7C15ull;
        std::uint64_t z = state;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
        return z ^ (z >> 31);
    }

    // Uniform in [0, bound). bound must be > 0.
    std::uint64_t below(std::uint64_t bound) { return next() % bound; }

    // Uniform integer in [lo, hi], inclusive.
    int range(int lo, int hi) {
        return lo + static_cast<int>(below(static_cast<std::uint64_t>(hi - lo + 1)));
    }
};

int clampValue(int v) {
    if (v < kMinValue) return kMinValue;
    if (v > kMaxValue) return kMaxValue;
    return v;
}

void writeHeader(std::ofstream& out, const char magic[8], std::uint32_t a,
                 std::uint32_t b, std::uint32_t c) {
    const std::uint32_t head[4] = {a, b, c, 0u};
    out.write(magic, 8);
    out.write(reinterpret_cast<const char*>(head), sizeof(head));
}

void writeMatrix(const std::string& path, const char magic[8], std::uint32_t rows,
                 std::uint32_t cols, std::uint32_t extra,
                 const std::vector<float>& values) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) {
        std::cerr << "gen_workload: cannot write " << path << "\n";
        std::exit(1);
    }
    writeHeader(out, magic, rows, cols, extra);
    out.write(reinterpret_cast<const char*>(values.data()),
              static_cast<std::streamsize>(values.size() * sizeof(float)));
    if (!out) {
        std::cerr << "gen_workload: write failed on " << path << "\n";
        std::exit(1);
    }
}

void usage() {
    std::cerr << "usage: gen_workload --n <int> --d <int> --queries <int> --k <int>\n"
                 "                    --seed <int> --out <dir>\n"
                 "                    [--pattern clustered|identical] [--dup-rate <int>]\n";
}

}  // namespace

int main(int argc, char** argv) {
    std::uint32_t n = 0, d = 0, nq = 0, k = 0, seed = 0;
    std::string out;
    std::string pattern = "clustered";
    std::uint64_t dupRate = 64;
    bool haveSeed = false;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        const bool hasValue = (i + 1 < argc);
        if (arg == "--n" && hasValue) {
            n = static_cast<std::uint32_t>(std::strtoul(argv[++i], nullptr, 10));
        } else if (arg == "--d" && hasValue) {
            d = static_cast<std::uint32_t>(std::strtoul(argv[++i], nullptr, 10));
        } else if (arg == "--queries" && hasValue) {
            nq = static_cast<std::uint32_t>(std::strtoul(argv[++i], nullptr, 10));
        } else if (arg == "--k" && hasValue) {
            k = static_cast<std::uint32_t>(std::strtoul(argv[++i], nullptr, 10));
        } else if (arg == "--seed" && hasValue) {
            seed = static_cast<std::uint32_t>(std::strtoul(argv[++i], nullptr, 10));
            haveSeed = true;
        } else if (arg == "--out" && hasValue) {
            out = argv[++i];
        } else if (arg == "--pattern" && hasValue) {
            pattern = argv[++i];
        } else if (arg == "--dup-rate" && hasValue) {
            dupRate = std::strtoull(argv[++i], nullptr, 10);
        } else if (arg == "-h" || arg == "--help") {
            usage();
            return 0;
        } else {
            std::cerr << "gen_workload: unknown or incomplete argument: " << arg << "\n";
            usage();
            return 2;
        }
    }

    if (n == 0 || d == 0 || nq == 0 || k == 0 || out.empty() || !haveSeed) {
        usage();
        return 2;
    }
    if (pattern != "clustered" && pattern != "identical") {
        std::cerr << "gen_workload: unknown pattern: " << pattern << "\n";
        return 2;
    }

    std::filesystem::create_directories(out);

    Rng rng(static_cast<std::uint64_t>(seed) * 0x2545F4914F6CDD1Dull + 0x9E3779B9ull);

    // Cluster centres. One cluster per 2000 points, bounded, so the data has
    // real neighbourhood structure instead of being uniform noise.
    std::uint32_t clusters = n / 2000;
    if (clusters < 1) clusters = 1;
    if (clusters > 512) clusters = 512;

    std::vector<int> centers(static_cast<std::size_t>(clusters) * d);
    for (std::size_t c = 0; c < clusters; ++c) {
        for (std::uint32_t j = 0; j < d; ++j) {
            centers[c * d + j] = rng.range(-40, 40);
        }
    }

    std::vector<float> base(static_cast<std::size_t>(n) * d);
    std::uint64_t duplicates = 0;

    if (pattern == "identical") {
        std::vector<int> point(d);
        for (std::uint32_t j = 0; j < d; ++j) point[j] = rng.range(kMinValue, kMaxValue);
        for (std::uint32_t i = 0; i < n; ++i) {
            for (std::uint32_t j = 0; j < d; ++j) {
                base[static_cast<std::size_t>(i) * d + j] = static_cast<float>(point[j]);
            }
        }
        duplicates = n > 0 ? n - 1 : 0;
    } else {
        for (std::uint32_t i = 0; i < n; ++i) {
            const std::uint64_t roll = rng.next();
            const bool duplicate =
                (i > 0) && (dupRate > 0) && ((roll % dupRate) == 0);
            if (duplicate) {
                // An exact copy of an earlier point. This is what produces
                // genuine distance ties and therefore exercises the
                // tie-break-by-lower-index rule.
                const std::uint64_t src = rng.below(i);
                std::memcpy(&base[static_cast<std::size_t>(i) * d],
                            &base[static_cast<std::size_t>(src) * d],
                            static_cast<std::size_t>(d) * sizeof(float));
                ++duplicates;
            } else {
                const std::uint64_t c = rng.below(clusters);
                for (std::uint32_t j = 0; j < d; ++j) {
                    const int noise = rng.range(-12, 12) + rng.range(-12, 12);
                    const int v = clampValue(centers[c * d + j] + noise);
                    base[static_cast<std::size_t>(i) * d + j] = static_cast<float>(v);
                }
            }
        }
    }

    std::vector<float> queries(static_cast<std::size_t>(nq) * d);
    for (std::uint32_t q = 0; q < nq; ++q) {
        const std::uint64_t mode = rng.below(8);
        if (mode < 5) {
            // Near a cluster: the common case, a dense neighbourhood.
            const std::uint64_t c = rng.below(clusters);
            for (std::uint32_t j = 0; j < d; ++j) {
                const int noise = rng.range(-18, 18);
                queries[static_cast<std::size_t>(q) * d + j] =
                    static_cast<float>(clampValue(centers[c * d + j] + noise));
            }
        } else if (mode < 7) {
            // An exact copy of a base point: distance 0, plus every duplicate
            // of that point tied with it.
            const std::uint64_t src = rng.below(n);
            std::memcpy(&queries[static_cast<std::size_t>(q) * d],
                        &base[static_cast<std::size_t>(src) * d],
                        static_cast<std::size_t>(d) * sizeof(float));
        } else {
            // Uniform over the whole cube: far from every cluster, so the
            // neighbour set is spread across the dataset.
            for (std::uint32_t j = 0; j < d; ++j) {
                queries[static_cast<std::size_t>(q) * d + j] =
                    static_cast<float>(rng.range(kMinValue, kMaxValue));
            }
        }
    }

    writeMatrix(out + "/base.bin", "KNNBASE1", n, d, seed, base);
    writeMatrix(out + "/queries.bin", "KNNQRY01", nq, d, k, queries);

    std::ofstream meta(out + "/meta.json", std::ios::trunc);
    if (!meta) {
        std::cerr << "gen_workload: cannot write " << out << "/meta.json\n";
        return 1;
    }
    meta << "{\n"
         << "  \"n\": " << n << ",\n"
         << "  \"d\": " << d << ",\n"
         << "  \"queries\": " << nq << ",\n"
         << "  \"k\": " << k << ",\n"
         << "  \"seed\": " << seed << ",\n"
         << "  \"pattern\": \"" << pattern << "\",\n"
         << "  \"dup_rate\": " << dupRate << ",\n"
         << "  \"clusters\": " << clusters << ",\n"
         << "  \"duplicate_points\": " << duplicates << ",\n"
         << "  \"value_range\": [" << kMinValue << ", " << kMaxValue << "]\n"
         << "}\n";
    meta.close();
    if (!meta) {
        std::cerr << "gen_workload: write failed on meta.json\n";
        return 1;
    }

    std::cerr << "gen_workload wrote " << out << " n=" << n << " d=" << d
              << " queries=" << nq << " k=" << k << " seed=" << seed
              << " pattern=" << pattern << " duplicates=" << duplicates << "\n";
    return 0;
}
