// knn_io.hpp - workload file formats and result serialisation.
//
// READ-ONLY. This header defines the on-disk formats and the exact text shape
// of a results file. The reference solver and the candidate solver both use it
// so that a byte comparison of their outputs is meaningful. Its checksum is
// verified by tools/verify_correctness.py; editing it fails the task.
//
// Formats (little-endian; every supported platform is little-endian):
//
//   base.bin      char[8] "KNNBASE1"
//                 uint32  n          number of base points
//                 uint32  d          dimensions
//                 uint32  seed       generator seed, informational
//                 uint32  reserved   0
//                 float32 values[n*d]  row-major
//
//   queries.bin   char[8] "KNNQRY01"
//                 uint32  nq         number of queries
//                 uint32  d          dimensions, must match base.bin
//                 uint32  k          neighbours to report per query
//                 uint32  reserved   0
//                 float32 values[nq*d]  row-major
//
// Every stored value is an integer in [-64, 63] held as a float. That is not
// decoration: it is what makes this task exactly verifiable. See README.md,
// "Why the arithmetic is exact".
//
// Results file: one line per query, in query order, no header, LF endings:
//
//   <query_index> <id_0> <id_1> ... <id_{m-1}>\n
//
// where m = min(k, n) and the ids are base-point indices ordered by ascending
// distance, ties broken by ascending index. Fields are separated by a single
// space. The file ends with a newline. Comparison is byte-for-byte.

#ifndef KNN_IO_HPP
#define KNN_IO_HPP

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <ios>
#include <stdexcept>
#include <string>
#include <vector>

namespace knnio {

// A dense row-major matrix of float32 values.
struct Matrix {
    std::uint32_t rows = 0;
    std::uint32_t cols = 0;
    std::vector<float> values;  // rows * cols, row-major

    const float* row(std::size_t i) const { return values.data() + i * cols; }
};

struct Workload {
    Matrix base;
    Matrix queries;
    std::uint32_t k = 0;
    std::uint32_t seed = 0;
};

inline void readExact(std::ifstream& in, void* dst, std::size_t bytes,
                      const std::string& path) {
    in.read(static_cast<char*>(dst), static_cast<std::streamsize>(bytes));
    if (static_cast<std::size_t>(in.gcount()) != bytes) {
        throw std::runtime_error("short read on " + path);
    }
}

inline void writeExact(std::ofstream& out, const void* src, std::size_t bytes) {
    out.write(static_cast<const char*>(src), static_cast<std::streamsize>(bytes));
    if (!out) throw std::runtime_error("write failed");
}

// Loads base.bin and queries.bin from a workload directory.
inline Workload loadWorkload(const std::string& dir) {
    Workload w;

    const std::string basePath = dir + "/base.bin";
    std::ifstream bin(basePath, std::ios::binary);
    if (!bin) throw std::runtime_error("cannot open " + basePath);
    char magic[8];
    readExact(bin, magic, 8, basePath);
    if (std::memcmp(magic, "KNNBASE1", 8) != 0) {
        throw std::runtime_error("bad magic in " + basePath);
    }
    std::uint32_t head[4];
    readExact(bin, head, sizeof(head), basePath);
    w.base.rows = head[0];
    w.base.cols = head[1];
    w.seed = head[2];
    w.base.values.resize(static_cast<std::size_t>(w.base.rows) * w.base.cols);
    readExact(bin, w.base.values.data(), w.base.values.size() * sizeof(float), basePath);

    const std::string queryPath = dir + "/queries.bin";
    std::ifstream qin(queryPath, std::ios::binary);
    if (!qin) throw std::runtime_error("cannot open " + queryPath);
    readExact(qin, magic, 8, queryPath);
    if (std::memcmp(magic, "KNNQRY01", 8) != 0) {
        throw std::runtime_error("bad magic in " + queryPath);
    }
    readExact(qin, head, sizeof(head), queryPath);
    w.queries.rows = head[0];
    w.queries.cols = head[1];
    w.k = head[2];
    if (w.queries.cols != w.base.cols) {
        throw std::runtime_error("dimension mismatch between base.bin and queries.bin");
    }
    w.queries.values.resize(static_cast<std::size_t>(w.queries.rows) * w.queries.cols);
    readExact(qin, w.queries.values.data(), w.queries.values.size() * sizeof(float), queryPath);

    return w;
}

// Serialises neighbour ids in the exact format documented above.
// `neighbours` holds nq rows of min(k, n) ids each, laid out row-major with
// `perQuery` ids per row.
inline void writeResults(const std::string& path,
                         const std::vector<std::uint32_t>& neighbours,
                         std::size_t queryCount, std::size_t perQuery) {
    std::string text;
    text.reserve(queryCount * (perQuery + 1) * 8);
    char buf[24];
    for (std::size_t q = 0; q < queryCount; ++q) {
        int len = std::snprintf(buf, sizeof(buf), "%llu",
                                static_cast<unsigned long long>(q));
        text.append(buf, static_cast<std::size_t>(len));
        for (std::size_t j = 0; j < perQuery; ++j) {
            text.push_back(' ');
            len = std::snprintf(buf, sizeof(buf), "%llu",
                                static_cast<unsigned long long>(neighbours[q * perQuery + j]));
            text.append(buf, static_cast<std::size_t>(len));
        }
        text.push_back('\n');
    }
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot open " + path + " for writing");
    writeExact(out, text.data(), text.size());
    out.close();
    if (!out) throw std::runtime_error("failed to close " + path);
}

}  // namespace knnio

#endif  // KNN_IO_HPP
