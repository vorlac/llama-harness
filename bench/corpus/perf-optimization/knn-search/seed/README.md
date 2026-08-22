# knn-search — exact k-nearest-neighbour search

The program answers one question: for each query vector, which `k` base points
are closest in Euclidean distance? It answers it correctly and very slowly. The
job is to make it fast while keeping the answer *byte-identical*.

## Layout

```
build.sh                 builds reference + generator (fixed flags) and the solution
run.sh                   runs the solution on the canonical workload
test.sh                  correctness suite, then the speed gate. Exit 0 = pass.
workload.conf            canonical workload shape and the pass thresholds  [read-only]
src/knn_io.hpp           file formats and results serialisation            [read-only]
src/knn_naive.hpp        the reference algorithm - the definition of truth [read-only]
src/knn_reference.cpp    reference driver                                  [read-only]
src/knn_solution.cpp     >>> the file you optimise <<<
tools/gen_workload.cpp   deterministic workload generator                  [read-only]
tools/verify_correctness.py  exact-output test suite                       [read-only]
tools/visible_check.py   build plus the fast half of that suite            [read-only]
tools/unpack_sample.py   decodes sample/*.b64 into sample/*.bin            [read-only]
tools/bench.py           benchmark harness                                 [read-only]
tools/checksums.txt      guard over the read-only files                    [read-only]
sample/                  small committed workload + its expected output    [read-only]
data/                    generated workloads (regenerable, not committed)
out/                     results files (not committed)
```

Nothing in this workspace carries an execute bit, so every script is invoked
through its interpreter: `bash build.sh`, `bash run.sh`, `bash test.sh`,
`python3 tools/...`.

`sample/base.bin` and `sample/queries.bin` are raw float32 matrices and reach
the workspace as the base64 files beside them. `tools/unpack_sample.py` decodes
them, `build.sh` calls it first, and the decoded bytes are checked against
`tools/checksums.txt`, so the two forms cannot drift apart.

## Quick start

```sh
python3 tools/visible_check.py   # build + exact-output probes, a few seconds
bash run.sh                      # generates data/generated on first use
bash test.sh                     # the full gate: correctness + speed
```

`python3 tools/bench.py --no-cache` re-measures the baseline from scratch;
without it the reference timing is reused from `data/bench-cache.json` as long
as the reference binary and the workload are unchanged.

## The rules in one paragraph

Output must be byte-identical to the reference on every workload, including tie
cases. Approximation, sampling, early termination that can miss a true
neighbour, and precomputing or memorising answers are all failures. Any exact
technique is fair game: partial selection instead of a full sort, contiguous
layouts, blocking, precomputed norms with the `||a-b||² = ||a||² + ||b||² - 2a·b`
identity, dropping the square root, SIMD, threads, an exact spatial index.

## Why the arithmetic is exact

Every vector component is an integer in `[-64, 63]` stored as `float`. With
`d ≤ 64` every squared distance is an integer `≤ 64 · 127² = 1032256`, and every
intermediate of the norm/dot-product identity is an integer below `2²⁴`, so
float32 represents all of them exactly. Reordering a sum, using FMA, using SIMD
lanes, accumulating in double, splitting across threads, or switching to the
dot-product identity all produce *bit-identical* distances. Ordering is
therefore fully determined, and byte comparison is a fair test rather than a
floating-point lottery.

## How the speed gate is scored

The gate is a **ratio**, never a wall-clock figure: the reference and the
solution are timed against each other on one machine in one invocation, and
`TARGET_SPEEDUP` in `workload.conf` is the factor the solution has to reach.
Correctness is decided first and separately — a fast wrong answer fails as a
wrong answer.
