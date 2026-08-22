# docs-generation

Comprehension and documentation of large existing codebases.

Read `CONVENTIONS.md` first — run IDs, the four-level workspace layout, `run.json`,
the `build.sh` / `run.sh` / `test.sh` contract, and scoring are defined there and
are not restated here.

---

## 1. What this category measures

Every other category in this repository gives the model a problem and lets it
write new code. This one gives it 40,000 to 600,000 lines of *someone else's*
code and asks for an accurate description of it. Nothing is generated that a
compiler can check, so the failure mode under test is different: a model that
never reads the code can still produce fluent, plausible, wrong prose.

Concretely, the category measures three things:

1. **Coverage under a context limit.** No target fits in a context window. The
   model has to choose what to read, and a run is judged partly on whether the
   parts it chose are the parts that matter.
2. **Grounding.** Every factual claim must carry a citation into the pinned
   source tree (section 5). Citations that do not resolve are detected
   mechanically, which turns "did it actually look?" into a number.
3. **Structure under scale.** A document about DuckDB's query path that is
   correct but shapeless is worth less than one that is correct and navigable.
   The rubric scores that separately from accuracy.

This is also the category where harness-versus-vanilla divergence is expected to
be largest, because a harness that can search, chunk, and re-read the tree is
doing exactly the work the task demands.

---

## 2. Targets

Target source is **not** vendored here. `docs-generation/targets/targets.json`
pins six repositories by 40-character commit SHA; `tools/fetch_docs_targets.sh`
clones each one at that exact commit so every run — vanilla and harness, today
and in six months — reads byte-identical source. Checkouts land in
`docs-generation/targets/checkouts/<slug>/`, which is git-ignored.

| slug | language | approx LOC | license | why it is a real documentation test |
|---|---|---:|---|---|
| `valkey` | C | 180,000 | BSD-3-Clause | A single-process network daemon whose event loop, command table, keyspace, replication and cluster code are interdependent through one global server struct; module boundaries do not exist to lift a summary from. |
| `ripgrep` | Rust | 56,000 | Unlicense OR MIT | The control case: a Cargo workspace of sharply separated crates whose graph is easy to see, but whose interesting behaviour (ignore-rule precedence, literal extraction, multiline search) hides in details a crate-name summary misses. |
| `fastapi` | Python | 60,000 | MIT | Core behaviour is produced by runtime introspection — type hints becoming validation, dependency graphs, an OpenAPI document — so the control flow that matters is never one traceable call chain. |
| `etcd` | Go | 260,000 | Apache-2.0 | A distributed system in a multi-module Go workspace; the claims that count are about consensus, durability ordering and revision semantics, and are only right if raft, the WAL and the MVCC backend are described together. |
| `vite` | TypeScript | 70,000 | MIT | Two different code paths for one user-facing job — an on-demand dev server and a Rollup-based production build — joined by a shared plugin container. Describing one and implying it covers both is the trap. |
| `duckdb` | C++ | 600,000 | MIT | The largest target: an analytical database engine whose query path crosses parser, binder, optimizer, vectorized execution and storage, testing whether accuracy survives a codebase far larger than any context window. |

LOC figures are order-of-magnitude estimates for sizing tasks and timeouts, not
measurements to score against. Every target is permissively licensed; each
checkout keeps its own `LICENSE` file, and documentation produced about a target
is a derived description, not a redistribution of its source.

`targets.json` is the single source of truth for the target list, the pinned
SHAs, and the `subsystems` array each target exposes to the deep-dive prompt.
Changing a pinned SHA invalidates comparability with every run recorded against
the old one: bump it only alongside a new run ID, never in place.

---

## 3. Fetching the targets

```sh
tools/fetch_docs_targets.sh              # fetch all six
tools/fetch_docs_targets.sh --only vite  # fetch one
tools/fetch_docs_targets.sh --list       # print the target table + local status
tools/fetch_docs_targets.sh --verify     # assert every checkout is at its pinned sha
tools/fetch_docs_targets.sh --force      # replace a checkout that is wrong or damaged
```

Requirements: `bash`, `git`, `python3`. No `jq`. Runs on macOS and Linux.

Each target is materialised as `git init` + `git remote add` + a shallow
`git fetch --depth 1 origin <sha>` + `git checkout FETCH_HEAD`. The script is
idempotent: a checkout already at the pinned SHA is reported as `up-to-date` and
skipped. Some servers refuse a shallow fetch of a raw SHA; when that happens the
script says so explicitly, falls back to a shallow fetch of the pinned branch,
and deepens until the pinned commit is present. `--verify` exits non-zero if any
checkout is missing, damaged, or at the wrong commit — run it before a scoring
pass, since a drifted checkout silently invalidates the comparison.

The clone is network work and must happen **before** a run starts. Per
`CONVENTIONS.md` section 6, `build.sh` and `run.sh` inside a solution workspace
get no network access.

---

## 4. The five prompts and how they map onto targets

Each prompt is target-agnostic. The harness substitutes `{{TARGET}}`,
`{{TARGET_PATH}}`, `{{RUN_ID}}`, `{{TASK_ID}}` (and `{{SUBSYSTEM}}` for the deep
dive) before the prompt text is handed to the model, so one prompt file drives
six targets without being rewritten.

| task id | prompt file | deliverable | what it asks for |
|---|---|---|---|
| `architecture-overview` | `docs-generation/docs-architecture-overview-prompt.md` | `ARCHITECTURE.md` | Components, boundaries, data flow, key abstractions, how it builds and tests. |
| `subsystem-deepdive` | `docs-generation/docs-subsystem-deepdive-prompt.md` | `SUBSYSTEM-<subsystem>.md` | One named subsystem to implementation depth: entry points, control flow, state, invariants, failure modes. |
| `api-reference` | `docs-generation/docs-api-reference-prompt.md` | `API-REFERENCE.md` | The public surface a consumer programs against — entry points, types, invariants, error behaviour. |
| `onboarding-guide` | `docs-generation/docs-onboarding-guide-prompt.md` | `ONBOARDING.md` | What a new contributor needs before their first change. |
| `adr-reconstruction` | `docs-generation/docs-adr-reconstruction-prompt.md` | `DECISIONS.md` | The architecture decisions the code embodies, reconstructed from the code and its history. |

The task registry entry for each — word budgets, required sections, timeouts,
difficulty, the exact artifact name — is `docs-generation/tasks/<task-id>/task.json`.
The prompt file is authoritative for anything the two disagree on.

A run-time task ID binds a prompt to a target:

```
<target-slug>-architecture-overview      e.g. valkey-architecture-overview
<target-slug>-<subsystem>-deepdive       e.g. etcd-mvcc-deepdive
<target-slug>-api-reference              e.g. vite-api-reference
<target-slug>-onboarding-guide           e.g. fastapi-onboarding-guide
<target-slug>-adr-reconstruction         e.g. duckdb-adr-reconstruction
```

Output format is Markdown, so per `CONVENTIONS.md` section 4 the `<language>`
level of the workspace path is `markdown`:

```
docs-generation/solutions/<run-id>/<task-id>/markdown/
```

for example `docs-generation/solutions/qwen3.6-27B__vanilla/valkey-architecture-overview/markdown/`.

Every target carries the four target-wide tasks, so those are 6 x 4 = 24 tasks.
The deep dive is per subsystem: each target's `subsystems` array in
`targets.json` lists five project-native slugs (`mvcc`, `wal`, `ignore`,
`globset`, `optimizer`, ...), and `subsystem_paths` records where each one lives
at the pinned SHA. A sweep picks which subsystems it runs; what it may not do is
let the *model* pick, since two runs that documented different subsystems are not
comparable. The subsystem slug is part of the task ID and part of the deliverable
filename, which is why those values are lowercase and file-safe.

---

## 5. Read-only targets, and the citation format

**Checkouts are read-only.** `CONVENTIONS.md` section 10 applies to
`docs-generation/targets/checkouts/` exactly as it applies to a category's
`tasks/` directory. The prompts spell out the prohibition they impose on the
model — no writing under the checkout, no building or running the target, no
writing `git` command, no network — and everything a run produces goes in its own
workspace. `tools/fetch_docs_targets.sh --verify` catches a violation after the
fact: a moved HEAD shows up as a mismatch, and `git -C <checkout> status` shows a
dirty tree. Either one disqualifies the run, because a target that changed
between two runs destroys the comparison this repository exists to make.

**Every non-obvious factual claim about the code carries an inline citation**, in
the same sentence, bullet, or table cell as the claim, in exactly this form:

```
(path/to/file.c:LINE)
(path/to/file.c:START-END)
```

`<path>` is relative to the checkout root — `src/networking.c`, never
`docs-generation/targets/checkouts/valkey/src/networking.c`, never a leading `./`
or `/`, never a GitHub URL. Line numbers are 1-based, `START <= END`, `END` no
further than the last line of the file, and a range spans at most 60 lines. One
path per parenthesis. Examples:

```markdown
A client's write pass stops once it has sent more than
`NET_MAX_WRITES_PER_EVENT` bytes, so one client cannot starve the others —
unless the server is already over `maxmemory`, in which case the cap is
ignored (src/networking.c:2852-2862).
`Ignore::matched_ignore` walks outward from the current directory through
its parents, consulting each level's matchers in turn, which is what gives
the innermost `.gitignore` its precedence (crates/ignore/src/dir.rs:548-575).
```

Why it exists: fluent, confident, wrong prose is the characteristic failure of
this category, and a citation is the cheapest thing that separates a claim the
model read from a claim it invented. Because the tree is pinned to a SHA, a
citation is a total function — a script can resolve every one of them, confirm
the file exists at that commit and that the line range is inside the file, and
compute a citation validity rate that is comparable across runs, models, and
months. That converts "did it actually look at the code?" into a number. It also
makes a reviewer's spot check cheap: open the range and see whether the sentence
is true of it.

A citation that points at a file that does not exist at the pinned SHA, or past
the end of a file that does, is worse than no citation: it is a fabricated
source, and the prompts gate on the validity rate for exactly that reason.

---

## 6. Scoring

Two independent axes, combined per `CONVENTIONS.md` section 9.

**Mechanical (pass/fail, from `test.sh`).** The workspace's `test.sh` runs the
category checker over the produced document against the pinned checkout:

```sh
python3 docs-generation/check_docs.py \
  --doc docs-generation/solutions/<run-id>/<task-id>/markdown/<DELIVERABLE>.md \
  --checkout docs-generation/targets/checkouts/<target-slug>/ \
  --min-words 1800 --max-words 3500 --require-section Overview   # ...per task
```

The per-task flags are not invented at scoring time: they are recorded in
`verify_args` in `docs-generation/tasks/<task-id>/task.json`. The checker
resolves every citation against the checkout, checks required sections, the word
budget, and mermaid block syntax, and exits 0 only when every hard check passes
(1 on failure, 2 on a bad invocation). This axis needs no judge, which is what
makes a vanilla run and a harness run comparable automatically.

Run `tools/fetch_docs_targets.sh --verify` before a scoring pass. The checker's
answers are only meaningful against the exact tree the run read; scoring a
document against a drifted checkout produces plausible numbers that mean nothing.

**Qualitative (rubric).** `docs-generation/rubric.md` defines the scored
dimensions — accuracy, coverage of what matters, structure and navigability,
appropriate depth, unsupported-claim rate — with their weights and band
descriptions, and each prompt states the weights that apply to it. A grader
(human or LLM judge) scores against `rubric.md` and records the result next to
the mechanical result.

Report both. A run can pass every citation check and still be a shallow
document; the gap between the two axes is itself a finding worth reporting.
