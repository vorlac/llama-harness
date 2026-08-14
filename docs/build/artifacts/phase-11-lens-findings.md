# Phase 11 gate — lens findings (Tasks 11.1–11.8, the C++ llama-router)

Run 2026-08-14. Four blind lenses (correctness, protocol-conformance, concurrency,
spec-conformance) plus a red-team-by-data probe, then two refute-biased skeptics per major.
19 agents. Lenses saw the router sources, the doctest suites and the plan's §4.4 and Phase 11
ranges — never each other's findings.

**27 findings: 7 major, 20 minor/nit.** The red-team probe is recorded separately in
`phase-11-redteam-probe.md` and PASSED mechanically.

## The majors — six of seven are ONE defect

Three lenses independently found the same thing. Listed together because reading them as seven
separate problems would badly misstate what the phase actually got wrong.

### PC-1 — Buffered relay returns the upstream's success status with a truncated body when the upstream call fails after headers

`router/router.hpp:938` (lens: ?)

**Reproduction.** Stub upstream answers POST /v1/chat/completions with `HTTP/1.1 200 OK`, `Content-Type: application/json`, `Content-Length: 1000`, writes 300 bytes of the completion JSON, then closes the socket. httplib's client hands those 300 bytes to `content_receiver` (router.hpp:1054-1073) and `client->send` returns false with `Error::Read`; `finished` is set at 1091. The router answers the downstream client `200 OK, Content-Type: application/json, Content-Length: 300` with the 300-byte fragment. `readUsageFromBody` (951) finds no `usage`, so the ledger line records `status:200, promptTokens:null, completionTokens:null`, and `observe_response` returns nullopt so `schemaConformed` is null — the dataset shows a clean 200. The direct path gives the same client a short-read/incomplete-message transport error instead.

The same shape is reachable without any upstream crash: `kRelayTimeoutSeconds = 600` (router.hpp:105) is applied as the client read timeout at 855, and UPSTREAM_CONTRACT.md measures ~6x wall-clock inflation at 6-way fan-out, so a long non-stream review generation that exceeds 600 s is converted from "slow but correct" on the direct path into a 200 carrying a truncated body through th

**Plan.** Plan lines 1638-1639 (§4.4 'transparent pass-through of /v1/*'), 1659-1661 ('the body is returned verbatim either way'), 1663-1670 ('Both make the router able to fail a request the direct path would have served, which contradicts G5'); task 11.3 bullet at line 2793 ('response verbatim incl. status').

### PC-2 — Streaming relay emits the terminating chunk on upstream failure, framing a truncated SSE stream as a complete response

`router/router.hpp:1017` (lens: ?)

**Reproduction.** Stub upstream (or a real llama-server that is killed / drops the slot mid-generation) responds `200 OK, Content-Type: text/event-stream`, emits two `data: {...chat.completion.chunk...}\n\n` events, then closes the connection without ever sending `data: [DONE]\n\n`. Downstream the client reads a status-200 chunked response that terminates cleanly with `0\r\n\r\n` and whose httplib `Result` has `error() == Error::Success`. An OpenAI-compatible SSE client sees a stream that simply stopped and returns the partial (or empty) assistant message as if generation had finished. Against llama-server directly the same failure closes the socket mid-chunk, which surfaces as an incomplete-read error the caller can retry on. The ledger line for the request records `status:200` (set at router.hpp:919), and if the abort happened before the include_usage chunk, `promptTokens`/`completionTokens` are null with no indication the stream was cut.

**Plan.** Plan line 1639 (§4.4 'including SSE streaming (text/event-stream chunks forwarded unbuffered)'), lines 1663-1670 (the router must never make a request fail differently than the direct path), line 1683 ('status' as a metrics column).

### R11-C1 — A streaming upstream that dies mid-generation is relayed downstream as a normally-terminated chunked response

`router/router.hpp:993` (lens: ?)

**Reproduction.** Two threads: the upstream worker (`runUpstreamCall`) and the httplib connection thread (the content provider). Stub upstream on port P: accept, write `HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n`, write ONE chunk carrying `data: {"choices":[{"delta":{"content":"partial"}}]}\n\n`, then close(2) the socket without `data: [DONE]` and without the terminating 0-chunk. Interleaving: the worker's httplib client returns false with `Error::Read`, takes the lock at router.hpp:1080 and sets finished=true/succeeded=false; the provider wakes at 986, sees `complete == true` (it only tested `finished`), and calls `sink.done()` at 1018. Run `curl -N -X POST http://<router>/v1/chat/completions -d '{"model":"m","stream":true}'` — curl exits 0 with a well-formed, fully-terminated chunked body containing only the partial event. Against the same stub with NO router, curl exits 18 ("transfer closed with outstanding read data remaining") and the caller learns the generation was cut off. The metrics ledger line for the router run reads `"status":200`. The router has converted a detectable transport failure into a silently truncated answer on exactly the path §4

**Plan.** plan lines 1636-1665 (§4.4 proxy: SSE chunks forwarded unbuffered) and 1662-1665 ('Both make the router able to fail a request the direct path would have served, which contradicts G5 and makes "--no-router runs the identical process" false'); Phase 11 bullet 2795.

### R11-C2 — Buffered path relays a short-read body as a complete 200 with a Content-Length matching the truncation

`router/router.hpp:943` (lens: ?)

**Reproduction.** Two threads: the upstream worker (`runUpstreamCall`, content_receiver appending to `relay->pending`) and the handler thread parked at router.hpp:938. Stub upstream: write `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 120\r\n\r\n`, write the first 40 bytes of the JSON envelope, then close the socket. The worker's `client->send` returns false (Error::Read) after having fed those 40 bytes through the content_receiver; it sets finished=true at router.hpp:1091; the handler wakes and swaps out the 40 bytes. `curl -i -X POST http://<router>/v1/chat/completions -d '{"model":"m"}'` returns `HTTP/1.1 200 OK` with `Content-Length: 40` and the 40-byte prefix — a perfectly framed response the client cannot distinguish from a complete one at the HTTP layer. Direct against the stub, curl exits 18 and any HTTP client raises IncompleteRead. Additionally `readUsageFromBody` (called at router.hpp:951) silently fails to parse the truncated body, so promptTokens/completionTokens land null while `status` is recorded 200.

**Plan.** plan lines 1637-1639 (§4.4 transparent pass-through of /v1/*) and 1662-1665 (the router must never fail/alter a request the direct path would have served).

### R11-001 — A failed/truncated upstream body is relayed as a complete 200 — relay->succeeded and relay->error are never read on the buffered path

`router/router.hpp:933` (lens: ?)

**Reproduction.** Point the router at a stub upstream that writes `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n`, then writes 80 bytes of the JSON body and closes the socket. POST /v1/chat/completions through the router.

Expected (direct path, no router): the client's HTTP library reports a premature close / content-length mismatch and the caller retries.

Actual: the router answers `200 OK` with `Content-Length: 80` and the 80 truncated bytes — a syntactically complete, successful HTTP response carrying a corrupted body. The metrics line records `status: 200` and null token counts, so the ledger reports a healthy request. For the SSE variant (upstream emits three `data:` chunks then RSTs), the router writes the three chunks, calls `sink.done()`, and the downstream sees a cleanly terminated stream with no error and no `[DONE]` sentinel.

**Plan.** plan:1637-1639 (§4.4 'transparent pass-through … including SSE streaming') and plan:1690-1691 ('the router never enforces process'); the router mints a status of its own in exactly one situation per its own header comment at router/router.hpp:30-31, and a silently completed truncation is neither pass-through nor that one situation.

### R11-01 — A mid-body upstream failure is relayed as a successful, silently truncated response — succeeded/error are recorded and never read once headers arrived

`router/router.hpp:900` (lens: ?)

**Reproduction.** Point the router at an upstream that writes `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n`, then writes 200 bytes of the body and closes the socket (llama-server OOM or a killed worker mid-generation). httplib's content_receiver delivers the 200 bytes, `read_content` fails, `send()` returns false with `Error::Read`. The router answers the client `200 OK` with `Content-Length: 200` and a truncated JSON body, and ledgers `"status": 200`. The client cannot tell it from a complete response and the metrics dataset counts it as a success. The streaming branch has the same defect: router.hpp:993 `complete = relay->finished || relay->cancelled;` then `sink.done()` at router.hpp:1018, so an aborted SSE stream terminates as a clean chunked end.

**Plan.** plan:1637-1639 (§4.4 Proxy: "transparent pass-through of /v1/*"); plan:1685 (§4.4 Fail-soft). router.hpp:29-31 states the router mints a status of its own "in exactly one situation, an upstream it could not reach at all".

### R11-02 — Hard-coded 600 s upstream relay timeout can 502 a non-streaming completion that llama-server would have answered

`router/router.hpp:105` (lens: ?)

**Reproduction.** POST /v1/chat/completions through the router with `"stream": false` and a large `max_tokens` against qwen3.6-27b (UPSTREAM_CONTRACT records that model spending its entire 1024-token budget on reasoning tokens). A non-streaming request produces no socket traffic until generation finishes, so any generation exceeding 600 s of upstream silence returns, from the router, `502 {"error":{"type":"router_upstream_unreachable",...}}` with a ledger line `"status": 502`, while the identical request sent directly to llama-server:8080 returns 200 with the completion. The plan's own per-sub-session budget is 900 000 ms (plan:588), i.e. the harness explicitly contemplates single operations longer than the router's fixed 600 s cut-off, and no config key exists to move it.

**Plan.** plan:1663-1668 ("the router must never fail a request the direct path would have served, or G5's fail-soft direction inverts"); plan:1685 (§4.4 Fail-soft); plan:588 `subSessionTimeoutMs: 900000` vs plan:648 `queueTimeoutMs: 600000`.

## Minors and nits, recorded and non-blocking

| id | sev | file:line | finding |
|---|---|---|---|
| PC-3 | minor | `router/router.hpp:1138` | The 502 envelope types error.code as an integer while the 503 and 400 envelopes type it as a string |
| PC-4 | minor | `router/router.hpp:930` | Response classification keys only on Content-Length presence, so any chunked non-stream response silently skips usage parsing and schema validation |
| PC-5 | minor | `router/router.hpp:327` | SSE usage scanner splits events only on LF LF, so a CRLF-framed stream yields no usage or timings and accumulates 1 MiB per request |
| PC-6 | minor | `router/router.hpp:1104` | A response the upstream sent with no Content-Type is relabelled Content-Type: text/plain by the router |
| PC-7 | nit | `router/router.hpp:142` | Range is forwarded to the upstream and then re-applied downstream, double-slicing a 206 body |
| R11-C3 | minor | `router/metrics.hpp:103` | MetricsLedger holds one mutex across a blocking file flush and across two full sorts of an unbounded sample vector |
| R11-C4 | minor | `router/router.hpp:593` | Router::stop() cannot interrupt handler threads parked in admit() or in the streaming provider's unbounded cv.wait |
| R11-C5 | minor | `router/admission.hpp:124` | admission.maxQueued is one global queue depth shared by all models, so a saturated model A can 503 a queued model B |
| R11-C6 | minor | `router/admission.hpp:149` | A queued Waiter lives on the handler's stack and is unlinked from queue_ only on admit()'s two normal returns |
| R11-C7 | minor | `router/router.hpp:105` | The 600s upstream read timeout is a total time-to-first-byte budget for non-streamed generations, and exceeding it mints a 502 |
| R11-002 | minor | `router/router.hpp:327` | SseUsageScanner splits events on "\n\n" only, so CRLF-framed SSE never yields token counts or timings |
| R11-003 | minor | `router/router.hpp:550` | Listener thread budget uses the scalar maxInflightPerModel, not a sum over model buckets, so ≥3 distinct model values at a full queue can stall GET /v |
| R11-004 | minor | `router/metrics.hpp:137` | waitMsP50 / waitMsP95 mix in requests that never entered the queue, so the published queue-wait percentiles collapse to 0 |
| R11-005 | nit | `router/metrics.hpp:231` | MetricsLedger::waits_ grows without bound and is copied+sorted on every /conductor/metrics poll |
| R11-006 | nit | `router/router.hpp:759` | An admitted slot is unrecoverably leaked if make_shared<AdmissionSlot> throws between admit() returning Admitted and the guard object existing |
| R11-03 | minor | `router/router.hpp:930` | A non-streaming tagged response without an upstream Content-Length is routed down the incremental path, so no conformance verdict is ever produced |
| R11-04 | minor | `router/config.hpp:484` | priorities.* values are accepted as arbitrary JSON numbers and silently truncated to int, unlike the ports and admission integers which are range-chec |
| R11-05 | minor | `CMakeLists.txt:88` | Task 11.1 Step 1's export-schemas pre-build step on the router-tests CMake target was not implemented |
| R11-06 | minor | `router/admission.hpp:119` | The SG-3 empty-model bucket is an independent in-flight counter, so concurrent model-less POSTs let 2x maxInflightPerModel requests reach the upstream |
| R11-07 | nit | `router/schema-observer.hpp:195` | The schema tag is matched case-insensitively while the priority tag is matched case-sensitively |

## Red-team candidates generated (executed separately)

26 malformed request shapes were generated by a dedicated lens. The orchestrator executed a
20-shape set against the committed `observe_request` and recorded the result in
`phase-11-redteam-probe.md`: nothing threw, nothing was rejected.

- **body-not-json-at-all** — expected: PROXY-UNCHANGED, byte-verbatim. tagged=true, schemaMissing=true, schema_missing_count()+1, one warn line. Router mints N
- **valid-json-that-is-not-an-object** — expected: PROXY-UNCHANGED, byte-verbatim. tagged=true, schemaMissing=true, counter +1. plan.model stays empty, so admission bucket
- **empty-body-post** — expected: PROXY-UNCHANGED (an empty body is forwarded as an empty body). tagged=true, schemaMissing=true, counter +1. Admission st
- **response-format-present-but-null** — expected: PROXY-UNCHANGED, byte-verbatim. tagged=true, schemaMissing=true, counter +1. NOT a 400 under the shipped config.
- **json-schema-wrapper-missing-its-schema** — expected: PROXY-UNCHANGED, byte-verbatim. tagged=true, schemaMissing=true (the wrapper is present but declares nothing constrainab
- **schema-that-is-not-valid-json-schema** — expected: PROXY-UNCHANGED, byte-verbatim. tagged=true, schemaMissing=FALSE (a declaration is present, however broken), declaredSch
- **deeply-nested-schema-recursion-depth** — expected: PROXY-UNCHANGED, byte-verbatim, schemaMissing=false. The router MUST survive and MUST answer; schemaConformed may be nul
- **enormous-schema** — expected: PROXY-UNCHANGED, byte-verbatim, schemaMissing=false. Router must stay responsive; /conductor/health and /conductor/metri
- **duplicate-json-keys** — expected: PROXY-UNCHANGED, byte-verbatim (BOTH duplicate keys reach llama-server exactly as sent). tagged=true, schemaMissing=true
- **duplicate-keys-plus-x-conductor-rewrite** — expected: PROXY with the documented single mutation only: x_conductor stripped. tagged=true (from the body fallback), schemaMissin
- **utf8-bom-prefix** — expected: PROXY-UNCHANGED, byte-verbatim INCLUDING the BOM. tagged=true, schemaMissing=FALSE — nlohmann skips a leading BOM, so th
- **utf8-bom-plus-x-conductor** — expected: PROXY with x_conductor stripped; the BOM is silently DROPPED by the re-serialization. tagged=true, schemaMissing=false. 
- **invalid-utf8-bytes-in-a-string** — expected: PROXY-UNCHANGED, byte-verbatim including the invalid bytes. tagged=true, schemaMissing=TRUE — the parse fails so the per
- **invalid-utf8-with-x-conductor-leaking-upstream** — expected: PROXY-UNCHANGED, byte-verbatim — meaning the x_conductor vendor field is NOT stripped and DOES reach llama-server. Asser
- **embedded-nul-raw-and-escaped** — expected: PROXY-UNCHANGED, byte-verbatim, with the NUL preserved and the forwarded Content-Length counting it. tagged=true, schema
- **conductor-tag-headers-present-but-empty** — expected: PROXY-UNCHANGED. All four tags UNSET (not empty strings): tagged=FALSE, schemaMissing=FALSE, counter does NOT advance, l
- **tag-headers-contradicting-the-body** — expected: PROXY with x_conductor stripped. Every tag resolves to the HEADER value: role=reviewer, priority=review, group=run:r-abc
- **model-field-is-an-array** — expected: PROXY-UNCHANGED, byte-verbatim. plan.model is the EMPTY string; admission counts this under the empty-model bucket, admi
- **extremely-long-header-value** — expected: SYMMETRIC-WITH-DIRECT-PATH. At 65536 bytes both the router and llama-server reject at the HTTP layer identically, so thi
- **both-response-format-and-grammar** — expected: PROXY-UNCHANGED, byte-verbatim. schemaMissing=false, declaredSchema = the response_format schema (arm (a) wins and retur
- **schema-tag-value-whitespace-and-case** — expected: PROXY-UNCHANGED. This value is observed UNTAGGED — trailing space defeats the exact-length comparison — so tagged=false,
- **duplicate-conductor-tag-headers** — expected: PROXY-UNCHANGED. Exactly one value per tag must be chosen and it must be the FIRST occurrence: schema=required (tagged, 
- **x-conductor-payload-is-not-an-object** — expected: PROXY with x_conductor STRIPPED anyway, and ZERO tags extracted. All four tags empty, tagged=false, priority column 'int
- **schema-with-a-remote-ref** — expected: PROXY-UNCHANGED, byte-verbatim, schemaMissing=false, schemaConformed NULL. The router must make NO outbound network requ
- **get-v1-models-tagged-required-under-rejectOnMissing** — expected: PROXY-UNCHANGED and 200 from the upstream. tagged=true and schemaMissing=true (a bodyless GET declares nothing), counter
- **schema-tagged-request-that-streams** — expected: PROXY-UNCHANGED with chunks relayed unbuffered. schemaMissing=false, schemaConformed NULL (never true, never false). Exa
