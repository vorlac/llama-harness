# llama-server upstream contract (Task 11.1 Step 2)

`WIRE_CONTRACT_VERIFIED: <pending — see status>`

## Status: DEFERRED to Task 12.1 (not fabricated, not yet measured)

Task 11.1 Step 1 (build scaffold + schema export) is COMPLETE and green. Step 2 —
the LIVE measurement of llama-server's `/v1` contract and the effective concurrent
slot count — is **deferred to Task 12.1**, honestly and deliberately, for these
reasons:

1. **The plan specifies serve.py as Step 2's vehicle.** Step 2's own text runs the
   probe against `scripts/serve.py --no-shell` (Task 12.1). serve.py is not built
   yet. serve.py is where the correct llama-server invocation is encoded —
   context size, `--parallel <N>`, host/port — and the load-bearing number Step 2
   produces (the effective concurrent slot count) is exactly what serve.py's
   `parallel.maxReaders` / `admission.maxInflightPerModel` must respect. Measuring
   it with hand-guessed flags *before* serve.py exists risks a misleading number,
   which the live-task discipline treats as nearly as harmful as fabrication.
2. **The measurement is consumed at 12.1, not 11.1.** Nothing in the router
   scaffold (11.1) or the router logic tasks (11.2-11.7, which test against a stub
   upstream, not the live model) depends on this number. It is 12.1's config input.

## Assets are confirmed present (so this is a clean deferral, not a hard block)

Observed 2026-08-13 (read-only checks, no server started):
- llama-server binary: `.out/llamacpp/bin/llama-server` (present, prebuilt — NOT
  from the pre-broken extern/llama-cpp submodule build).
- model: `.data/models/qwen3.6-27b/` (present — the §8.4 / plan model for Step 2).

## The exact Step 2 procedure to run at 12.1 (record ONLY observed output)

Once serve.py exists (12.1), run against the live server and record verbatim
command lines + raw output here (M8 rule — fabrication is the single worst
outcome; if it cannot run, record BLOCKED + the commands):

1. `scripts/serve.py --no-shell` (qwen3.6-27b) → then probe `GET /v1/models` (shape
   in router mode).
2. `response_format` / `json_schema` acceptance + GBNF constraining: send a schema'd
   completion, confirm the output conforms.
3. `usage` + `timings` fields present in a NON-stream response.
4. SSE chunk framing for a streamed response.
5. Non-resident-model request: router-mode autoload latency (load visible).
6. **Effective concurrent slot count:** issue N concurrent trivial completions for
   N ∈ {1,2,4,8}, with and without `--parallel`; record where latency starts
   scaling linearly with N. That number feeds `parallel.maxReaders`,
   `admission.maxInflightPerModel`, serve.py `--parallel` (12.1), and acceptance
   row 10. If it is 1, every "6 reviewers in parallel" claim in §4 is false and
   serve.py must set `--parallel` before any of it matters.

## Binding

Recorded as a deferred obligation in docs/build/HANDOFF.md and STATE.json (11.1):
Task 12.1 MUST perform this live measurement and complete this file with a real
`WIRE_CONTRACT_VERIFIED:` stamp before its own acceptance number is trusted.
