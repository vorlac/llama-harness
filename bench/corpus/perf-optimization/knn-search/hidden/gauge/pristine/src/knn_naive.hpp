// knn_naive.hpp - the reference k-nearest-neighbour search.
//
// READ-ONLY. This is the definition of correctness for the task: whatever this
// code prints for a workload is the only accepted answer for that workload. It
// is also the performance baseline. Its checksum is verified by
// tools/verify_correctness.py; editing it fails the task.
//
// The code below is deliberately written the way a first, correct, unoptimised
// implementation gets written. It is honest slowness - no sleeps, no busy
// loops, no padding. Every cycle it burns is spent doing arithmetic or memory
// traffic that a better implementation simply would not need:
//
//   * every base point is copied into a fresh std::vector<float> for each
//     query it is compared against,
//   * the distance routine expands ||a - b||^2 as ||a||^2 + ||b||^2 - 2a.b and
//     recomputes both norms on every call,
//   * every element access goes through std::vector::at(),
//   * all n candidates are pushed into an unreserved vector and the whole
//     vector is sorted, to read the first k entries.
//
// The semantics it defines, which any replacement must reproduce exactly:
//
//   * Distance is Euclidean over the full d dimensions.
//   * Each query reports m = min(k, n) base-point indices.
//   * Ordering is ascending distance; ties are broken by ascending base-point
//     index. std::sort is not stable, so the index is part of the comparator
//     rather than being left to the sort.
//   * Queries are reported in input order, ids space-separated, one line per
//     query. See knn_io.hpp for the byte-level format.

#ifndef KNN_NAIVE_HPP
#define KNN_NAIVE_HPP

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "knn_io.hpp"

namespace knn_naive {

// One (distance, index) pair for one candidate neighbour of one query.
struct Candidate {
    float distance;
    std::uint32_t index;
};

// Ascending distance, ties broken by ascending index.
inline bool closerThan(const Candidate& a, const Candidate& b) {
    if (a.distance != b.distance) return a.distance < b.distance;
    return a.index < b.index;
}

// Copies row `i` out of `m` so callers can work with a plain vector.
inline std::vector<float> getRow(const knnio::Matrix& m, std::size_t i) {
    std::vector<float> row(m.cols);
    for (std::size_t j = 0; j < m.cols; ++j) {
        row[j] = m.values.at(i * m.cols + j);
    }
    return row;
}

inline float squaredNorm(const std::vector<float>& v) {
    float total = 0.0f;
    for (std::size_t j = 0; j < v.size(); ++j) {
        total += v.at(j) * v.at(j);
    }
    return total;
}

inline float dotProduct(const std::vector<float>& a, const std::vector<float>& b) {
    float total = 0.0f;
    for (std::size_t j = 0; j < a.size(); ++j) {
        total += a.at(j) * b.at(j);
    }
    return total;
}

// Euclidean distance between two points.
inline float euclideanDistance(const std::vector<float>& a, const std::vector<float>& b) {
    const float squared = squaredNorm(a) + squaredNorm(b) - 2.0f * dotProduct(a, b);
    return std::sqrt(squared);
}

// Exact k-nearest-neighbour search by linear scan.
//
// Returns nq * min(k, n) ids, row-major, one row per query.
inline std::vector<std::uint32_t> search(const knnio::Workload& w) {
    const std::size_t n = w.base.rows;
    const std::size_t nq = w.queries.rows;
    const std::size_t m = std::min<std::size_t>(w.k, n);

    std::vector<std::uint32_t> results;
    for (std::size_t q = 0; q < nq; ++q) {
        std::vector<float> query = getRow(w.queries, q);

        std::vector<Candidate> candidates;
        for (std::size_t i = 0; i < n; ++i) {
            std::vector<float> point = getRow(w.base, i);
            Candidate c;
            c.distance = euclideanDistance(query, point);
            c.index = static_cast<std::uint32_t>(i);
            candidates.push_back(c);
        }

        std::sort(candidates.begin(), candidates.end(), closerThan);

        for (std::size_t j = 0; j < m; ++j) {
            results.push_back(candidates[j].index);
        }
    }
    return results;
}

}  // namespace knn_naive

#endif  // KNN_NAIVE_HPP
