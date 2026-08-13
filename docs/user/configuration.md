# Configuration

Every knob conductor and llama-router read, where each file lives, and what changes when
you turn a key. Two JSON documents carry the whole surface: `.conductor/config.json` in
each repo you work in, and `.data/configs/conductor-router.json` in this workspace.

## `.conductor/config.json`

The per-repo manifest. It records how this repository is tested, how much git access
conductor has, how wide the fan-out runs, and which served model answers. It is written on
first run and lives inside the target repo, hidden from git via `.git/info/exclude` rather
than the repo's tracked `.gitignore` — the harness never dirties a target's tracked files
with its own presence.

The schema is [`Config` in `conductor/core/types.ts`](../../conductor/core/types.ts), and it
marks **every** key required with `additionalProperties: false` at every level. An unknown
key is a validation error, not a warning, and there is no key you may omit — except
`itemTest` inside a verify scope, the one optional field that schema declares. The verify
table below lists a second optional scope key, `buildCommand`: it is specified by plan §2.1
and implemented in the evidence engine
([`runWithBuild` in `conductor/adapter/evidence.ts`](../../conductor/adapter/evidence.ts)),
but the exported `Config` schema does not carry it yet, so a config file that sets it fails
validation today. "Default" in the tables below means *the value first-run setup writes*,
not a fallback applied when the key is missing.

```jsonc
{
  "version": 1,
  "verify": {
    // Named scopes. argv arrays ONLY — commands are spawned with shell:false.
    "scopes": {
      "unit": {
        "command": ["node", "--test"],
        "timeoutMs": 600000,
        // Optional targeted-test template. When absent the handlers fall back to
        // the full scope command under quarantine.
        "itemTest": ["node", "--test", "{files}"]
      }
    },
    // Globs whose changes owe verification. Load-bearing twice — see below.
    "behavioralPaths": ["src/**"],
    // Which scopes a change under a path must pass.
    "requiredScopes": [{ "pattern": "**", "scopes": ["unit"] }]
  },
  "format": {
    // Applied to an item's staged files at publish, before the final freshness check.
    "rules": []
  },
  "git": {
    "mode": "commit",                 // asked on first run, never defaulted
    "branchPolicy": "pin",
    "preexistingDirty": "refuse"
  },
  "workflow": {
    "trivialMaxFiles": 2,
    "planReviewers": 4,
    "planReviewMaxRounds": 3,
    "itemReviewers": 6,
    "skepticsPerFinding": 2,
    "reviewMaxRounds": 3,
    "vetCritics": 3,
    "vetMaxRounds": 3,
    "testRepairAttempts": 3,
    "debugFixCap": 3,
    "maxOverridesPerItem": 1,         // the override budget
    "maxOverridesPerRun": 2
  },
  "parallel": {
    "writes": "off",
    "maxImplementers": 2,
    "maxReaders": 6,                  // MUST be <= the server's slot count
    "subSessionTimeoutMs": 900000
  },
  "models": {
    "default": "qwen3.6-27b",
    "roles": {}                       // must stay empty in the base build
  },
  "ponytail": "full",
  "retention": {
    "keepRuns": 20,
    "maxRunDirBytes": 268435456,      // 256 MiB
    "pruneOnRunCreate": true
  },
  "logging": { "level": "info", "components": {} }
}
```

### verify

| Key                          | Type                         | Default                                   | What it changes                                                                                                                                                                    |
| ---------------------------- | ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify.scopes`              | object of scope specs        | one `unit` scope                          | Named test commands. The key is the scope name used by `requiredScopes`.                                                                                                           |
| `scopes.<name>.command`      | string array                 | `["node", "--test"]`                      | The full-scope command, argv only. Spawned with `shell:false`, so shell syntax is not interpreted.                                                                                 |
| `scopes.<name>.timeoutMs`    | number                       | `600000`                                  | Wall-clock cap for one run of this scope.                                                                                                                                          |
| `scopes.<name>.itemTest`     | string array                 | detected per runner                       | Optional targeted-test template. See below.                                                                                                                                        |
| `scopes.<name>.buildCommand` | string array                 | absent                                    | Optional; runs before the test command. If it fails the scope is red with `phase: "build"` and the test command is **not** run — tests against a stale artifact are a false green. |
| `verify.behavioralPaths`     | string array                 | asked at setup                            | Globs whose changes owe verification. Load-bearing twice.                                                                                                                          |
| `verify.requiredScopes`      | array of `{pattern, scopes}` | `[{"pattern": "**", "scopes": ["unit"]}]` | Maps a path glob to the scope names a change under it must pass. Every entry whose pattern matches contributes its scope names, deduped.                                           |

#### `verify.behavioralPaths`

This is the single most consequential value in the file, because two independent mechanisms
read it:

1. **The freshness rule.** Only staged *behavioral* files can void a verify. An edit to a
   file matching `behavioralPaths` after the verify's start-stamp invalidates the evidence
   and the item must re-verify.
2. **The `behavioral: false` path arithmetic.** An item may declare `behavioral: false` —
   and so skip `RED` and `TEST_VETTED` entirely — only if **every** glob in its `fileScope`
   is disjoint from `behavioralPaths`. That makes "just skip the failing test" mechanically
   impossible for real code and trivially legal for a comment fix.

A wrong value here is the difference between an enforced TDD law and an optional one, which
is why setup proposes a value per ecosystem and asks the user to confirm or correct it
rather than writing a silent default. The proposals: node `src/**`, `lib/**`; python
`<pkg>/**`; go `**/*.go` minus `**/*_test.go`; cmake `src/**`, `include/**`.

#### `verify.scopes[].itemTest`

The targeted-test template. `conductor_submit_test` and `conductor_mark_green` substitute
the item's `testScope` into it and run the result, so one item's red does not require the
whole suite. Three substitutions exist, each for a different runner's targeting model:

| Token     | Expands to                                                        | Why it exists                                                                                                               |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `{files}` | the item's `testScope` files, as argv entries                     | Runners that take file paths: `node --test {files}`, `pytest {files}`.                                                      |
| `{dirs}`  | the unique parent directories of those files, in `./dir` form     | Go targets *packages*. `-run` with file basenames matches nothing and lies with exit 0, so the default is `go test {dirs}`. |
| `{name}`  | an alternation regex over the file basenames, extensions stripped | Runners whose registered test names contain the file name: `ctest -R {name}`. Valid only under that convention.             |

Two guards keep a targeted run honest:

- **The fallback rule.** When `itemTest` is absent, the handler runs the full scope command
  instead — under the quarantine described in
  [evidence and quarantine](../developer/evidence-and-quarantine.md) — and *additionally*
  requires the failure excerpt to name a file in the item's `testScope`. A suite failure
  somewhere else must not impersonate this item's red.
- **The zero-test guard.** A targeted run that executed no tests is neither a legal red nor
  a pass. The evidence engine carries per-runner zero-test patterns as data (for example
  node's `# tests 0` and `no tests to run`, pytest's `collected 0 items`, go's
  `no test files`, ctest's `Total Tests: 0`); on a match it falls back to the quarantined
  full-scope run plus the excerpt rule and journals a targeting warning.

### format

`format.rules` is an ordered array; the first matching rule per file wins. The
`conductor_publish` handler applies them to the item's staged files before the final
freshness check.

| Key                      | Type                   | Default | What it changes                |
| ------------------------ | ---------------------- | ------- | ------------------------------ |
| `format.rules[].pattern` | string glob            | —       | Which files this rule covers.  |
| `format.rules[].mode`    | `"stdin"` \| `"check"` | —       | How the formatter is invoked.  |
| `format.rules[].command` | string array           | —       | argv; `{file}` is substituted. |

In `stdin` mode the file content is piped to the command and, when stdout differs byte-wise,
written back and restaged. A non-zero exit, a spawn failure, or empty stdout on non-empty
input is a *formatter failure*: publish is denied naming the formatter and the file is never
overwritten, because a crashed formatter's stdout is not a formatting verdict. In `check`
mode a non-zero exit means dirty and publish is denied naming the file and the rule; there
is no auto-fix.

### git

| Key                    | Type                                               | Default        | What it changes                                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git.mode`             | `"read-only"` \| `"commit"` \| `"commit-and-push"` | asked at setup | How far conductor may go. `read-only` means no commits at all; `commit` lets publish commit; `commit-and-push` additionally pushes.                                                                                                                            |
| `git.branchPolicy`     | `"pin"` \| `"check-only"`                          | `"pin"`        | `check-only` records `HEAD` at run start and refuses a publish whose verify judged a different `HEAD`. `pin` does that *and* denies every branch-movement command for the duration of a non-terminal run.                                                      |
| `git.preexistingDirty` | `"refuse"` \| `"exclude"`                          | `"refuse"`     | What happens when a path inside an item's `fileScope` was already dirty at run start. `refuse` blocks that item's publish with a surfaced question; `exclude` publishes anyway, staging only harness-changed paths and listing the skipped ones in the report. |

`git.mode` is one of the two questions setup may not default. Publish stages only files the
harness itself changed since run start — a green on one branch is not a green on another,
and the user's unrelated WIP is never swept into a conductor commit whose message and
red-proof describe something else.

If the workspace is not a git repository, setup offers exactly one choice: initialize a repo
here, or run in **no-git mode**. No-git mode sets `git.mode: "read-only"`, disables publish
(items terminate at `REVIEWED` with their diff recorded in the report), disables worktree
mode, and drops the `HEAD` term from the freshness rule. The FSMs, gates, evidence, and
review are unchanged.

### workflow

Every round cap and fan-out width in the pipeline.

| Key                   | Type   | Default | What it changes                                                                                                                                                                                                                             |
| --------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trivialMaxFiles`     | number | `2`     | Ceiling for the trivial path. A synthesized trivial item touching more files than this is escalated to `work` by the handler, whatever the classifier said. It bounds only the trivial path: decomposition enforces its own fixed item budget of five files (`ITEM_MAX_FILES` in [`core/planning.ts`](../../conductor/core/planning.ts)), deliberately independent of this key so that tuning the trivial ceiling never silently retunes decompose. |
| `planReviewers`       | number | `4`     | Parallel plan-review lenses per round.                                                                                                                                                                                                      |
| `planReviewMaxRounds` | number | `3`     | Cap on the plan review → revise → re-review loop.                                                                                                                                                                                           |
| `itemReviewers`       | number | `6`     | Lens sessions per item review. Sessions are `clamp(itemReviewers, 3, 6)`; below 6 the lenses merge pairwise from the tail, and the mandatory lens set is never truncated away.                                                              |
| `skepticsPerFinding`  | number | `2`     | K refuters per finding. A finding survives iff upholds ≥ `⌈K/2⌉` — a tie upholds, so a split finding earns a fix round.                                                                                                                     |
| `reviewMaxRounds`     | number | `3`     | Per item: review → fix → re-review cap.                                                                                                                                                                                                     |
| `vetCritics`          | number | `3`     | Critics dispatched to reach `TEST_VETTED`.                                                                                                                                                                                                  |
| `vetMaxRounds`        | number | `3`     | `RED`: vet → repair → re-vet cap. A distinct knob from `reviewMaxRounds` — different loop, different cost, tuned independently.                                                                                                             |
| `testRepairAttempts`  | number | `3`     | Illegal-red repair attempts inside `conductor_submit_test`.                                                                                                                                                                                 |
| `debugFixCap`         | number | `3`     | Failed fixes before the run escalates to an architecture question.                                                                                                                                                                          |
| `maxOverridesPerItem` | number | `1`     | Override budget per item.                                                                                                                                                                                                                   |
| `maxOverridesPerRun`  | number | `2`     | Override budget per run.                                                                                                                                                                                                                    |

The last two are the override budget. `conductor_override` records an anomaly, appends to
the item's `taint[]`, and disables one named gate for exactly one next action. Every gate in
the system is advisory to a model that can call it without limit, and a struggling local
model will find it, because the deny messages name it. Exhausting the budget is an `env`
stop — never another override. See [gates and hatches](gates-and-hatches.md).

### parallel

| Key                            | Type                     | Default  | What it changes                                                                                                                                                                              |
| ------------------------------ | ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parallel.writes`              | `"off"` \| `"worktrees"` | `"off"`  | Whether concurrent implementers each get their own git worktree.                                                                                                                             |
| `parallel.maxImplementers`     | number                   | `2`      | Maximum wave width — the most items that may be implemented concurrently.                                                                                                                    |
| `parallel.maxReaders`          | number                   | `6`      | Reviewer and critic fan-out ceiling.                                                                                                                                                         |
| `parallel.subSessionTimeoutMs` | number                   | `900000` | Fan-out watchdog per sub-session. Deliberately greater than the router's `queueTimeoutMs`, so a queue timeout reports as a queue timeout rather than as two simultaneous unrelated failures. |

`parallel.maxReaders` must be **less than or equal to the server's slot count**. If it is
not, the fan-out serializes upstream and the parallelism is imaginary: conductor cheerfully
dispatches six reviewers, llama-server runs them one at a time, and every wall-clock claim
in the design is false. This is not left to chance —`serve.py` derives llama-server's
`--parallel <slots>` and the router's `maxInflightPerModel` from this one number so the
three cannot drift, and setup probes the live server to verify the observed concurrent slot
count actually reaches it.

### models

| Key              | Type                      | Default         | What it changes                                                                                                                                |
| ---------------- | ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `models.default` | string                    | `"qwen3.6-27b"` | The served model id — a section name in `.data/configs/llama-models.ini`, as exposed by `/v1/models`. Every sub-session in every role runs it. |
| `models.roles`   | object of role → model id | `{}`            | Per-role overrides.                                                                                                                            |

One model serves every role. A role selects a doctrine pack, a sampling temperature, a gate
posture, and a router priority tag — never weights. `models.roles` **must stay empty in the
base build**: a non-empty map is accepted by the schema, so multi-model experiments need no
code change, but it logs a warning at init and is outside the supported and tested surface.
Swap batching, per-model wave wall-clock, and the POC's arm design all assume it is empty.

Setup and every run start validate `models.default` against the live `/v1/models` list and
fail loudly if it is absent.

### ponytail

`ponytail` is `"lite"`, `"full"` (the default), or `"ultra"`, and sets minimality intensity.

| Value   | Effect                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lite`  | The ponytail ladder rung is recorded and advisory.                                                                                                                                            |
| `full`  | The decomposition handler rejects items whose ladder rung is `minimal-code` with an empty `reuse` note — you must show you looked. Minimality findings at plan review are `major` by default. |
| `ultra` | Additionally, the planner is instructed to challenge requirements and ship minimal versions, and unrequested-abstraction findings block publish.                                              |

Guardrails are intensity-independent. Security, input validation at trust boundaries,
data-loss handling, and accessibility are never lazy-able; the guardrail and minimality
lenses are in the mandatory review set that no configuration removes.

### retention

`.conductor/` lives inside the user's repo and is invisible to git, which means nothing ever
notices it growing. At `trace` the journal contains full sub-session prompts and outputs —
large slices of the repo, once per lens, per round, per item.

| Key                          | Type    | Default     | What it changes                                                  |
| ---------------------------- | ------- | ----------- | ---------------------------------------------------------------- |
| `retention.keepRuns`         | number  | `20`        | Archived run directories retained, newest first.                 |
| `retention.maxRunDirBytes`   | number  | `268435456` | 256 MiB. A journal exceeding it rotates to `journal.N.jsonl.gz`. |
| `retention.pruneOnRunCreate` | boolean | `true`      | Pruning runs at run creation, never mid-run.                     |

### logging

| Key                  | Type                                                        | Default  | What it changes                                                                                                               |
| -------------------- | ----------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `logging.level`      | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"info"` | Global journal level.                                                                                                         |
| `logging.components` | object of component → level                                 | `{}`     | Per-component override. Components: `fsm`, `gates`, `fanout`, `evidence`, `continuation`, `inject`, `router-client`, `state`. |

`error` and `warn` records are written regardless of level. At `debug`, gate decisions log
their full input snapshot; at `trace`, sub-session prompts and raw structured outputs are
included. `CONDUCTOR_LOG` in the environment beats both keys — see
[environment variables](#environment-variables) and [observability](observability.md).

## Where the file comes from

*The interactive `conductor_setup` flow lands at task 12.2; until then the file is written by hand.*

On first run in a repo, conductor detects what it can, asks the two questions it may not
default, and writes the file. Detection reads `package.json`, `CMakeLists.txt` plus `ctest`,
`pyproject.toml`, `Cargo.toml`, and `go.mod` to propose verify scopes, and each detected
runner carries its default `itemTest` template: `node --test {files}`, `pytest {files}`,
`go test {dirs}`, `ctest -R {name}`.

The two questions with no default:

1. **`git.mode`** — how much git access conductor has. There is no safe guess between
   "never commit" and "commit and push".
2. **`verify.behavioralPaths`** — proposed per ecosystem, confirmed or corrected by the
   user, because it decides whether the TDD law is enforced or optional.

Setup then proves every assumption it just recorded, because each one is otherwise
discovered mid-run as a confusing failure. A failed check is a setup failure with a named
remedy, not a warning.

| Checked at setup                                                                                                | Failure mode it prevents                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Every configured command is smoke-spawned                                                                       | An unspawnable test command surfaces at the first verify, mid-item.                                  |
| `models.default` appears in the live `/v1/models`                                                               | Every sub-session dispatch fails after decomposition, is retried twice each, and the run ends `env`. |
| The served model answers one tiny schema-constrained request                                                    | Constrained sampling is unsupported for this model — discovered before the pipeline depends on it.   |
| Observed concurrent slot count ≥ `parallel.maxReaders` (N concurrent trivial completions, measured for overlap) | The entire read fan-out silently serializes upstream and every parallelism claim is false.           |
| The repo is a git repo                                                                                          | Publish, freshness, worktrees, and `.git/info/exclude` all assume one.                               |

Setup also registers `.conductor/` in the repo's `.git/info/exclude`. Re-running it later
requires `reconfigure: true`, which is legal only with no live run and journals a config
diff.

## Router configuration

> *Not yet wired: llama-router parses this document today (task 11.2); the proxy, admission, affinity, schema observer, and metrics land in 11.3–11.8, and `serve.py` generates the file from task 12.1.*

`.data/configs/conductor-router.json` configures llama-router. It is generated by `serve.py`
in this workspace and is hand-editable. The parser is
[`src/router/config.hpp`](../../src/router/config.hpp); it validates against the
`RouterConfig` JSON Schema exported from the same
[`conductor/core/types.ts`](../../conductor/core/types.ts) that the plugin uses — single
source, two consumers.

```jsonc
{
  "version": 1,
  "listen":   { "host": "127.0.0.1", "port": 8088 },
  "upstream": { "host": "127.0.0.1", "port": 8080 },
  "admission": {
    "maxInflightPerModel": 4,        // <= llama-server's --parallel slot count
    "maxQueued": 64,
    "queueTimeoutMs": 600000         // < parallel.subSessionTimeoutMs
  },
  "priorities": { "interactive": 0, "review": 1, "batch": 2 },   // lower = first
  "affinity": { "header": "X-Conductor-Group", "contiguousDequeue": true },
  "schema": {
    "observeHeader": "X-Conductor-Schema",
    "validateResponses": true,
    "rejectOnMissing": false         // must stay false in the base build
  },
  "metrics": { "ledgerPath": ".data/router/metrics.jsonl" },
  "logging": { "level": "info" }
}
```

| Key                                             | Type                  | Default                      | What it changes                                                                                                                             |
| ----------------------------------------------- | --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                                       | number                | `1`                          | Document version.                                                                                                                           |
| `listen.host` / `listen.port`                   | string / number       | `127.0.0.1` / `8088`         | Where the router accepts requests. Ports are range-checked to 1..65535.                                                                     |
| `upstream.host` / `upstream.port`               | string / number       | `127.0.0.1` / `8080`         | The `llama-server` the router proxies to.                                                                                                   |
| `admission.maxInflightPerModel`                 | number                | `4`                          | Concurrent requests admitted per model. Must be ≤ the server's `--parallel` slot count; `serve.py` generates both from one number.          |
| `admission.maxQueued`                           | number                | `64`                         | Queue depth before overflow. Overflow returns a 503 the fan-out engine understands and backs off from.                                      |
| `admission.queueTimeoutMs`                      | number                | `600000`                     | How long a queued request waits before a 503. Kept below `parallel.subSessionTimeoutMs` so a queue timeout is reported as itself.           |
| `priorities.interactive` / `.review` / `.batch` | number                | `0` / `1` / `2`              | Dequeue order for the `X-Conductor-Priority` tag; lower goes first. Untagged requests count as `interactive`.                               |
| `affinity.header`                               | string                | `X-Conductor-Group`          | The header carrying the prefix-affinity group id.                                                                                           |
| `affinity.contiguousDequeue`                    | boolean               | `true`                       | Dequeue same-group requests contiguously, so llama-server's slot reuse keeps the shared KV prefix hot.                                      |
| `schema.observeHeader`                          | string                | `X-Conductor-Schema`         | The header marking a structured-output request.                                                                                             |
| `schema.validateResponses`                      | boolean               | `true`                       | Validate non-streaming tagged response bodies against the declared schema and record the verdict. The body is returned verbatim either way. |
| `schema.rejectOnMissing`                        | boolean               | `false`                      | Must stay `false` in the base build.                                                                                                        |
| `metrics.ledgerPath`                            | string                | `.data/router/metrics.jsonl` | One JSONL line per request: model, role, group, priority, queue-wait, upstream time, tokens, `schemaMissing`, `schemaConformed`, status.    |
| `logging.level`                                 | `"error"` … `"trace"` | `"info"`                     | spdlog level. A value outside the five is refused by name, never silently downgraded.                                                       |

The parser fills three documented-optional keys before validating — `logging.level`,
`schema.rejectOnMissing`, and `affinity.contiguousDequeue` — because the exported schema
marks every key required. Anything else missing, any unknown key (such as a `batching`
block), a port outside 1..65535, or an unusable `logging.level` throws a `ConfigError` whose
message always names the offending field by its dotted path, such as `listen.port` or
`admission.bogus`.

`schema.rejectOnMissing` stays `false` because the router observes schema conformance and
never enforces it. A tagged request arriving without its schema field is journaled, counted
as `schemaMissing`, and proxied unchanged. If the router could turn a request the direct
path would have served into a 400, then "`serve.py --no-router` runs the identical process"
stops being true, a plugin bug that is survivable without the router becomes fatal with it,
and the fail-soft dependency direction inverts. Enforcement belongs to the fan-out engine's
receipt validation, which runs in both configurations. The key exists so that a stricter
posture is a config change rather than a fork.

## Environment variables

| Variable                              | Read by                   | Effect                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONDUCTOR_LOG=<level>`               | the plugin journal        | Bare form. Raises the global log level, beating `logging.level`.                                                                                                                                                                                                                              |
| `CONDUCTOR_LOG=<component>:<level>,…` | the plugin journal        | Per-component form, comma-separated, e.g. `fanout:trace,gates:debug`. Beats `logging.components`. Components not named keep their configured level, and an unrecognized level is ignored rather than allowed to silence a component by typo. Both forms may be mixed in one value.            |
| `OPENCODE_CONFIG`                     | opencode                  | Absolute path to the session opencode config. `serve.py` writes `.data/configs/opencode.json` and exports this into the subshell it spawns; that export is how the harness travels into a target workspace. A plain `opencode` in another terminal does not see it, and is therefore ungated. |
| `HF_TOKEN`                            | `scripts/fetch_models.py` | Bearer token for gated HuggingFace repos. `HUGGING_FACE_HUB_TOKEN` is accepted as a fallback name.                                                                                                                                                                                            |
| `HF_ENDPOINT`                         | `scripts/fetch_models.py` | Mirror to use instead of `https://huggingface.co`.                                                                                                                                                                                                                                            |
| `LLAMA_SERVER`                        | `scripts/fetch_models.py` | Explicit path to a `llama-server` binary. Consulted only for `llama-server`, and only after the submodule build under `.data/tools/` is checked; `PATH` is the last resort.                                                                                                                   |
| `NO_COLOR`                            | the Python scripts        | Any non-empty value disables colored output.                                                                                                                                                                                                                                                  |

## Runtime state layout

Conductor keeps two trees: one inside the repo it is working on, and one outside every repo.

```text
<target repo>/
└── .conductor/                   # runtime state, hidden via .git/info/exclude
    ├── config.json               # the manifest documented above
    ├── state/
    │   ├── current-run.json      # pointer {runId} or null
    │   ├── alive.json            # liveness beacon {pid, startMs, version}
    │   ├── stale-red.json        # cross-run registry of abandoned red tests
    │   ├── halt                  # owner-only halt file; presence means halt
    │   └── run.lock              # advisory single-writer lock {pid, startMs}
    └── runs/<runId>/             # one self-contained directory per prompt-run
        ├── run.json              # run FSM state and metadata
        ├── queue.json            # decomposed items and their DAG
        ├── items/<itemId>.json   # per-item FSM state and evidence refs
        ├── plan.md               # the plan document
        ├── report.md             # written on EVERY terminal stop, not only `done`
        ├── journal.jsonl         # the structured event journal
        ├── evidence.jsonl        # red / green / verify records
        ├── decisions.jsonl       # decision-protocol ledger
        ├── anomalies.jsonl       # overrides, gate crashes, disengages
        ├── questions.jsonl       # surfaced questions; the blocked-set source
        └── reviews/<itemId|plan>-r<N>.json
```

`alive.json` is rewritten at plugin init; its absence means conductor is not loaded in this
session. `halt` is owner-only — the model never creates, edits, or deletes it. Nothing in
`.conductor/**` is writable by any agent, in any role.

Two things live deliberately **outside** the repository:

```text
<stateHome>/conductor/<workspaceKey>/
├── quarantine/<runId>/           # foreign red tests moved aside during a verify,
│                                 #   plus manifest.json for crash-safe restore
└── worktrees/<runId>/<itemId>/   # parallel-implementer worktrees
```

`.git/info/exclude` hides a directory from git. It hides it from nothing else. The verify
command is the target repo's own test command, and every runner the harness ships defaults
for — `node --test`, `pytest`, `go test ./...`, `ctest` — discovers tests by walking the
tree. A red test file parked under `.conductor/` can still be collected and executed by the
very verify it was moved aside to protect, and a worktree, being a complete second checkout
of every test file in the repo, is guaranteed to be. Per-runner behavior for dot-directories
is a version-dependent accident and is not relied on; correctness comes from the files being
outside the walked tree entirely. This was measured, not assumed — see
[`conductor/docs/RUNNER-DISCOVERY.md`](../../conductor/docs/RUNNER-DISCOVERY.md).

The two path components:

| Component        | Value                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `<stateHome>`    | `$XDG_STATE_HOME` when set, otherwise `~/.local/state`. macOS included — the path is identical on both platforms.                               |
| `<workspaceKey>` | The repo root's absolute path hashed with SHA-256, first 16 hex characters, plus its basename. Two checkouts of the same project never collide. |

Router state lives in this workspace instead: the metrics ledger at
`metrics.ledgerPath`, which defaults to `.data/router/metrics.jsonl` under the gitignored
`.data/` tree alongside `.data/configs/` and `.data/models/`.

## See also

- [Serving models](serving.md) — how `serve.py` produces the session config and launches the router
- [Gates and hatches](gates-and-hatches.md) — what `maxOverrides*` and `git.mode` actually enforce
- [Observability](observability.md) — reading the journal that `logging.*` controls
- [llama-router](../developer/llama-router.md) — the router internals behind the router config
- [Schemas](../developer/schemas.md) — the single-source schema definitions and their two consumers
