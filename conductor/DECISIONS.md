# Standing decisions

This is the standing-decisions ledger for the conductor build. Each entry is recorded
per the plan's §6.2 decision protocol: the decision sits at ladder rung 2 (committed
project decisions) of the precedence ladder — (1) the user's words this run,
(2) committed project decisions, (3) code + green tests, (4) objective law,
(5) objective design quality, (6) ecosystem convention — and each entry records the
real options considered (≥2 per non-trivial fork) and why the winner won on the
ladder-5 criteria: capability superset, earlier/more-mechanical validation,
testability, single-source-of-truth, fewer moving parts for equal capability. A
strictly better option wins automatically; effort is never a tiebreaker. Later
entries append below; prior entries are never rewritten.

## (a) The system is named "conductor"

**Decision.** The system is **"conductor"** (G10). Custom tools are `conductor_*`. Run
state in a target workspace lives under `.conductor/`. Source lives in this repo under
`conductor/` (TS), `router/` (C++), and `scripts/` (wiring).

**Options.** (1) Fix one name now and hardcode it everywhere — the winner. (2) Leave
naming to be improvised per module as the build proceeds.

**Why the winner won.** G10 is explicit: "Do not improvise names; tests hardcode
them." A single fixed name is the single source of truth that every test, tool id, and
state path can mechanically depend on; improvised per-module naming would make those
names untestable moving targets. This is a naming fixation, not a contest between
candidate names — the plan enumerates no rival name, only the rival policy of not
fixing one.

## (b) Enforcement substrate: TS plugin (all gates) + C++ router (wall-clock/metrics) + serve.py wiring

**Decision.** Per §0.3, enforcement is split across three layers: layer 1, the
conductor TS plugin, holds ALL enforcement — run/item state machines, gates,
`conductor_*` tools, fan-out engine, ledgers, doctrine injection, logs; layer 2,
llama-router (C++), holds wall-clock and measurement work — admission control, group
affinity, schema observation (record, never reject), metrics; `serve.py` wires the
stack to `llama-server`.

**Options.** (1) The three-layer split — the winner. (2) A single layer: the plugin
does everything, including the wall-clock and measurement jobs. (3) Push enforcement
down into the router.

**Why the winner won.** Layer 1 is the only layer that can see a tool call, so every
gate lives there — a router-side gate is structurally impossible, which eliminates
option 3. Option 2 fails on the plugin's structural limits, which §0.3 enumerates
job by job: the plugin doesn't own the server, so it cannot cap in-flight requests or
priority-queue them (concurrent sub-sessions would thrash a 20 GB model and exceed its
slot count); it can't influence server slot reuse timing, so it cannot deliver group
affinity; it would be the claimant validating its own claim if it checked schema
conformance; and it sees only its own requests, so it cannot produce the measured
metrics ledger. Layer 2 therefore gets exactly the jobs the plugin structurally cannot
do — earlier, more-mechanical validation and an independent record, with the
dependency direction load-bearing: layer 2 is fail-soft, layer 1 fail-closed, so
process integrity never depends on the router being up (G5), and
`serve.py --no-router` runs the identical workflow.

## (c) Gates hard-deny, with the budgeted `conductor_override` hatch

**Decision.** Gates hard-deny, and the sole escape is the BUDGETED
`conductor_override {gate, reason}` hatch of §3.6: it checks the budget
(`maxOverridesPerItem`, `maxOverridesPerRun`), records an anomaly, appends the
override to the item's `taint[]`, then disables the named gate for exactly ONE next
action in the same session. Taint is permanent for the run and listed prominently in
report.md. There is deliberately no bulk or timed override, and over budget is an
`env` stop, not another override.

**Options.** (1) The budgeted hatch — the winner. (2) An uncapped hatch.
(3) No hatch at all. (4) A human-approved hatch.

**Why the winner won.** Against the uncapped hatch, §3.6 is direct: the bookkeeping
cost of an override — a reason string, a ledger line, a taint — is a cost the *human*
pays at reading time, not one the model feels during the run; an uncapped hatch that
the deny messages themselves advertise is a hatch a struggling local model will find
and keep using, and at that point every gate in the system is advisory while the
report still claims a process was followed. Against no hatch, the budgeted design is
the capability superset: it keeps a deliberate, fully bookkept escape for the
exceptional case while the budget converts abuse into a stop — a gate that needs
overriding twice in one run is a bug in conductor, and stopping is the correct
response to it. Against a human-approved hatch, the protocol runs autonomously:
§6.2 reserves mid-run interactive interruption for the interactive session's explicit
prompts (the user typing) and for `git.mode` first-run setup, so gating each override
on a human would break the autonomous operation the recorded-derivation protocol
exists to serve. The budget is what makes "the trail is visible" into "the trail is
short enough to read, and the run stops before it gets longer."

## (d) One model for every role

**Decision.** Every sub-session and the orchestrator run the same served model
(G13, `qwen3.6-27b` via `config.models.default`). Roles select doctrine pack,
sampling, priority tag, and gate posture — never weights.

**Options.** (1) One model for every role — the winner. (2) Role-tiered routing
(different weights per role). (3) A two-tier judge/worker split.

**Why the winner won.** Role-tiered routing was rejected because it costs 4–6 weight
reloads per item per review round under `--models-max 1`, and it confounds the POC's
quality delta with model size — the POC exists to measure what process alone buys, and
mixing model sizes destroys that measurement. The two-tier judge/worker split was
rejected for the same confound with a smaller saving. G13 also keeps the design
honest: any design that only pays off under multi-model routing is either
inert-by-construction under this constraint or lives in §10 stretch, while the fan-out
engine still groups jobs by resolved model so that a future multi-model config is a
config change, not a redesign — under the default config that grouping is the identity
function.

## (e) The stock example target `myprogram`/`router/main.cpp` is replaced by the router targets

**Decision.** The stock example build target `myprogram`/`router/main.cpp` is REPLACED by
the llama-router targets.

**Options.** (1) Replace it — the winner. (2) Keep the stock example alongside the new
router targets.

**Why the winner won.** The file is the unmodified llama.cpp simple-chat example: it
carries zero project value, so keeping it adds a moving part for no capability, and
deleting it loses nothing because git history preserves it. Replacement is strictly
fewer moving parts for equal capability.

## (f) Plugin tests run under Node type-stripping, with one Bun smoke test

**Decision.** Plugin tests run under Node type-stripping, with one Bun smoke test
(G14). Adapter code runs under opencode's Bun runtime in production and under Node
type-stripping in tests, so adapters use ONLY Node-compatible built-ins (`node:fs`,
`node:child_process`, `node:path`, `node:crypto`); the Bun-only shell `$` is never
used, and the Bun smoke task (Task 2.2) proves the state store and journal actually
run under Bun before thirty modules depend on them.

**Options.** (1) Node type-stripping tests plus one Bun smoke test — the winner.
(2) All-Bun tests. (3) Node-only tests.

**Why the winner won.** All-Bun was rejected because Bun lacks the `node --test`
ergonomics, and the pure core gains nothing from running under Bun. Node-only was
rejected because the production runtime would then never be exercised until Phase 13 —
far too late a discovery point. The winning combination keeps the mechanical,
ergonomic Node test loop for every module while the single Bun smoke test validates
the dual-runtime claim early, before the rest of the system depends on it.

## (g) `.conductor/` state excluded via `.git/info/exclude`; quarantine and worktrees live OUTSIDE the repo

**Decision.** Per §1.2, `.conductor/` runtime state in a target workspace is excluded
via the target's `.git/info/exclude` (never by editing the target's tracked
`.gitignore` — the harness must never dirty a target's tracked files with its own
presence), while quarantine (`quarantine/<runId>/`) and parallel-implementer worktrees
(`worktrees/<runId>/<itemId>/`) live OUTSIDE the repo under
`<stateHome>/conductor/<workspaceKey>/`.

**Options.** (1) Outside-the-repo quarantine and worktrees — the winner. (2) In-repo
placement (e.g. under `.conductor/`) with per-runner test-discovery exclusion flags.

**Why the winner won.** `.git/info/exclude` hides a directory from *git* — it hides it
from nothing else. The verify command is the target repo's own test command, and every
default the plan ships (`node --test`, `pytest`, `go test ./...`, `ctest`) discovers
tests by walking the tree, so a red test file parked under `.conductor/` can still be
collected and executed by the very verify it was moved aside to protect, and a
worktree — a complete second checkout of every test file in the repo — is guaranteed
to be. The in-repo alternative was rejected as per-runner and per-version fragile:
per-runner discovery behaviour for dot-directories is a version-dependent accident and
MUST NOT be relied on (Task 6.2 measures it and records the result). Correctness comes
from the files being outside the walked tree entirely — mechanical, runner-independent
validation rather than a lattice of exclusion flags.

## (h) The read and network surface is governed, not granted: a side-effect taxonomy over every visible tool

**Decision.** Every tool a conductor session can see carries exactly one §2 side-effect
class — R0 pure repo read, R1 derived repo read, R2 machine-local read, R3 network read,
W write-capable, X structurally unboundable, S session-spawning — recorded in
`core/builtin-surface.ts` for names and derived per command for `bash`. A tool carrying
no class is refused. `SIDE_EFFECT_CLASSES` is a registered vocabulary, so widening the
set is a deliberate two-file act.

**Options.** (1) A class per tool with an enumerated-allow deny point — the winner.
(2) Leave the existing catch-all and add capability behind config flags, classifying only
the tools a new lane introduces.

**Why the winner won.** The premise this work started from — that a conductor session
cannot reach docs, diagnostics or the web — is false, and measuring it is what changed the
design. `curl`, `man`, `npx tsc` and `eslint --fix` all pass every gate at HEAD, and the
pinned client offers `webfetch` with no permission narrowing in any agent kind, raising no
permission ask for it. Four layers decline to restrict a read-class call and the
composition of those four declinations is not a decision to permit them; it is the absence
of a decision, which is worse, because nothing records it and nothing fails closed. Option
(2) would have added lanes on top of an unexamined surface and called the result a
capability gain. The taxonomy is what makes "R3 off" a statement with a truth value.

## (i) Reviewers never write, and the mechanize lane is withdrawn

**Decision.** I1 gains a second layer and loses a hole. Dispatched readers name their role
agent on every prompt, so `edit: "deny"` binds at the opencode layer independently of
conductor's gate; and `conductor_override {gate: "edit"}` from a reader role is refused
without spending budget or recording taint. Separately, no `conductor_mechanize` lane is
built.

**Options.** (1) Two layers plus a free refusal — the winner. (2) Keep the single
conductor-side edit gate and add a model-callable fixer lane for mechanical findings.

**Why the winner won.** I1 was routable around: `conductor_override` carries
`callers: EITHER`, and neither the mint nor the spend had a role predicate, so a reviewer
could mint an edit grant and use it. With the opencode layer denying that edit regardless,
the grant can never convert — and spending both budget meters plus a permanent item taint
for a bypass that provably cannot happen is ISSUE-007's shape exactly, so it gets
ISSUE-007's answer. The fixer lane was rejected because the capability already ships:
`conductor_publish` runs configured formatters and writes their output back, in `stdin`
mode, where the tool never touches the filesystem and the handler performs exactly one
write to a path it chose. A registry of argv templates would hand that write back to the
fixer, whose blast radius is then anything under `cwd`. The proposed safety device —
`f(f(x)) == f(x)` — is fixpoint, not semantics preservation: `ruff --select F401
--fix-only` satisfies it and is silently destructive on a registration-side-effect import.

## (j) New capability arrives as a typed tool whose handler owns execution, never as an enabled built-in

**Decision.** R1/R2/R3 capability, when it is built, arrives as `conductor_*` tools with
handler-owned execution and a `core/tool-legality.ts` row. Built-ins get a class and a deny
point, never an enablement. `webfetch` stays denied in favour of a future
`conductor_fetch`.

**Options.** (1) Typed tools with handler-owned execution — the winner. (2) Enable the
built-ins and rely on the gate to bound them.

**Why the winner won.** Two structural properties, neither of which is available to an
enabled built-in. A model-composed command line makes the finding the model's claim again,
which is the failure the whole system exists to prevent (G6); and a `conductor_*` name
classifies as `conductor` and therefore fails CLOSED on a gate crash, where a read-class
call fails open. The second is not a preference — it falls out of how `guarded` is
computed, and it means the fail-open posture is a property of the delivery shape rather
than of the tool's intent.

## (k) The network is denied at the gate, in both lanes, and re-opens only with an allowlist and a proxy

**Decision.** R3 is denied by default: the `webfetch` and `websearch` names, and any `bash`
command whose shape reaches an enumerated network program. Re-opening it requires a typed
`conductor_fetch` with a host allowlist AND the `serve.py` egress proxy as a required
backstop, not an optional one.

**Options.** (1) Deny both lanes now, re-open through one governed door — the winner.
(2) Deny the `webfetch` name behind a config flag and leave `bash` alone.

**Why the winner won.** Option (2) is not a posture, it is the appearance of one: the same
capability remains under a different spelling, and the flag would document a restriction
the system does not have. A refusal that can be walked around by choosing a wrapper is the
inverse of the property that justifies the patch refusal — that a refusal not depending on
the call's arguments cannot be spelled around. The proxy is graded REQUIRED rather than
optional because the tool gate binds only the tool while the proxy binds the process; both
are needed and neither is a sandbox, and `curl --noproxy '*'` defeating the proxy is
precisely why the shape extractor is the layer that has to see it.
