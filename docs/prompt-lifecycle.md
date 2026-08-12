# Life of a single prompt — opencode + qwen under the conductor harness

**Status:** describes the *target* behaviour of the harness specified in
[docs/plans/2026-08-07-conductor-harness-plan.md](plans/2026-08-07-conductor-harness-plan.md).
The plan is not implemented yet (`conductor/` does not exist on disk; `scripts/serve.py`
today wires opencode to `llama-server` and stops there). Read this as the contract the
build is aiming at — every mechanism named here is normative in the plan; section refs
below point at where it is specified.

Audience: you, wanting to see what actually happens between typing a prompt and getting a
commit, and where the qwen models and the wall-clock costs land.

---

## 0. The starting position (what exists today vs. what this adds)

**Today:** `scripts/serve.py` picks a model, launches `llama-server --models-preset
.data/configs/llama-models.ini --models-max N --models-autoload`, writes a session-scoped
`opencode.session.json` pointing opencode's provider `baseURL` at
`http://127.0.0.1:8080/v1`, and drops you into a subshell with `OPENCODE_CONFIG` set. You
`cd` anywhere and run `opencode`. A prompt goes straight to qwen; qwen edits files; nothing
checks it. That is the baseline this whole exercise is measured against.

**With conductor in place:** the same `serve.py` additionally (a) merges
`conductor/opencode-fragment.json` into that session config — which registers the plugin
file path and seven agent definitions — and (b) optionally launches `llama-router` on
:8088 in front of :8080 and points the provider `baseURL` at the router instead. The
harness therefore *travels with the served model*: any workspace you `cd` into is governed,
and nothing is written into the target repo except `.conductor/` (excluded via
`.git/info/exclude`, never the tracked `.gitignore`).

Layers, and which one is allowed to fail:

```
opencode session ──► LAYER 1  conductor TS plugin   ALL enforcement   fail-CLOSED
                        │  (gates, FSM, conductor_* tools, fan-out, ledgers)
                        ▼  HTTP /v1/* + X-Conductor-* headers
                     LAYER 2  llama-router (C++)    wall-clock/wire   fail-SOFT
                        │  (admission, swap batching, group affinity, schema guard)
                        ▼
                     llama-server --models-max N   (qwen3-coder-30b / -next / ornith-9b)
```

`serve.py --no-router` must run the identical process, just slower (plan §0.3, G5).

---

## 1. The one-paragraph version

You type a prompt. The plugin opens a **run** and refuses to let the model do anything
except call `conductor_classify`. A cheap model classifies the prompt (question / trivial /
work) and a skeptic double-checks it. Work prompts get decomposed into small items with
declared file+test scopes, planned, and put through parallel adversarial plan review until
no major finding survives refutation. Then each item walks a fixed TDD state machine —
failing test first (verified red *by the harness*, not claimed), test critiqued by fresh
reviewers who have never seen an implementation, implementation, full verify, six-lens code
review with skeptic refutation, then commit — with items batched into waves that run
concurrently where their file scopes are disjoint. Finally the harness re-runs the full
verify itself and writes a report. The model never advances a state by asserting something;
every transition is a tool call whose handler re-derives the evidence.

---

## 2. Entry — a prompt arrives

| Step | Mechanism | Effect |
|---|---|---|
| You type into opencode | `chat.message` hook | If no active run: create `.conductor/runs/<runId>/`, `run.json` state `INTAKE`, point `current-run.json` at it. If a run *is* live: the prompt is folded into it as orchestrator context (journaled `user.midrun-prompt`) — a new run requires the previous one terminal. |
| Every request thereafter | `experimental.chat.system.transform` | Appends the doctrine pack for that session's role plus a ≤30-line live state block: run state, active item, **the one legal next tool**, open question count, taint count. Restated every single request — process is never "remembered" (G9). |
| Every request thereafter | `chat.params` / `chat.headers` | Role-appropriate sampling (mechanical 0.1, reviewers/skeptics ~0.3, planner 0.7) and the router tags `X-Conductor-Role/-Priority/-Group/-Schema`. |

From this moment the orchestrator session is boxed in: its `edit` permission is `"ask"` and
the plugin rejects every ask not covered by an active `conductor_inline_claim` (G8). The
orchestrator coordinates; it does not write your code.

**First time in a repo:** `conductor_setup` is the only legal tool. It detects a test
command (package.json / CMakeLists+ctest / pyproject / Cargo.toml / go.mod), smoke-spawns
every configured command so a bad command fails now rather than at first verify, asks the
one question it is not allowed to default — git mode (`read-only` / `commit` /
`commit-and-push`) — and writes `.conductor/config.json` (§2.1).

---

## 3. INTAKE — classify, cheaply, and don't trust the classification

`conductor_classify` (the only legal tool) dispatches a sub-session on the **mechanical**
role — `ornith-9b`, temp 0.1, constrained to the CLASSIFICATION schema — then *one*
`skeptic` sub-session (`qwen3-coder-30b`) to cross-check it. Disagreement escalates to
`work`. This costs seconds and exists to stop "everything is trivial" drift.

Three outcomes:

- **question** → the orchestrator just answers. Run state `ANSWERED`, archived. No pipeline,
  no ceremony. ("what does this function do", "why is this test flaky")
- **trivial** → the classifier must return non-empty `proposedFileScope`/`proposedTestScope`;
  the handler re-counts them against `trivialMaxFiles` (default 2) and escalates to `work`
  if over or empty. Otherwise it synthesizes a one-item queue and jumps straight to
  `EXECUTING` — decompose/plan/plan-review are skipped. **The item FSM is not skipped.**
  Trivial compresses fan-out *width* (review lenses merge into 3 sessions), never process.
- **work** → stays in `INTAKE` with the classification recorded; `conductor_decompose`
  becomes the one legal next tool.

---

## 4. The work pipeline (run FSM)

```
INTAKE ─► DECOMPOSED ─► PLANNED ─► PLAN_REVIEWED ─► EXECUTING ─► REPORTED
   ├─► ANSWERED                                          └─► TRIVIAL_DONE
   └─► EXECUTING (trivial)
```

### 4.1 DECOMPOSED — `conductor_decompose`

Dispatches the **planner** role (`qwen3-coder-next`, the largest coding model — judgment
errors here are expensive downstream) with the queue JSON schema and the `decompose.md`
doctrine pack. Each item must carry:

- `fileScope` — declared source write globs (the edit gate *and* the wave scheduler consume
  this),
- `testScope` — non-empty, or the item is rejected outright,
- `acceptance` — phrased as observable checks,
- `dependsOn` — must form a DAG,
- `ponytail` — which minimality rung (`skip`/`reuse`/`stdlib`/…/`minimal-code`) and what
  existing code you checked for reuse. Under `ponytail: "full"` (default), a `minimal-code`
  rung with an empty `reuse` note is **rejected** — you must show you looked.

The handler validates acyclicity, scope non-emptiness, and item size; oversized items get
one bounded re-split round.

### 4.2 PLANNED — `conductor_plan`

Planner again, doctrine `plan.md`: exact paths, bite-sized steps, complete code for
non-obvious steps, and named placeholder defects — "TBD", "add error handling", "similar to
task N" are plan defects *by name*. Output is `plan.md` plus decision records (≥2 real
options scored, §2.7) extracted into `decisions.jsonl`.

### 4.3 PLAN_REVIEWED — `conductor_plan_review`

The first real fan-out. `planReviewers` (default 4) fresh `reviewer` sub-sessions
(`qwen3-coder-next`), one lens each, all reading the same plan+queue prefix:

1. correctness / design soundness
2. completeness vs your original prompt (+ placeholder scan)
3. decomposition quality — item size, scope disjointness, DAG honesty
4. minimality — unrequested abstractions, skipped reuse

Every `major` finding then goes to `skepticsPerFinding` (default 2) **refuters** — fresh
sessions whose job is to *kill* the finding. A finding survives iff upholds ≥ ⌈K/2⌉ (a tie
upholds; a split finding is worth a fix round). Surviving majors are fed back to the
planner, plan revised, round++. Exit on a clean round or at `planReviewMaxRounds` (3) —
where surviving majors become **surfaced questions**, and the run proceeds only on items no
major touches.

Note the run state never regresses: the majors⇒revise⇒re-review loop is internal to the
handler.

---

## 5. EXECUTING — the item state machine

This is where the bulk of the tokens go.

```
PENDING ─► RED ─► TEST_VETTED ─► GREEN ─► VALIDATED ─► REVIEWED ─► PUBLISHED
                                    └─(persistent failure)─► DEBUG ─► surfaced question
```

Each arrow is a `conductor_*` tool whose handler **re-derives the evidence itself** — the
model's claim is never the record (G6).

| Transition | Who does the work | What the handler independently proves |
|---|---|---|
| `conductor_submit_test` → RED | `testWriter` (`qwen3-coder-30b`), edit-gated to the item's `testScope` only | Runs the test. Requires exit ≠ 0 **and** `failureClass: "assertion"`. An import/syntax/collection error is *not* a red — the test never evaluated the behaviour; it goes back to the writer, bounded at 3 attempts. A test that passes immediately is rejected too: either the behaviour already exists (item may be unnecessary — ponytail rung `skip`) or the test is wrong. |
| `conductor_vet_test` → TEST_VETTED | `vetCritics` (3) fresh `reviewer` sessions given the spec + test diff + captured red output — **not** the implementation, because none exists | Structured per-criterion verdicts: asserts observable behaviour not internals; would fail a subtly-wrong implementation (tautology / mock-testing check); right level; pins *this* item's acceptance; anti-pattern scan. `mustFix` → back to the writer. This is the anti-"test-after theater" gate, and it works precisely because no passing code exists to anchor the critics. |
| `conductor_mark_green` → GREEN | `implementer` (`qwen3-coder-30b`), edit-gated to `fileScope` | Re-runs the item test; exit 0 required. The tool call simply fails until the test really passes. Implementer statuses are triaged: `NEEDS_CONTEXT` → supply and re-dispatch; `BLOCKED` escalates more context → stronger model → re-split via `conductor_queue_amend` → surface to you. |
| `conductor_validate` → VALIDATED | harness | Runs the full required scopes (build first where configured — a failed build never runs tests, because tests against a stale artifact are a false green). **Start-stamped**, and a freeze gate denies every source edit while a verify is in flight. Failure drops into the DEBUG protocol (`debug.md`: root cause before fix, one hypothesis at a time, `debugFixCap` = 3 failed fixes ⇒ the architecture question gets surfaced to you). |
| `conductor_item_review` → REVIEWED | 6 fresh `reviewer` sessions + skeptics | Six lenses over the diff+spec+test: **spec/contract**, **correctness**, **guardrail** (security, trust-boundary validation, data-loss — never lazy-able at any ponytail intensity), **test-adequacy** (does the test still honestly pin the change now that the impl exists), **minimality**, **perf**. First five are mandatory and never truncated. All dispatch in parallel for wall-clock, but *adjudication* preserves ordering: surviving spec findings are fixed first, and quality findings from a round that had surviving spec findings are discarded and re-derived (judging not-yet-compliant code is wasted judgment). Findings → skeptic refutation → survivors go back to the implementer with `receive-review.md` doctrine: verify the claim against the code first; disagreement is answered with reasoning and routed through one more skeptic round, never silently accepted. Fix ⇒ re-validate ⇒ re-review, bounded at 3 rounds. |
| `conductor_publish` → PUBLISHED | harness | Stages `fileScope ∪ testScope` (the tests ship in the same commit — they *are* the proof), applies format rules, re-checks verify freshness against staged mtimes (stale ⇒ auto re-verify), and commits with a generated message naming the item and its red proof. **No attribution trailers** (`Co-Authored-By`, `Generated with`, 🤖 are a normative denylist). Pushes only under `commit-and-push`; under `read-only` it writes the prepared batch into the report instead. The model never runs `git commit` — the gate denies it in every spelling; publishing *is* the tool. |

### 5.1 Freshness — the rule that makes "verified" mean something

A verify record is fresh for a commit iff `startedMs >= max(mtimes of the staged behavioral
files)`. Any edit made after the verify *started* was never verified. Combined with the
freeze gate (no edits while a verify runs), this closes the classic "green, then one more
tweak, then commit" hole.

---

## 6. What runs in parallel, and what that costs on this machine

### 6.1 Waves

`nextWave(queue, items, config)` is a pure function: a wave is the maximal set of items that
are dependency-ready, **pairwise fileScope-disjoint** (conservative glob intersection — a
false positive only serializes, never corrupts), and within `maxImplementers`.

| Stage | Fan-out | Isolation |
|---|---|---|
| plan review, item review, test vet, skeptics | up to `maxReaders` (6), **across items** | none needed — read-only |
| test-writing (RED) | wave-wide | test paths disjoint by scope |
| implementation | 1 (`writes: "off"`, the POC default), or wave-wide under `writes: "worktrees"` | git worktree per item |
| validate | serial per tree | verify marker per tree — two verifies in one tree lie |
| publish | serial, item order | the git index is a singleton |

Even with `writes: "off"` you get large overlap: item B's test is being written and vetted
while item A implements.

**The shared-tree quarantine.** A wave sibling's deliberately-red test must not poison
another item's full verify, so `conductor_validate` moves aside the testScope files of every
*other* queue item below GREEN (not just wave siblings — a blocked earlier item's red test
lingers too), restoring them after. The item's own tests are never excluded, and the freeze
gate guarantees the move can't race a writer. The same exclusion applies to the closing
report verify, and it is disclosed in `report.md`.

### 6.2 Model routing and the swap tax

| Role | Model | Why |
|---|---|---|
| planner, reviewer | `qwen3-coder-next` (MXFP4 MoE, 32k ctx) | judgment-heavy |
| orchestrator, implementer, testWriter, skeptic | `qwen3-coder-30b` (A3B Q6_K, 64k ctx) | volume work — good enough with gates + schemas |
| mechanical (classify, summaries) | `ornith-9b` | trivial with a schema; latency matters |

Under `--models-max 1` a role switch is a **full weight unload+reload** (~30 s for a 30 GB
model). Two defences, at different layers:

1. **Scheduler (plugin):** the fan-out engine dispatches in **per-model waves** — every
   queued job for model M launches together, and the next model's wave waits for M to
   drain. This is the same discipline `scripts/benchmark.py` already uses when it groups
   runs by runtime flags.
2. **Router (C++):** the batcher enforces the same ordering at the wire for anything it can
   see queued, so ABAB arrival order dispatches as AABB. It also does admission control
   (cap in-flight per model — 6 concurrent reviewers must not thrash a 30 GB model),
   **group affinity** (same `X-Conductor-Group` requests dequeue contiguously so the huge
   shared prefix — diff + plan + rubric across N reviewers — stays KV-hot; this is the
   single largest wall-clock lever), and a **schema guard**: a request tagged
   `X-Conductor-Schema: required` that carries no `response_format`/`json_schema` is 400'd,
   and non-streaming responses are validated against the declared schema before they get
   back to the plugin.

When `--models-max > 1` and the host has headroom, co-resident models are treated as one
super-wave.

The fan-out engine validates every structured output on receipt *regardless* of the router
(fail-soft, G5), re-prompting with the validation error appended up to 2 retries before
marking the sub-task env-failed.

---

## 7. The gates you will actually notice

Every tool call in every conductor session (orchestrator *and* sub-sessions — the plugin
knows each session's role and item) passes `tool.execute.before`. Deny = a thrown Error
whose message names the violated rule and the legal alternative.

- **phase-order** — any `conductor_*` tool that isn't the legal next one is denied, naming
  the one that is.
- **git policy** — parsed-token matching over a quote-aware tokenizer, never substring
  regex. `git commit`/`push` denied (publishing is a tool); reset/rebase/clean/merge/
  cherry-pick/filter-branch and worktree-discarding `checkout`/`restore` denied outright.
  `git add src/config.ts` and `git log --grep config` still allow — the false-positive
  guards are part of the spec.
- **edit scope** — orchestrator can't touch source; implementers are confined to their
  item's `fileScope`, test-writers to `testScope`; nobody edits `.conductor/**`; nobody
  edits during a live verify. Covers bash write-shapes too (redirects, `tee`, `sed -i`,
  `mv`/`cp` destinations).
- **ask gate** — sub-session questions are rejected at the permission bus and converted into
  either `NEEDS_CONTEXT` (the orchestrator supplies it) or a surfaced question for you, so a
  subagent can never silently stall the run.

A crash *inside* a gate while judging a git command or a file write denies the action
(fail-closed); a crash in a logger or injector never blocks work (fail-open).

**Two deliberate hatches**, both expensive by design:

- `conductor_inline_claim {itemId, reason}` — grants the orchestrator edit permission scoped
  to one item's fileScope, for work where dispatch genuinely costs more than doing (a
  one-line review fix). Records a decision. The item FSM still applies in full: the claim
  changes *who edits*, never *what is enforced*.
- `conductor_override {gate, reason}` — records an anomaly, permanently taints the item, and
  disables exactly one gate for exactly one next action. Taint is listed prominently in the
  final report. There is no bulk or timed override; a gate needing repeated overriding is an
  `env` stop and a conductor bug.

---

## 8. Keeping going, and stopping

opencode has no pre-emptive turn-end hook, so continuation is **re-entry**: on
`session.idle`, if the run is non-terminal and actionable work exists, `continuation.ts`
re-prompts the orchestrator with the exact next tool call — derived from the same
`gates-phase.ts` table that the injection and the deny both use.

The wedge detector: a re-prompt whose resulting run-state signature (hash of `run.json` +
item states) is unchanged increments `futileRePrompts`; any real state change resets it. At
3, the engine records stop `noop` plus a `disengage` anomaly and stops re-prompting. A wedged
loop ends loudly instead of burning tokens overnight. A `halt` file (owner-only; the model
never touches it) records `interrupt` instead.

Closed stop vocabulary: `done`, `noop`, `blocked`, `surfaced`, `env`, `interrupt`.

---

## 9. REPORTED — the close

`conductor_report` requires every item PUBLISHED or explicitly deferred with a reason. The
handler then **re-runs the full verify itself**, fresh and start-stamped
(verification-before-completion made mechanical), and writes `report.md`:

- per item — what shipped, the red proof, review rounds, taint,
- what was deferred and why, plus which test files the closing verify quarantined,
- surfaced questions awaiting you,
- the decision-ledger summary (every ≥2-option scored fork),
- metrics: tokens, wall-clock, parallelism achieved, model swaps (from the router's metrics
  ledger when it's up).

Everything is replayable: `runs/<runId>/journal.jsonl` carries every gate decision, fan-out
dispatch, and schema retry with a `(runId, itemId, sessionID)` correlation triple and a
closed, tested event vocabulary; `conductor/tools/replay.ts` renders it as per-item
swimlanes with denials highlighted. The debuggability bar is explicit: journal + fixtures
must suffice to write the failing test for any "conductor did something weird".

---

## 10. A worked example

> **You:** "the config loader silently ignores unknown keys — it should error, and the CLI
> should print which key and which file."

| Phase | What happens | Roughly |
|---|---|---|
| INTAKE | `ornith-9b` classifies `work` (two subsystems, behavioural change); skeptic agrees | seconds |
| DECOMPOSED | `qwen3-coder-next` returns 2 items: **I1** `src/config/**` + `tests/config/**` — unknown key raises `ConfigError` with key+path; **I2** `src/cli/**` + `tests/cli/**` — CLI renders that error, `dependsOn: [I1]`. Each carries a ponytail rung and a reuse note | ~1 min |
| PLANNED | plan.md with per-item test strategy, alternatives (error-on-first-unknown vs collect-all → recorded decision), risks | ~1 min |
| PLAN_REVIEWED | 4 lenses in parallel. Completeness lens finds a major: "spec says *which file* — I1's acceptance never pins the file path". 2 skeptics uphold it. Planner revises; round 2 clean | ~2 min |
| EXECUTING wave 1 | I2 depends on I1 ⇒ wave = {I1}. testWriter writes `tests/config/unknown_keys.test.*`; harness runs it, gets an assertion failure ⇒ legal RED. 3 critics vet it (one flags "asserts the exception type but not the message contents" ⇒ mustFix ⇒ rewritten, re-vetted). Implementer edits `src/config/**` only; harness re-runs → GREEN. Full verify → VALIDATED. 6 lenses review the diff; guardrail lens notes the error message echoes the raw file path — upheld by skeptics; implementer fixes; re-validate, re-review clean → REVIEWED. Publish stages source+tests, formats, freshness-checks, commits | the bulk |
| EXECUTING wave 2 | I1 PUBLISHED ⇒ wave = {I2}, same walk | |
| REPORTED | Fresh full verify by the handler, `report.md` with both commits, the one recorded decision, zero taint, and the measured token/wall-clock/swap numbers | ~1 min |

Two commits, two proven-red tests, ten-ish independent judgments, and a machine-checkable
paper trail for every one of them — from models that individually would have edited the
config loader, said "all tests pass", and been wrong about it.

---

## 11. Honest limits

- **Gates fire on tool calls made through opencode.** A human (or a script) at a raw
  terminal is ungated. Detection over prevention, documented rather than papered over
  (G7 — `HONEST-LIMITS.md` is where the full list lives).
- **The router is not enforcement.** If it dies, process is identical, just slower.
- **Token cost is the point of the experiment, not a bug.** No gate or review stage may be
  weakened to save tokens; wall-clock is engineered instead (scheduler + router). The POC
  bench (`scripts/conductor_bench.py`, `bench/conductor-tasks.json`) exists to measure the
  quality delta against exactly this cost.
- **Context is 32–64k here, not 200k.** That is why doctrine is injected every request
  rather than stated once, why every obligation is a schema or a gate rather than prose,
  and why review happens in fresh narrow-context sessions instead of one long one.
