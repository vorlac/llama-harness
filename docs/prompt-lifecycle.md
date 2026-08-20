# Life of a single prompt — opencode under the conductor harness

This page follows one prompt from the keystroke to the commit, naming the mechanism at each
step and what it costs. It is a narrative companion to the reference pages: the run and item
state machines are specified in [state machines](developer/state-machines.md), the gate stack
in [gates](developer/gates.md), and every tool's exact contract in
[tool reference](user/tool-reference.md). Section references of the form §N.N point at
[the conductor harness plan](plans/2026-08-07-conductor-harness-plan.md), the immutable
specification the build is derived from.

Audience: you, wanting to see what actually happens between typing a prompt and getting a
commit, and where the wall-clock costs land.

---

## 0. The starting position

`scripts/serve.py` picks a model, launches `llama-server` in its multi-model mode
(`--models-preset .data/configs/llama-models.ini --models-max 1 --models-autoload`, sized for
the harness's fan-out with `--parallel <slots>` and a total `--ctx-size` of 8192 tokens per
slot), writes a session-scoped `.data/configs/opencode.session.json` pointing opencode's
provider `baseURL` at the served endpoint, and drops you into a subshell with `OPENCODE_CONFIG`
set. You `cd` anywhere and run `opencode`.

That session config is not bare. `serve.py` merges `conductor/opencode-fragment.json` into it,
which registers the plugin file and seven agent definitions — orchestrator plus six
sub-session roles — each with `task` (opencode's own sub-agent spawn tool) turned off. And
`serve.py` starts `llama-router` under a restart supervisor and points the provider `baseURL` at
it when the session opens a shell, a `llama-router` binary is found, and the exported
`router/tests/schemas/RouterConfig.schema.json` exists; if any of those is missing it prints a
notice and the session talks to `llama-server` directly, and an explicit `--router` refuses with
the remedy instead. The harness therefore *travels with the served model*: any workspace you
`cd` into is governed,
and nothing is written into the target repo except `.conductor/`, which is excluded through
the repository's common git directory (`info/exclude`), never the tracked `.gitignore`.

Layers, and which one is allowed to fail:

```
opencode session ──► LAYER 1  conductor TS plugin   ALL enforcement   fail-CLOSED
                        │  (gates, FSM, conductor_* tools, fan-out, ledgers)
                        ▼  HTTP /v1/* + X-Conductor-* headers
                     LAYER 2  llama-router (C++)    wall-clock/wire   fail-SOFT
                        │  (admission, group affinity, schema observation, metrics)
                        ▼
                     llama-server (multi-model, --models-max 1)
```

`serve.py --no-router` runs the identical process, just slower (plan §0.3, G5).

---

## 1. The one-paragraph version

You type a prompt. The plugin opens a **run** and refuses to let the model do anything
except call `conductor_classify`. A sub-session classifies the prompt (question / trivial /
work) and a skeptic double-checks it. Work prompts get decomposed into small items with
declared file and test scopes, planned, and put through parallel adversarial plan review until
no major finding survives refutation. Then each item walks a fixed TDD state machine —
failing test first (verified red *by the harness*, not claimed), test critiqued by fresh
reviewers who have never seen an implementation, implementation, full verify, six-lens code
review with skeptic refutation, then commit — with items batched into waves that run
concurrently where their file scopes are disjoint. Finally the harness re-runs the full
verify itself and writes a report. The model never advances a state by asserting something;
every transition is a tool call whose handler re-derives the evidence.

---

## 2. Entry — a prompt arrives

| Step                     | Mechanism                            | Effect                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| You type into opencode   | `chat.message` hook                  | If no active run: create `.conductor/runs/<runId>/`, `run.json` state `INTAKE`, point `current-run.json` at it, and disclose any standing stale-red entries. If a run *is* live: the prompt is folded into it as orchestrator context (journaled `user.midrun-prompt`) — a new run requires the previous one terminal.                           |
| Every request thereafter | `experimental.chat.system.transform` | Appends the doctrine packs for that session's role plus a live state block: run state, the session's own active item, **the one recommended next tool**, a count of the other legal tools, open questions, blocked and deferred counts, taint count and overrides remaining. Restated every single request — process is never "remembered" (G9). |
| Every request thereafter | `chat.params` / `chat.headers`       | Role-appropriate sampling temperature and the router tags `X-Conductor-Role`, `X-Conductor-Priority` and, where a shared prefix exists, `X-Conductor-Group`.                                                                                                                                                                                     |

The three injection hooks share one composition step, so the doctrine a session is given and
the headers its requests carry cannot drift apart. Each delivery leaves a receipt in the
journal, and `conductor_status` reports the last delivery per session.

From this moment the orchestrator session is boxed in: its `edit` permission is `"ask"` and
the plugin rejects every ask not covered by an active `conductor_inline_claim` (G8). The
orchestrator coordinates; it does not write your code.

**First time in a repo:** `conductor_setup` is the only legal tool, and `conductor_status` the
only other legal call. Setup detects a test command (package.json / CMakeLists+ctest /
pyproject / Cargo.toml / go.mod), smoke-spawns every configured command so a bad command fails
at setup rather than at first verify, and asks the questions it is not allowed to default: git mode
(`read-only` / `commit` / `commit-and-push`), the `behavioralPaths` list, and — when the
directory is not a git repository at all — whether to initialize one or run in no-git mode
(§3.9). A `behavioralPaths` list that covers none of the detected source is refused unless the
caller passes an explicit acknowledgement, because such a list turns RED-before-GREEN off for
every item. The answers are written to `.conductor/config.json` (§2.1). A malformed config is
never silently replaced with defaults: every failure arm throws and names the file, because a
repo whose `git.mode` quietly reverts is a downgrade nobody asked for.

---

## 3. INTAKE — classify, cheaply, and don't trust the classification

`conductor_classify` (the only pipeline tool at this point) dispatches a sub-session on the
**mechanical** role, temperature 0.1, constrained to the `Classification` schema — then *one*
`skeptic` sub-session to cross-check it. A disagreement that names a correction escalates to
whichever of the two kinds is stricter (`question` < `trivial` < `work`). This costs seconds
and exists to stop "everything is trivial" drift.

Three outcomes:

- **question** → the orchestrator just answers. Run state `ANSWERED`, archived. No pipeline,
  no ceremony. ("what does this function do", "why is this test flaky")
- **trivial** → the classifier must return a complete one-item spec. The handler re-checks it
  and escalates to `work` if the `fileScope` exceeds `trivialMaxFiles` (default 2), if a
  behavioral item declares an empty `testScope`, or if a `behavioral: false` item's `fileScope`
  intersects `verify.behavioralPaths`. Otherwise it synthesizes a one-item queue and jumps
  straight to `EXECUTING` — decompose, plan and plan-review are skipped. **The item FSM is not
  skipped.** Trivial compresses fan-out *width* (item review runs three sessions instead of
  six, still covering all five mandatory lenses), never process.
- **work** → stays in `INTAKE` with the classification recorded; `conductor_decompose`
  becomes the one legal next pipeline tool.

---

## 4. The work pipeline (run FSM)

```
INTAKE ─► DECOMPOSED ─► PLANNED ─► PLAN_REVIEWED ─► EXECUTING ─► REPORTED
   ├─► ANSWERED                                          └─► TRIVIAL_DONE
   └─► EXECUTING (trivial)
```

### 4.1 DECOMPOSED — `conductor_decompose`

Dispatches the **planner** role (temperature 0.7) with the queue JSON schema and the
`decompose.md` doctrine pack. Each item must carry:

- `fileScope` — declared source write globs (the edit gate *and* the wave scheduler consume
  this),
- `testScope` — non-empty, or the item is rejected outright,
- `acceptance` — phrased as observable checks,
- `dependsOn` — must form a DAG,
- `ponytail` — which minimality rung (`skip`/`reuse`/`stdlib`/…/`minimal-code`) and what
  existing code you checked for reuse. Under `ponytail: "full"` (default), a `minimal-code`
  rung with an empty `reuse` note is **rejected** — you must show you looked.

The handler validates acyclicity, scope non-emptiness and item size (at most five files an
item), and oversized items get one bounded re-split round. Three scope shapes are refused here
rather than left to the gates: a `fileScope` entry that begins with a wildcard (it would grant
the implementer the whole tree and make `missing-subject` vacuous), a `testScope` that falls
inside the item's own `fileScope` (the implementer would be able to edit the test that proves
its own item), and any `fileScope` overlap between two items in the queue (the wave scheduler
would have to serialize them anyway, and a shared scope makes the edit gate meaningless).

### 4.2 PLANNED — `conductor_plan`

Planner again, doctrine `plan.md`: exact paths, bite-sized steps, complete code for
non-obvious steps, and named placeholder defects — "TBD", "add error handling", "similar to
task N" are plan defects *by name*. Output is `plan.md` plus decision records (≥2 real
options scored, §2.7) extracted into `decisions.jsonl`.

### 4.3 PLAN_REVIEWED — `conductor_plan_review`

The first real fan-out. `planReviewers` (default 4) fresh `reviewer` sub-sessions, one lens
each, all reading the same plan and queue prefix:

1. correctness / design soundness
2. completeness vs your original prompt (+ placeholder scan)
3. decomposition quality — item size, scope disjointness, DAG honesty
4. minimality — unrequested abstractions, skipped reuse

The roster never falls below the lens count: a `maxReaders` clamp is a concurrency knob and
must not silently drop lens (c) or (d).

Every `major` finding then goes to `skepticsPerFinding` (default 2) **refuters** — fresh
sessions whose job is to *kill* the finding. A refutation counts as one only when it names the
discriminating input, what was run, and the reading under which the finding fails; a
refutation without that evidence is an **abstention**, and an abstention counts with the
upholds, because incapacity must not convert itself into a verdict. A finding survives iff
upholds ≥ ⌈K/2⌉ (a tie upholds; a split finding is worth a fix round). Surviving majors are fed
back to the planner, plan revised, round++. Exit on a clean round or at `planReviewMaxRounds`
(3) — where surviving majors become **surfaced questions**, the first surviving major to name
an item owns that item's block, and the run proceeds only on items no major touches.

Note the run state never regresses: the majors⇒revise⇒re-review loop is internal to the
handler.

---

## 5. EXECUTING — the item state machine

This is where the bulk of the tokens go.

```
PENDING ─► RED ─► TEST_VETTED ─► GREEN ─► VALIDATED ─► REVIEWED ─► PUBLISHED
```

`PUBLISHED` is the only final state. `blocked` and `deferred` are annotations rather than
positions. A `blocked` item makes no FSM transition at all until its question is answered, after
which it resumes exactly where it stood. A `deferred` item is dropped from every wave and
offered no stage tool, and the deferral is final for the run — the closer counts it as settled,
and a run that settled everything without advancing anything stops `noop`. A persistent validate
failure enters
the DEBUG *protocol* (`debug.md` doctrine, `debugFixCap` = 3 failed fixes ⇒ the architecture
question gets surfaced to you) without leaving the `GREEN` position.

Each arrow is a `conductor_*` tool whose handler **re-derives the evidence itself** — the
model's claim is never the record (G6).

| Transition                         | Who does the work                                                                                                                             | What the handler independently proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conductor_submit_test` → RED      | `testWriter`, edit-gated to the item's `testScope` only                                                                                       | Runs the test. Requires exit ≠ 0 **and** a failure class of `assertion` (the behavior was evaluated and was wrong) or `missing-subject` (the thing this item is contracted to build does not exist yet). Class `error` — an import, syntax or collection failure — is *not* a red: the test never evaluated the behavior, so it goes back to the writer, bounded at `testRepairAttempts` (3 repairs after the initial write). A test that passes immediately is rejected too: either the behavior already exists (item may be unnecessary — ponytail rung `skip`) or the test is wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `conductor_vet_test` → TEST_VETTED | `vetCritics` (3) fresh `reviewer` sessions given the spec + test diff + captured red output — **not** the implementation, because none exists | Structured per-criterion verdicts against one fixed list: asserts observable behavior not internals; would fail a subtly-wrong implementation (tautology / mock-testing check); right level; pins *this* item's acceptance; anti-pattern scan. The same list generates the schema the reply is validated against and the checklist the pack teaches, so examination and doctrine cannot drift. A criterion marked failed with an empty `mustFix` has a repair line generated for it — the item cannot advance on that self-contradiction. `mustFix` → back to the writer. This is the anti-"test-after theater" gate, and it works precisely because no passing code exists to anchor the critics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `conductor_mark_green` → GREEN     | `implementer`, edit-gated to `fileScope` **minus** `testScope`                                                                                | Re-runs the item test; exit 0 required. The tool call simply fails until the test really passes, bounded at `implementerAttempts` (3). An implementer that replies `BLOCKED` or `NEEDS_CONTEXT` does not get the same prompt again — re-issuing it cannot supply what the session just said it lacks — so the item is blocked on a surfaced question that relays what was asked for, and you answer it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `conductor_validate` → VALIDATED   | harness                                                                                                                                       | Runs the full required scopes named by `verify.requiredScopes` for the item's paths. **Start-stamped**, and a freeze gate denies every source edit while a verify is in flight. A timed-out command is killed with `SIGKILL` and read as exit 124, never as a pass. Failure drops into the DEBUG protocol.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `conductor_item_review` → REVIEWED | up to 6 fresh `reviewer` sessions + skeptics                                                                                                  | Six lenses over the diff, spec and test: **spec/contract**, **correctness**, **guardrail** (security, trust-boundary validation, data-loss — never lazy-able at any ponytail intensity), **test-adequacy** (does the test still honestly pin the change now that the implementation exists), **minimality**, **perf**. The first five are mandatory and never truncated; a trivial run merges them into three sessions. Each lens must return a read witness naming its contact with the diff, and the diff it is shown includes synthesized creation hunks for files the item brings into existence. All dispatch in parallel for wall-clock, but *adjudication* preserves ordering: surviving spec findings are fixed first, and quality findings from a round that had surviving spec findings are discarded and re-derived (judging not-yet-compliant code is wasted judgment). Findings → skeptic refutation → survivors go back to the implementer with `receive-review.md` doctrine: verify the claim against the code first; disagreement is answered with reasoning and routed through one more skeptic round, never silently accepted. Fix ⇒ re-validate ⇒ re-review, bounded at `reviewMaxRounds` (3). |
| `conductor_publish` → PUBLISHED    | harness                                                                                                                                       | Stages `fileScope ∪ testScope` (the tests ship in the same commit — they *are* the proof), applies format rules, re-checks verify freshness against staged mtimes (stale ⇒ auto re-verify), and commits with a generated message naming the item and its red proof. **No attribution trailers** (`Co-Authored-By`, `Generated with`, 🤖 are a normative denylist). Pushes only under `commit-and-push`. Under `read-only` it records the prepared batch — files, diff and suggested message — into `publish-batch.jsonl` and the report instead of committing, and the item still advances to `PUBLISHED`. The model never runs `git commit` — the gate denies it in every spelling; publishing *is* the tool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

In a directory that is not a git repository (§3.9), `conductor_publish` is not offered at all
and items terminate at `REVIEWED` with their diff recorded in the report.

### 5.1 Freshness — the rule that makes "verified" mean something

A verify record is fresh for a commit iff two conditions hold: `startedMs` is at or after the
largest mtime among the staged behavioral files (plus the index mtime when a staged entry is a
deletion or rename), and the record's `HEAD` still equals the current `HEAD` — a green produced
on one branch is not a green on another. In no-git mode the `HEAD` term is dropped, because
there is no repository to have one.

The tie is decided by the resolution of the clock that produced the stamp: a whole-millisecond
stamp cannot order two events inside its own tick, so equality counts fresh; a monotonic stamp
that *can* order them reads equality as stale, because an edit made at the identical instant is
not a proof of having preceded the verify. Combined with the freeze gate (no edits while a
verify runs), this closes the classic "green, then one more tweak, then commit" hole.

---

## 6. What runs in parallel, and what that costs on this machine

### 6.1 Waves

`nextWave(queue, items, config)` is a pure function: a wave is the maximal set of items that
are dependency-ready, **pairwise fileScope-disjoint** (conservative glob intersection — a
false positive only serializes, never corrupts), and within `maxImplementers` (default 2).
`conductor_dispatch_wave` is the work engine rather than a one-shot entry edge: it is offered
again from `EXECUTING` for as long as the wave it would compute has members, so a queue larger
than one wave needs repeated calls.

| Stage                                        | Fan-out                                                                        | Isolation                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| plan review, item review, test vet, skeptics | up to `maxReaders` (6), **across items**                                       | none needed — read-only                               |
| test-writing (RED)                           | wave-wide                                                                      | test paths disjoint by scope                          |
| implementation                               | 1 (`writes: "off"`, the POC default), or wave-wide under `writes: "worktrees"` | git worktree per item                                 |
| validate                                     | serial per tree                                                                | verify marker per tree — two verifies in one tree lie |
| publish                                      | serial, item order                                                             | the git index is a singleton                          |

Even with `writes: "off"` you get large overlap: item B's test is being written and vetted
while item A implements.

**The shared-tree quarantine.** A wave sibling's deliberately-red test must not poison
another item's full verify, so `conductor_validate` moves aside the testScope files of every
*other* queue item below GREEN (not just wave siblings — a blocked earlier item's red test
lingers too), restoring them after. The move goes **outside the repository**, to
`<stateHome>/conductor/<workspaceKey>/quarantine/<runId>/`, because the verify command is the
target repo's own whole-tree runner and a file parked under `.conductor/` is still on a
collected path. The move preserves the original mtime — a rename on one volume, and across
volumes a copy stamped with the original's mtime before the source is unlinked — so freshness is
not perturbed, and the manifest is written before any file moves so a crash replays the pending
restores. The item's
own tests are never excluded, and the freeze gate guarantees the move cannot race a writer. The
same exclusion applies to the closing report verify, and it is disclosed in `report.md`.

### 6.2 One model, many roles

Every session — orchestrator, planner, implementer, testWriter, reviewer, skeptic, mechanical
— runs the **same served model** (G13). Mixing model sizes would confound the POC's
measurement: the quality delta has to be attributable to process, not to a bigger model doing
the reviewing. What a role selects is its doctrine packs, its sampling temperature, its gate
posture and its router priority tag:

| Role         | Temperature | Priority    | Doctrine packs                                                                             |
| ------------ | ----------- | ----------- | ------------------------------------------------------------------------------------------ |
| orchestrator | 0.4         | interactive | `core.md`                                                                                  |
| planner      | 0.7         | interactive | `decompose.md`, `plan.md`                                                                  |
| testWriter   | 0.5         | review      | `tdd.md`                                                                                   |
| implementer  | 0.4         | review      | `tdd.md` (plus `debug.md` on a DEBUG posture, `receive-review.md` when receiving findings) |
| reviewer     | 0.3         | review      | `review.md`, `test-vet.md`                                                                 |
| skeptic      | 0.3         | review      | `skeptic.md`                                                                               |
| mechanical   | 0.1         | batch       | `core.md`                                                                                  |

The fan-out engine still groups queued jobs by their resolved model before dispatching, so an
ABAB arrival order drains as AABB and a weight load serves a whole batch. Under the default
single-model config that grouping is the identity function on one group; the machinery exists
because `models.roles` can name a model per role, which is where the multi-model stretch goal
would land.

The wall-clock lever that *does* pay under one model is layer 2. The router does admission
control (cap in-flight per model — six concurrent reviewers must not thrash a 30 GB model —
plus a bound on how many *distinct* model names may hold slots at once, so a client that varies
the `model` string cannot exhaust the worker pool), **group
affinity** (same `X-Conductor-Group` requests dequeue contiguously so the huge shared prefix —
diff plus plan plus rubric across N reviewers — stays KV-hot), and **schema observation**: a
request tagged `X-Conductor-Schema: required` that carries no schema field is journaled,
counted as `schemaMissing`, and proxied unchanged. The router observes; it never converts a
request `llama-server` would have served into an error (G5).

Enforcing structured output is the fan-out engine's job, and it runs in both configurations: it
validates every receipt against the named schema on arrival, and re-prompts with the concrete
validation errors appended, at most three attempts per session, before marking the sub-task
env-failed.

---

## 7. The gates you will actually notice

Every tool call in every conductor session (orchestrator *and* sub-sessions — the plugin
knows each session's role and item) passes `tool.execute.before`. Deny = a thrown Error
whose message names the violated rule and the legal alternative.

- **tool legality** — one choke point checks, in order, whether this caller may call this tool
  at all (only `conductor_status`, `conductor_surface` and `conductor_override` are callable
  from a sub-session), whether the declared arguments are present and well-typed, and whether
  the tool is legal in the run's current position. A `conductor_*` tool with no legality row is
  refused outright rather than reaching a handler.
- **patch tools** — `patch` and `apply_patch` are refused ahead of every other gate, in every
  session: a patch body names its write targets in a form no gate here parses, so no scope
  decision could bound it. Use the single-path `edit`/`write` tools.
- **git policy** — parsed-token matching over a quote-aware tokenizer, never substring regex,
  and default-deny: only an enumerated read-only set (`status`, `log`, `diff`, `show`,
  `ls-files`, `rev-parse`, `blame`, `grep`, …) is allowed outright. Staging (`add`/`mv`/`rm`)
  is denied and names `conductor_publish` as the alternative; `commit`/`push` denied for the
  same reason; `reset`/`rebase`/`clean`/`merge`/`cherry-pick`/`revert`/`apply`/`filter-branch`
  and friends denied outright. `checkout`/`restore`/`switch` deny every worktree-discarding
  form including `-p`/`--patch`; `git branch` allows only enumerated list flags. Two indirect
  execution routes are denied before the subcommand is even read: `git -c <section>.<leaf>=…`
  where the config key runs a command, and the `GIT_*`/`*_PAGER`-style environment variables
  that do the same. The dashed spelling `git-branch -D x` resolves to the same decision as the
  spaced one. `git log --grep config` still allows — the false-positive guards are part of the
  spec.
- **edit scope** — the orchestrator cannot touch source without an active inline claim;
  implementers are confined to their item's `fileScope` *minus* its `testScope` (an implementer
  may never edit the test that proves its own item, whatever its `fileScope` also covers);
  test-writers to `testScope`; reviewers, skeptics, planners and the mechanical role write
  nothing; nobody edits `.conductor/**` (matched case-folded, so `.Conductor/…` is the state
  area too); nobody writes outside the session's own tree; nobody edits during a live verify.
  Covers bash write-shapes too (redirects, `tee`, `sed -i`, `mv`/`cp` destinations, `rm`),
  including behind wrappers such as `env sh -c "…"`. Interpreter one-liners are read as well:
  the recognized write calls of `node`, `python`, `ruby` and `perl` surface their literal path
  operands into the same edit decision, and any interpreter program text that so much as names
  `.conductor` is refused whole, path operand or not.
- **ask gate** — every permission ask is adjudicated once, registry-first: a session with no
  §3.5 registry entry is rejected outright. A **sub-session** is rejected for *every* permission
  kind, `question` included, and the refusal is converted into a `NEEDS_CONTEXT` disposition the
  idle engine hands the orchestrator on its next re-prompt — so a subagent can never silently
  stall the run. The **orchestrator's** `edit` ask is decided by the same `decideEdit` the tool
  gate uses, granted only when an active inline claim scopes the path; its `question` ask is
  allowed, counted, and journaled with a human-territory verdict.

A crash *inside* a gate while judging a git command or a file write denies the action
(fail-closed); a crash in a logger or injector never blocks work (fail-open).

**Two deliberate hatches**, both expensive by design:

- `conductor_inline_claim {itemId, reason, options, choice}` — grants the orchestrator edit
  permission scoped to one item's `fileScope`, for work where dispatch genuinely costs more
  than doing (a one-line review fix). It is itself a scored §2.7 decision and is refused
  without at least two options scored on the minimality ladder. The item FSM still applies in
  full: the claim changes *who edits*, never *what is enforced*.
- `conductor_override {gate, reason, grantedAction}` — records an anomaly, permanently taints
  the item, and disables the named gate for exactly one next denied action in the same session
  and on the same item. `grantedAction` is the action the caller declares it is spending the
  override on — it is recorded in the anomaly, the taint entry and the journal, but the grant
  itself is spent by the first decision that gate makes. `gate` is a closed vocabulary of
  `session`, `git` and `edit`; any other name
  is refused before the budget is touched, so a misspelling costs nothing. Taint is listed
  prominently in the final report. There is no bulk or timed override; a gate needing repeated
  overriding is an `env` stop and a conductor bug.

---

## 8. Keeping going, and stopping

opencode has no pre-emptive turn-end hook, so continuation is **re-entry**: on
`session.idle`, if the run is non-terminal and actionable work exists, the continuation engine
re-prompts the orchestrator with the exact next tool call — derived from the same
`legalTools` derivation that the injection and the deny both use. The trigger is actionable
work, not the presence of a recommended stage tool: a run whose only actionable path is a meta
tool still gets re-prompted, which is what keeps the wedge detector alive.

The wedge detector: a re-prompt whose resulting run-state signature is unchanged increments
`futileRePrompts`; any real state change resets it. The signature is over the run and item
states, deliberately *excluding* the counters the engine itself increments — a signature that
included them would change on every re-prompt and detect nothing. At 3, the engine records stop
`noop` plus a `disengage` anomaly and stops re-prompting. A wedged loop ends loudly instead of
burning tokens overnight. A send that throws out of the SDK charges nothing — not the idle
count, not the futile count, not the debounce clock — and a separate, looser floor of five
consecutive failed sends stops the run `env`, because a permanently dead transport would
otherwise freeze the counters and disable the only wedge detector there is. A `halt` file (owner-only; the model never
touches it) records `interrupt` instead.

Closed stop vocabulary: `done`, `noop`, `blocked`, `surfaced`, `env`, `interrupt`. A run that
stops `blocked` or `surfaced` on an unanswered question keeps its current-run pointer, so
answering the question resumes it rather than leaving it stranded — except where the question
is human territory, which only the answer file releases.

---

## 9. REPORTED — the close

`conductor_report` requires every item PUBLISHED or explicitly deferred with a reason. The
handler then **re-runs the full verify itself**, fresh and start-stamped
(verification-before-completion made mechanical), and writes `report.md`:

- per item — what shipped, the red proof, review rounds, taint,
- open questions, and questions answered but still standing because a human never spoke,
- what was deferred and why, plus which test files the closing verify quarantined,
- the decision-ledger summary (every ≥2-option scored fork),
- stale-red additions this run leaves behind,
- a metrics section that states, as a positive witness, whether the router was contacted at
  all: with no metrics seam wired into the composition root, a real session renders
  `Router contact: ABSENT`,
- the prepared batch for every published item — files, diff and suggested message — which under
  `read-only` is the whole product, since nothing was committed.

The closing verify is not advisory. A red closing verify can never produce `done`: an
assertion or missing-subject failure closes the run `blocked`, and a runner that could not run
at all closes it `env`. A run that settled every item but advanced none closes `noop`, naming
the deferral count — settling everything by deferring it is not completion.

Everything is replayable: `runs/<runId>/journal.jsonl` carries every gate decision, fan-out
dispatch, and schema retry with a `(runId, itemId, sessionID)` correlation triple and a
closed, tested event vocabulary; `conductor/tools/replay.ts` renders it as sections for
sources, per-item swimlanes, denials, fan-out and review rounds, with denials highlighted. It
reports review *rounds* rather than per-finding verdicts, because the journal records no
per-finding verdict and a table that invented one would be worse than none. The debuggability
bar is explicit: journal plus fixtures must suffice to write the failing test for any
"conductor did something weird".

---

## 10. A worked example

> **You:** "the config loader silently ignores unknown keys — it should error, and the CLI
> should print which key and which file."

| Phase            | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Roughly  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| INTAKE           | the mechanical role classifies `work` (two subsystems, behavioral change); the skeptic agrees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | seconds  |
| DECOMPOSED       | the planner returns 2 items: **I1** `src/config/**` + `tests/config/**` — unknown key raises `ConfigError` with key+path; **I2** `src/cli/**` + `tests/cli/**` — CLI renders that error, `dependsOn: [I1]`. Each carries a ponytail rung and a reuse note, and the two file scopes are disjoint or the queue is refused                                                                                                                                                                                                                                                                                                                                          | ~1 min   |
| PLANNED          | plan.md with per-item test strategy, alternatives (error-on-first-unknown vs collect-all → recorded decision), risks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ~1 min   |
| PLAN_REVIEWED    | 4 lenses in parallel. Completeness lens finds a major: "spec says *which file* — I1's acceptance never pins the file path". 2 skeptics uphold it. Planner revises; round 2 clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ~2 min   |
| EXECUTING wave 1 | I2 depends on I1 ⇒ wave = {I1}. testWriter writes `tests/config/unknown_keys.test.*`; harness runs it, gets an assertion failure ⇒ legal RED. 3 critics vet it (one flags "asserts the exception type but not the message contents" ⇒ mustFix ⇒ rewritten, re-vetted). Implementer edits `src/config/**` only — the test it must pass is outside its writable set. Harness re-runs → GREEN. Full verify → VALIDATED. 6 lenses review the diff; guardrail lens notes the error message echoes the raw file path — upheld by skeptics; implementer fixes; re-validate, re-review clean → REVIEWED. Publish stages source+tests, formats, freshness-checks, commits | the bulk |
| EXECUTING wave 2 | I1 PUBLISHED ⇒ wave = {I2}, same walk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |          |
| REPORTED         | Fresh full verify by the handler, `report.md` with both commits, the one recorded decision, zero taint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ~1 min   |

Two commits, two proven-red tests, ten-ish independent judgments, and a machine-checkable
paper trail for every one of them — from a model that on its own would have edited the
config loader, said "all tests pass", and been wrong about it.

---

## 11. Honest limits

- **Gates fire on tool calls made through opencode.** A human (or a script) at a raw
  terminal is ungated, and so is a second, plain opencode session started without the harness.
  Detection over prevention, documented rather than papered over (G7); the fifteen normative
  limits, and the further limits the build itself discovered, are
  [`conductor/docs/HONEST-LIMITS.md`](../conductor/docs/HONEST-LIMITS.md).
- **Conductor cannot detect its own absence.** A plugin that fails to load leaves opencode
  running completely ungated, which is why the liveness beacon at `.conductor/state/alive.json`
  is the first thing an operator checks: no beacon, no conductor.
- **The router is not enforcement.** If it dies, process is identical, just slower.
- **Token cost is the point of the experiment, not a bug.** No gate or review stage may be
  weakened to save tokens; wall-clock is engineered instead (scheduler + router). The POC
  bench (`scripts/conductor_bench.py`, `bench/conductor-tasks.json`) exists to measure the
  quality delta against exactly this cost.
- **Context is 32–64k here, not 200k.** That is why doctrine is injected every request
  rather than stated once, why every obligation is a schema or a gate rather than prose,
  and why review happens in fresh narrow-context sessions instead of one long one.
