# llama-server upstream contract (Task 11.1 Step 2, executed at Task 12.1)

`WIRE_CONTRACT_VERIFIED: 2026-08-14 12.1 — all six Step 2 items observed; items 1-4 at 11.8 on ornith-9b, items 5-6 on qwen3.6-27b, llama-server 10298`

Every command below is reproduced verbatim with its raw output. Nothing here is reconstructed,
and nothing is inferred from a value that was not printed. Run from the repo root
`/Users/sal/development/vorlac/llama-harness` on macOS arm64 (64 GB), 2026-08-14.

Port 8080 was confirmed free before each server start and confirmed free after the last stop;
no pre-existing server was disturbed and no server this run did not start was killed.

## Task 12.1 — Step 2 live measurement

Every command in this section was run from `/Users/sal/development/vorlac/llama-harness`.

```
STEP2_ITEM_1: 11.8 docs/build/artifacts/11.8-live-smoke.md
STEP2_ITEM_2: 11.8 docs/build/artifacts/11.8-live-smoke.md
STEP2_ITEM_3: 11.8 docs/build/artifacts/11.8-live-smoke.md
STEP2_ITEM_4: 11.8 docs/build/artifacts/11.8-live-smoke.md
STEP2_ITEM_5: 12.1 router/UPSTREAM_CONTRACT.md
STEP2_ITEM_6: 12.1 router/UPSTREAM_CONTRACT.md
BASELINE_SLOT_COUNT_AUTO: 4
EFFECTIVE_SLOT_COUNT: 6
CTX_PER_SLOT_NO_PARALLEL: 8192
CTX_PER_SLOT_WITH_PARALLEL: 1536
CTX_PER_SLOT_PINNED_ARGV: 8192
PER_SLOT_CONTEXT_ARGV: --parallel <slots> --ctx-size 49152
AUTOLOAD_LATENCY_MS: 9120
```

Items 1–4 (the `/v1/models` shape, `response_format` + GBNF constraining, `usage`+`timings` on a
non-stream response, and SSE framing) were observed at Task 11.8 and are recorded in
`docs/build/artifacts/11.8-live-smoke.md` rather than copied here. **They were observed on a
different model** — `ornith-9b` — because 11.8's smoke deliberately used the smallest real chat
model. Items 5 and 6 below are on `qwen3.6-27b`, the G13 model every role actually runs.

### Assets

```
$ .data/tools/llama-server --version
version: 10298 (15586e2d7)

$ ls -la .data/models/qwen3.6-27b/Qwen3.6-27B-Q6_K.gguf
-rw-r--r--@ 1 sal  staff  22523238624 Aug  7 00:22 .data/models/qwen3.6-27b/Qwen3.6-27B-Q6_K.gguf
```

### Item 6 — effective concurrent slot count, and the flag that sets it

Three configurations were started, one at a time. The load-bearing line is llama-server's own
`load_model: initializing, …`.

**(a) No `--parallel` at all** — the default:

```
$ .data/tools/llama-server --model .data/models/qwen3.6-27b/Qwen3.6-27B-Q6_K.gguf \
    --host 127.0.0.1 --port 8080 --ctx-size 8192 --jinja

0.01.658.804 I srv    load_model: initializing, n_slots = 4, n_ctx_slot = 8192, kv_unified = 'true'
0.01.661.327 I srv  llama_server: listening on http://127.0.0.1:8080

$ curl -s http://127.0.0.1:8080/props | python3 -c "import json,sys; print(json.load(sys.stdin)['total_slots'])"
4
```

**(b) `--parallel 6` with the SAME `--ctx-size 8192`:**

```
$ .data/tools/llama-server --model … --ctx-size 8192 --parallel 6 --jinja

0.10.095.546 W llama_context: n_ctx is not divisible by n_seq_max - rounding down to 9216
0.10.511.014 I srv    load_model: initializing, n_slots = 6, n_ctx_slot = 1536, kv_unified = 'false'
```

**(c) The pinned argv — `--parallel 6` with `--ctx-size 49152` (8192 × 6):**

```
$ .data/tools/llama-server --model … --ctx-size 49152 --parallel 6 --jinja

0.01.733.326 I srv    load_model: initializing, n_slots = 6, n_ctx_slot = 8192, kv_unified = 'false'

$ curl -s http://127.0.0.1:8080/props | python3 -c "import json,sys; print(json.load(sys.stdin)['total_slots'])"
6
```

#### FINDING F3 (MAJOR, and it changes Task 12.1's implementation)

**`--ctx-size` is the TOTAL context, divided among slots — not the per-slot context.** Passing
`--parallel 6` alongside an unchanged `--ctx-size 8192` cut each slot's window from **8192 to
1536 tokens**, a 5.3× reduction, and silently: llama-server logs it as a rounding notice, not a
warning, and `/props` reports only `total_slots`.

The plan's 12.1 mandates deriving `--parallel <slots>` from `parallel.maxReaders` so that
admission control and the upstream cannot drift. Implemented naively — appending `--parallel N`
to the existing command — that derivation **destroys the context window every sub-session gets**.
A reviewer with a 1536-token window cannot hold a moderate diff, and the failure presents as
poor model output, not as a configuration error.

So the derivation has two halves, and Task 12.1 must implement both:

```
slots      = max(1, parallel.maxReaders)
--parallel = slots
--ctx-size = per_slot_context * slots        # NOT the bare per-slot value
```

Config (c) above is that formula at `per_slot_context = 8192`, and it produced exactly the
intended `n_slots = 6, n_ctx_slot = 8192`.

Also worth recording: `kv_unified` flips from `'true'` to `'false'` the moment `--parallel` is
passed. The default configuration shares one KV cache across 4 slots; the parallel configuration
partitions it.

#### Concurrency behaviour at 6 slots

Eight identical 24-token completions, issued from a thread pool, config (c):

```
$ python3 concur.py
N=1  wall=1.62s  per-request=[1.62]
N=2  wall=2.26s  per-request=[2.26, 2.26]
N=4  wall=4.85s  per-request=[4.79, 4.85, 4.79, 4.79]
N=6  wall=6.17s  per-request=[6.12, 6.12, 6.17, 6.12, 6.12, 6.12]
N=8  wall=7.97s  per-request=[5.74, 5.74, 5.74, 5.74, 7.97, 5.74, 5.74, 7.97]
```

Two things this shows, and they pull in opposite directions:

- **The slot count is real.** At N=8 against 6 slots, six requests finished together at ~5.7 s
  and exactly two finished later at ~8.0 s — the seventh and eighth waited for a slot. That is
  the queueing 6 slots predicts, and it is why `admission.maxInflightPerModel` must be ≤ this
  number.
- **Slots do not buy throughput on this machine.** Wall-clock rises very nearly linearly with N
  up to 6 (1.62 → 2.26 → 4.85 → 6.17). Decoding is bandwidth-bound, so six concurrent requests
  each run about six times slower rather than six finishing in the time of one. **Parallel
  fan-out here buys pipelining and latency-hiding, not speedup.**

That second point is a measured constraint on §4's read fan-out and on how Phase 14's benchmark
must be read: an arm that issues more concurrent sub-sessions pays for them in wall-clock almost
proportionally. It is not a reason to reduce `maxReaders` — the work still has to happen — but
any claim that fan-out makes the pipeline *faster* on this hardware is not supported by this
measurement.

### Item 5 — autoload latency, MEASURED

```
AUTOLOAD_LATENCY_MS: 9120
```

Item 5 asks for the latency of a request naming a model that is **not currently resident**,
against a server started in router mode. It was first recorded as BLOCKED, then attempted and
discharged; both states are kept in the history because the reason it was blocked was a real
error and is worth reading.

**What was wrong the first time.** An earlier pass recorded `AUTOLOAD_LATENCY_MS: 2040` from a
`--model`-direct start, measuring **cold process startup to first healthy `/health`**. That is a
different quantity from on-demand autoload, and the Task 12.1 test caught it: the row requires
`--models-preset` with `--models-max 1`, and the string `--models-max` appeared nowhere in this
file. The implementer marked the item BLOCKED rather than sprinkling the missing flag into prose
to turn its own test green. That was the correct call and the measurement below is the result.

**The measurement.** Two chat models are installed, so an eviction can be forced:

```
$ .data/tools/llama-server --models-preset .data/configs/llama-models.ini \
    --models-max 1 --host 127.0.0.1 --port 8080

$ python3 autoload.py
cold autoload (9B)           model=ornith-9b        wall=  2936 ms  finish=length
resident, no load            model=ornith-9b        wall=   145 ms  finish=length
autoload + evict (27B)       model=qwen3.6-27b      wall=  9683 ms  finish=length
resident, no load            model=qwen3.6-27b      wall=   563 ms  finish=length

AUTOLOAD_9B_MS=2936  RESIDENT_9B_MS=145  DELTA_9B_MS=2791
AUTOLOAD_27B_MS=9683 RESIDENT_27B_MS=563 DELTA_27B_MS=9120
```

`AUTOLOAD_LATENCY_MS: 9120` is the G13 model's figure — the 27B request's wall clock minus the
same request's resident wall clock, so it is the load cost alone and not the generation. The 9B
figure, 2791 ms, is recorded beside it because the cost scales with the file, not with a constant.

A verbatim exchange, forcing `ornith-9b` back in and evicting the 27B:

```
$ curl -s -w '\nHTTP=%{http_code} total=%{time_total}s\n' \
    -X POST http://127.0.0.1:8080/v1/chat/completions \
    -H 'Content-Type: application/json' \
    -d '{"model":"ornith-9b","messages":[{"role":"user","content":"Say ok."}],"max_tokens":8,"temperature":0}'

{"choices":[{"finish_reason":"length","index":0,"message":{"role":"assistant","content":"",
 "reasoning_content":"Thinking Process:\n1.  **"}}],"created":1786703889,"model":"ornith-9b",
 "system_fingerprint":"b10298-15586e2d7","object":"chat.completion",
 "usage":{"completion_tokens":8,"prompt_tokens":13,"total_tokens":21},
 "timings":{"prompt_n":13,"prompt_ms":98.69,"predicted_n":8,"predicted_ms":104.007}}
HTTP=200 total=2.359449s
```

#### FINDING F4 (MAJOR for how Task 12.1 must be read) — preset mode is a PARENT that spawns CHILD servers

The server log shows what `--models-preset` actually does, and it is not what the flag name
suggests:

```
0.41.415.215 I srv  ensure_model: model name=ornith-9b is not loaded, loading...
0.41.415.218 I srv    unload_lru: models_max limit reached, removing LRU name=qwen3.6-27b
0.41.415.218 I srv        unload: stopping model instance name=qwen3.6-27b
0.41.584.481 I srv          load: spawning server instance with name=ornith-9b on port 55496
0.41.584.730 I srv  ensure_model: waiting until model name=ornith-9b is fully loaded...
[55496] 0.01.973.289 I srv    load_model: initializing, n_slots = 4, n_ctx_slot = 65536, kv_unified = 'true'
0.43.570.375 I srv  proxy_reques: proxying request to model ornith-9b on port 55496
```

The process on port 8080 is a **router**. Each model runs in its own child `llama-server` on its
own ephemeral port, and the parent proxies to it. `--models-max` bounds how many children may be
resident; eviction is LRU.

**This raised a question that had to be settled, because F3's whole derivation depends on it:**
the child's argv is assembled from the preset INI — the `[*]` section plus the model's own
section — so if the parent's `--parallel` and `--ctx-size` did NOT reach the child, then Task
12.1's entire slot derivation would be inert in the only mode `serve.py` uses, and the fan-out
would silently run on llama-server's default 4 slots.

Tested directly rather than assumed. Parent started with `--parallel 6 --ctx-size 49152`:

```
0.02.011.353 I srv          load:   --ctx-size
0.02.011.353 I srv          load:   49152
...
0.02.011.354 I srv          load:   --parallel
0.02.011.354 I srv          load:   6

[56637] 0.00.720.327 I srv    load_model: initializing, n_slots = 6, n_ctx_slot = 8192, kv_unified = 'false'
```

**The parent forwards both, and they OVERRIDE the preset INI.** The ini says
`[ornith-9b] ctx-size = 65536`; the child was started with 49152 and came up with
`n_slots = 6, n_ctx_slot = 8192` — exactly F3's intended result. So Task 12.1's
`parallel_server_args` derivation is effective end to end through preset mode, and that is now
verified rather than hoped. Precedence, recorded: **parent CLI beats the preset file.**

#### A readiness-probe trap worth recording

The obvious probe is wrong:

```
$ curl -s http://127.0.0.1:8080/health          # while the model is still loading
{"error":{"message":"Loading model","type":"unavailable_error","code":503}}
```

`curl -s` **exits 0** on that response, because a 503 is a successful HTTP transaction. A poll
written as `until curl -s …/health; do sleep 5; done` therefore returns instantly and reports a
server that cannot serve. This session made exactly that mistake and caught it only because the
body was printed. Poll on the **body** — `grep -q '"status":"ok"'` — or use `curl -f`. Task
12.1's supervisor and Task 12.2's setup probe both depend on getting this right.

## FINDING F1-CONFIRMED (MAJOR) — the G13 model returns EMPTY content, and there is a fix

Task 11.8 recorded, on `ornith-9b`, that a reasoning model under a tight `max_tokens` spends the
whole budget in `reasoning_content` and returns an empty `content` with status 200. It flagged
that `qwen3.6-27b` should be checked before Task 12.1 fixes any token budgets. It was checked,
and it is worse than the 11.8 note assumed.

```
--- max_tokens=256, response_format json_schema ---
finish_reason=length  completion_tokens=256  reasoning_chars=968
content: ''

--- max_tokens=1024, response_format json_schema ---
finish_reason=length  completion_tokens=1024  reasoning_chars=4024
content: ''
```

On a question as trivial as "Finding 7 claims 2+2=4. Uphold or refute it", **1024 completion
tokens were not enough to reach the first character of the answer.** Every one of them went to
thinking. A schema-validating caller sees an empty string, fails validation, and retries — and
the retry spends the same budget the same way. That is an unbounded-cost failure mode sitting
directly under §3.3's entire fan-out.

**The fix, measured rather than guessed:**

```
--- chat_template_kwargs enable_thinking=false ---
finish_reason=stop  completion_tokens=96  reasoning_chars=0
content: '{\n  "findingId": "mathematical_identity_2_plus_2",\n  "upheld": true, …'
VALID JSON, keys=['findingId', 'reasoning', 'upheld']

--- reasoning_effort=none ---
finish_reason=stop  completion_tokens=96  reasoning_chars=0
VALID JSON, keys=['findingId', 'reasoning', 'upheld']
```

Either `"chat_template_kwargs": {"enable_thinking": false}` or `"reasoning_effort": "none"` turns
a request that could not finish inside 1024 tokens into one that finishes in **96**, with output
that conforms to the declared schema exactly. Both worked identically; both require `--jinja`.

**And the folk remedy does not work:**

```
--- /no_think in the prompt ---
finish_reason=length  completion_tokens=512  reasoning_chars=1843
content: ''
```

Putting `/no_think` in the user message is ignored by this template — it produced the same empty
content. Anyone reaching for the widely-cited prompt-level switch will conclude the model is
broken.

### What this obliges, recorded here rather than silently fixed

Turning thinking off changes model behaviour for every schema-constrained role, and the §2.1
per-role parameter block is Task 12.1/12.2 territory, not this file's. Recorded as a binding:
**the fan-out's structured-output path must send one of the two switches above, and the per-role
token budgets must be set with the thinking phase either disabled or explicitly budgeted for.**
Choosing to leave thinking ON for some role is defensible; leaving it on *by accident*, with a
budget sized for a non-reasoning model, is the failure this measurement exists to prevent.

## `/v1/models` — and it depends on which mode the server was started in

This matters to Task 12.2, whose setup proof fails when `models.default` is absent from
`/v1/models`. The id to match is NOT the same in both modes, and an earlier pass of this document
recorded only one of them.

**Started with `--model <path>` directly**, the OpenAI-shaped `data[0].id` is the **full gguf
path**:

```json
"data": [{ "id": ".data/models/qwen3.6-27b/Qwen3.6-27B-Q6_K.gguf",
           "object": "model", "owned_by": "llamacpp",
           "meta": { "n_ctx": 1536, "n_ctx_train": 262144, "n_params": 26895998464,
                     "size": 22512244736, "ftype": "Q6_K" } }]
```

**Started with `--models-preset` — the mode `scripts/serve.py` actually uses** — the ids are the
preset's **friendly names**, because the parent passes each child an `--alias`:

```
$ curl -s http://127.0.0.1:8080/v1/models | python3 -c "import json,sys; print([m['id'] for m in json.load(sys.stdin)['data']])"
['embeddinggemma-300m', 'ornith-9b', 'qwen3-coder-30b', 'qwen3-coder-next', 'qwen3.6-27b', 'qwen3.6-35b-a3b']
```

So a setup probe matching `models.default` against `/v1/models` sees `qwen3.6-27b` in the mode
that ships, and would only see a gguf path in the `--model`-direct mode nothing in this build
uses. **Task 12.2 should match the friendly id** and treat a path-shaped id as the direct-mode
case. An earlier revision of this file asserted the path form without naming the mode; that was
half the picture and is corrected here.

Also mode-dependent: the response carries BOTH an ollama-style `models[]` array and an
OpenAI-style `data[]` array, and in `--model`-direct mode `data[0].meta.n_ctx` reports the
**per-slot** context (1536 in the run above) — a second, independent way to read F3 off the wire.
In preset mode the list is the preset's contents whether or not a model is resident, so presence
in `/v1/models` does NOT imply the model is loaded.

## What this run does NOT discharge

- The measurement used `--model` directly, not `scripts/serve.py --no-shell`, because serve.py's
  router wiring is Task 12.1's deliverable and did not exist when this was run. The numbers are
  properties of llama-server and its flags, so they transfer; the **serve.py-generated**
  invocation must still be checked against `PER_SLOT_CONTEXT_ARGV` above once it exists.
- `admission.maxInflightPerModel ≤ slot count` (SG-E) is now checkable — the slot count is 6 —
  but no run here drove the router and the upstream together under load.
- Items 1–4 remain observed on `ornith-9b` only. Re-observing them on `qwen3.6-27b` would be
  strictly better; it is not required by any acceptance row and was not done.
