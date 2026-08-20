# tools

Standalone measurement tools. They carry no project dependencies, so each one
builds either through the root CMake tree or with a single compiler invocation.

## membench

A memory-bandwidth probe with every confound exposed as a flag.

Every CMake tree in this workspace configures through `CMakePresets.json`, whose
`binaryDir` is `.out/build/<presetName>` — so membench builds there like anything
else, and nothing in the repo writes to a bare `build/`.

```
cmake --preset clang-relwdebinfo                                  # or any preset
cmake --build .out/build/clang-relwdebinfo --target membench      # or, no CMake:
mkdir -p .out/build && c++ -std=c++23 -O3 tools/membench/membench.cpp -o .out/build/membench
```

The preset build lands at `.out/build/<preset>/tools/membench/membench`; the
single-invocation build lands at `.out/build/membench`, which is where
`scripts/hostinfo.py` writes its on-demand copy. The CMake target forces `-O3` even
under a Debug preset — an `-O0` build measures loop overhead rather than the memory
system — so every preset produces a comparable number.

`scripts/hostinfo.py` prefers a preset-built binary (newest wins across presets)
and otherwise compiles one on demand into `.out/build/membench`, falling back to a
Python estimate only if that fails too. Set `MEMBENCH_BIN` to point it at a
specific binary instead. A candidate older than `membench.cpp` is ignored, because
a stale binary silently measures old code.

```
BENCH=.out/build/clang-relwdebinfo/tools/membench/membench

$BENCH                  # one 512 MiB single-threaded copy, best of 7 passes
$BENCH --sweep          # relative phase: dst slides, src stays put
$BENCH --sweep-align    # alignment granularity: both slide together
$BENCH --sweep-threads  # thread scaling
$BENCH --sweep-qos      # P-core vs E-core placement
$BENCH --sweep-kernels  # every kernel at the default alignment
$BENCH --json           # machine-readable
```

Each confound is also a knob, so any single configuration can be measured directly.
`--help` prints the full list.

| flag | default | what it varies |
|---|---|---|
| `--size-mb N` | 512 | buffer size per side, MiB |
| `--passes N` | 7 | timed passes; the best one wins |
| `--threads N` | 1 | worker threads |
| `--src-offset N` / `--dst-offset N` | 0 | bytes each buffer slides off its page |
| `--align N` | — | put both buffers exactly N-aligned, same phase |
| `--kernel K` | `copy` | `copy`, `read`, `write`, and on ARM `neon`, `stnp` |
| `--qos C` | `user-interactive` | core placement; `background` lands on E-cores |
| `--warmup-ms N` | 300 | clock-ramp burn-in before the first run |
| `--fresh-dst` | off | remap the destination each pass, so page faults are timed |
| `--no-prefault` | off | skip the warm-up memset of the destination |

### What this was built to answer

`hostinfo.py`'s Python fallback derives bandwidth from `bytes(bytearray(512 MiB))`
in CPython. The question was whether that copy is cache-line aligned, and whether
forcing 128-byte alignment would change the number. Measured on an M4 Max
(Mac16,5, 128-byte line, 16 KiB page), the answer turned out to be that
alignment is the one thing that does *not* matter.

**Absolute alignment is irrelevant.** Moving both buffers together across
8/16/32/64/128/256/512/1024/4096/16384-byte alignment changes nothing, at any
buffer size — 75.4-76.5 GB/s at 512 MiB, 96.8 GB/s at 1 MiB with the spread
below the timer's resolution. There is no 128-byte cliff to align to.

**Relative phase does matter**, and it is a different thing. What costs
throughput is `src` and `dst` sitting at different offsets *from each other*.
Two buffers both a single byte past a page boundary run at full speed; a
page-aligned source with a destination 32 bytes in gives up 10-15% on the median
and becomes erratic. So `alignas(128)` on one buffer would not have helped —
only aligning both sides to the same phase does.

**The dominant cost was never alignment.** Two other things swamp it:

| variable | effect |
|---|---|
| destination allocated inside the timed region | **3x** — 23 vs 76 GB/s |
| E-core instead of P-core | **6.3x** — 11.9 vs 74.9 GB/s |
| relative phase (`src+0` vs `dst+32`) | ~1.15x, plus heavy variance |
| absolute alignment (64 / 128 / 256) | none measurable |

A fresh 512 MiB mapping is zero-fill-on-demand, so a copy into it pays a
first-touch page fault per page. That is what CPython's `bytes(src)` times, and
it is why the Python fallback reads roughly a third of the real figure — a caveat
the fallback attaches to its own output. Buffers here are therefore
pre-faulted outside the clock, and the measuring thread requests
user-interactive QoS, since macOS offers no CPU affinity API and an unpinned
thread that lands on the E-cluster reports a number about the memory system that
is really a statement about the scheduler.

Two smaller methodology notes, both learned the hard way here: the cores idle at
a low clock and take tens of milliseconds to ramp, so without the `--warmup-ms`
burn-in the first configuration in any sweep reads ~25% slow and the sweep looks
like a trend caused by whatever it was varying. And single measurements of the
phase-differing cases are bimodal, so compare medians across interleaved
repetitions rather than trusting one run.
