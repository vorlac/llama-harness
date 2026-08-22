# log-aggregation — exact per-endpoint/per-minute statistics at speed

`reference/aggregate.py` reads a structured access log and writes one JSON
report. It is correct and it is roughly an order of magnitude slower than it
needs to be: every output section is its own function, and every function
re-reads and re-parses the whole file. The job is to make it fast **without
changing a single byte of what it outputs**.

## Layout

```
FORMAT.md                    the input format and the report contract  [read-only]
reference/aggregate.py       the slow, correct implementation          [read-only]
tools/generate_workload.py   the seeded workload generator             [read-only]
tools/check_correctness.py   the byte-equality suite                   [read-only]
tools/bench.py               the benchmark harness                     [read-only]
sample/sample.log            a 2000-line committed sample              [read-only]
sample/sample-report.json    the reference report for that sample      [read-only]
build.sh  run.sh  test.sh    the three scripts, yours to change
data/                        the generated workload (regenerable, not committed)
out/  bench-out/             run and benchmark output (not committed)
```

Nothing in this workspace carries an execute bit, so every script is invoked
through its interpreter: `bash run.sh`, `bash test.sh`, `python3 tools/...`.
`--candidate "bash run.sh"` is how the suite and the benchmark are pointed at
the candidate.

## Quick start

```sh
python3 tools/check_correctness.py --candidate "bash run.sh"
python3 tools/generate_workload.py --lines 1500000 --seed 20260320 \
    --minutes 240 --out data/access.log
python3 tools/bench.py --input data/access.log --candidate "bash run.sh" --runs 5
bash test.sh
```

The generator is seeded and byte-identical everywhere, so the canonical
workload has a fixed sha256:
`8fe5f0a811ad728b9b6c7e98eb7d66f6486f666c7baea500d456a2176d0b34f7`.

## The bar

Output must be **bit-identical** to the reference — on the committed sample, on
a renamed copy of it, on ten hand-written edge-case fixtures, and on generated
workloads whose seeds move under `--salt`. Not "within a percent", not "the
same values in a different order". Identical bytes.

Speed is a **ratio**, never a wall-clock figure: `tools/bench.py` times the
reference and the candidate against each other on one machine in one
invocation, alternating them, and reports the median-to-median factor. The
required minimum is **6.0x**.

## What is off limits

`reference/aggregate.py` is what you are measured against, and the correctness
suite and the benchmark both execute it. Leave it byte for byte as it is, along
with `FORMAT.md`, `tools/` and `sample/`. Weakening a check is the same as
failing it.

Approximating any statistic fails: p50/p95/p99 are the exact nearest-rank
values FORMAT.md section 4 defines, and no sampling, reservoir, t-digest or
interpolation reproduces them. So does precomputing an answer — keying a cache
off the input's size, hash, name or mtime, or shipping a stored report. The
suite runs the program on data generated for that run, and on a renamed copy of
the sample, which moves `meta.input`.

Standard library only. No network at build time or run time.
