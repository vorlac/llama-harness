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
c++ -std=c++23 -O3 tools/membench/membench.cpp -o .out/build/membench
```

`scripts/hostinfo.py` prefers a preset-built binary (newest wins across presets)
and otherwise compiles one on demand into `.out/build/membench`, falling back to a
Python estimate only if that fails too.

```
BENCH=.out/build/clang-relwdebinfo/tools/membench/membench

$BENCH                  # one 512 MiB single-threaded copy
$BENCH --sweep          # relative phase: dst slides, src stays put
$BENCH --sweep-align    # alignment granularity: both slide together
$BENCH --sweep-threads  # thread scaling
$BENCH --sweep-qos      # P-core vs E-core placement
$BENCH --sweep-kernels  # memcpy vs load-only vs store-only vs NEON
$BENCH --json           # machine-readable
```

### What this was built to answer

`hostinfo.py` used to derive bandwidth from `bytes(bytearray(512 MiB))` in
CPython. The question was whether that copy was cache-line aligned, and whether
forcing 128-byte alignment would change the number. Measured on an M4 Max
(Mac16,5, 128-byte line, 16 KiB page), the answer turned out to be that
alignment was the one thing that did *not* matter.

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
it is why the old figure read roughly a third of the real one. Buffers are
therefore pre-faulted outside the clock, and the measuring thread requests
user-interactive QoS, since macOS offers no CPU affinity API and an unpinned
thread that lands on the E-cluster reports a number about the memory system that
is really a statement about the scheduler.

Two smaller methodology notes, both learned the hard way here: the cores idle at
a low clock and take tens of milliseconds to ramp, so without the `--warmup-ms`
burn-in the first configuration in any sweep reads ~25% slow and the sweep looks
like a trend caused by whatever it was varying. And single measurements of the
phase-differing cases are bimodal, so compare medians across interleaved
repetitions rather than trusting one run.
