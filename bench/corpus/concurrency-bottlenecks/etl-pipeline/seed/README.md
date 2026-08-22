# etl-pipeline — a producer/consumer ETL job with the bottlenecks left in

A multi-stage record pipeline: parse, validate, normalise, deduplicate, enrich,
filter, delta, aggregate, ordered emit. It reads a newline-delimited event
stream and a small device lookup table, runs every record through the stages of
the data contract, and writes three files — the windowed aggregates, one row
per rejected input line, and a set of run counters.

It is correct and it is slow, in ways that are structural rather than cosmetic.
The job is to make it fast and to make it clean, **without changing a byte of
what it outputs**.

`SPEC.md` is normative: input schema, transformation semantics, output bytes,
ordering rules, CLI and exit codes all come from there.

## Layout

```
SPEC.md                     the data contract                        [read-only]
run.sh                      the scored surface; argument contract in SPEC.md 7.1
build.sh                    interpreter check; nothing to compile
test.sh                     the visible check: run, then verify byte-exactness
etl/                        >>> the pipeline you rewrite <<<
baseline/etl/               a frozen copy of the starting pipeline   [read-only]
tools/gen_workload.py       the seeded workload generator            [read-only]
tools/verify_output.py      independent implementation of SPEC.md    [read-only]
tools/bench.py              the ratio harness                        [read-only]
data/                       generated workloads (regenerable, not committed)
out/  bench-out/            run and benchmark output (not committed)
```

Nothing here carries an execute bit, so every script is invoked through its
interpreter: `bash run.sh`, `bash test.sh`, `python3 tools/...`.

`baseline/etl/` is the denominator of the speed ratio and never runs as part of
the pipeline. Leave it alone, along with `SPEC.md` and `tools/`.

## How the program is laid out

```
etl/
  __main__.py   python3 -m etl
  cli.py        flags, defaults, exit codes, output writing
  config.py     every constant the specification fixes
  pipeline.py   the reader, the transform pool and the collector
  jsonsubset.py the restricted JSON grammar of SPEC.md section 1.1.1
  validation.py the field checks of section 4.4, in specification order
  timestamps.py timestamp grammar, normalisation and rendering
  tags.py       tag canonicalisation
  units.py      fixed-point arithmetic and the unit conversion table
  devices.py    the device lookup table
  aggregate.py  delta tracking and the windowed aggregates
  output.py     the three output files
  escaping.py   the byte escaping the reject file uses
```

Three roles run concurrently: the **reader** turns the event stream into
numbered lines, the **transform pool** runs the stages that do not care about
record order, and the **collector** runs the stages that do. How the work is
divided is not part of the contract — only the bytes are.

## Quick start

```sh
python3 tools/gen_workload.py --out data/small --records 20000 --seed 7 --devices 120
bash test.sh

python3 tools/gen_workload.py --out data/main --records 1200000 --seed 20260820
python3 tools/bench.py --events data/main/events.ndjson \
    --devices data/main/devices.tsv --workers 8 --runs 4
```

Budget disk: the main workload is about 220 MiB of events, and each output
directory is about 60 MiB.

## The bar

Output must be **byte-identical** to what `SPEC.md` defines, which
`tools/verify_output.py --recompute` derives from the inputs with its own
implementation rather than from a stored answer. And the bytes must not depend
on how the work was scheduled: the same input at one worker and at eight must
produce the same three files, which is SPEC.md section 6.

Speed is a **ratio**, never a wall-clock figure:
`S = baseline median / candidate median`, both at 8 workers, on one machine, in
one invocation, with the baseline being the frozen starting implementation
under `baseline/`. `tools/bench.py` measures exactly that.

## Arithmetic

Every quantity is an integer count of milli-units and every division rounds
half away from zero (`units.rdiv`). No stage uses binary floating point, so
there is no formatting or rounding drift to reconcile. The two six-digit
conversion factors in `units.CONVERSIONS` are constants of the specification
rather than physical constants: replacing them with more precise values changes
the output bytes and fails verification.
