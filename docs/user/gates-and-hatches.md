# Gates and hatches

What conductor refuses, why it refuses it, and what to do instead. This page is for the
person watching a session get denied — not for the person implementing the gate. For the
internals, see [gates.md](../developer/gates.md).

## How a denial works

Conductor's gates run in opencode's `tool.execute.before` hook, which fires for every tool
call in every conductor-managed session — the orchestrator and every sub-session alike.
The hook has exactly two outcomes: it returns, and the tool runs, or it throws, and the
tool never runs.

A deny is `throw new Error(reason)`. opencode turns the thrown message into the tool
result the model reads back, so the refusal text *is* the feedback channel. Every deny
message names the rule that was violated and, where one exists, the legal alternative:

```text
git commit publishes changes — publishing is conductor_publish's job, not a model session's
```

That is the whole design. The model does not need to be taught the rules up front; it
discovers the boundary by hitting it and reads the correct next move out of the error.
Denials are cheap and expected — a run with a handful of them is normal, not a failure.

Every deny is also journaled at `warn` under `gates/deny` with an input snapshot: the tool
name, the raw arguments, the offending command or path, and the reason. That snapshot is
enough to reproduce the decision through the pure gate function in a test, which is how a
disputed refusal gets settled.

## Gate order for a bash call

The gates run in a fixed order, and the first deny wins. `bash` is the interesting case
because one command can trip several of them.

```mermaid
---
config:
    theme: 'base'
    curve: 'straight'
    themeVariables:
        darkMode: true
        clusterBkg: '#22272f62'
        clusterBorder: '#6a6f77ff'
        clusterTextColor: '#C1C4CAff'
        lineColor: '#C1C4CAAA'
        background: '#262B33'
        primaryColor: '#3a3f47ff'
        primaryTextColor: '#C1C4CAff'
        primaryBorderColor: '#6a6f77ff'
        primaryLabelBkg: '#262B33'
        secondaryColor: '#425f5fff'
        secondaryBorderColor: '#8c9c81ff'
        secondaryTextColor: '#C1C4CAff'
        tertiaryColor: '#4d4962ff'
        tertiaryBorderColor: '#8983a5ff'
        tertiaryTextColor: '#C1C4CAff'
        nodeTextColor: '#C1C4CA'
        defaultLinkColor: '#C1C4CA'
        edgeLabelBackground: '#262B33'
        labelTextColor: '#C1C4CA'
---
flowchart TD
%% Source: conductor/adapter/tools.ts gateBeforeToolCall
    CALL["bash call arrives"] --> PATCH{"patch-tool refusal"}
    PATCH -->|"patch / apply_patch"| DPATCH["deny outright"]
    PATCH -->|"any other tool"| SESS{"session-registry gate"}
    SESS -->|"task tool, any session"| DSPAWN["deny spawn"]
    SESS -->|"unregistered writer"| DREG["deny no assignment"]
    SESS -->|"registered or stray read"| GIT{"git policy, every segment"}
    GIT -->|"any denied git segment"| DGIT["deny names subcommand"]
    GIT -->|"no git or read-only git"| STATE{"interpreter state-area rule"}
    STATE -->|"program text names .conductor"| DSTATE["deny whole command"]
    STATE -->|"no mention"| EDIT{"edit scope, per write target"}
    EDIT -->|"freeze or out of scope"| DEDIT["deny names the scope"]
    EDIT -->|"no write shape, or all in scope"| OK["allow, the tool runs"]

    linkStyle default stroke:#C1C4CAaa,stroke-width:2px,color:#C1C4CAaa

    classDef neutral fill:#3a3f47,stroke:#6a6f77,color:#C1C4CA,rx:6,ry:6
    classDef accent  fill:#2b4268,stroke:#779DC9,color:#ffffff,rx:6,ry:6
    classDef err     fill:#724848,stroke:#ac9696,color:#ffffff,rx:6,ry:6
    classDef ok      fill:#425f5f,stroke:#8c9c81,color:#ffffff,rx:6,ry:6

    class CALL accent
    class PATCH,SESS,GIT,STATE,EDIT neutral
    class DPATCH,DSPAWN,DREG,DGIT,DSTATE,DEDIT err
    class OK ok
```

The first step refuses the `patch` and `apply_patch` tools by name, in every session, before
any other question is asked. A patch body carries its own write targets in a format no gate
here parses, and the single `args.filePath` the edit branch reads is absent from exactly the
multi-file shape that matters — so there is no adjudicable payload to reach a scope decision
with. Use `edit` or `write`, whose target is one path this session's scope is checked
against.

An `edit`/`write` call skips the git and interpreter stages and goes straight from the
registry gate to the edit-scope gate over the edited path. A `conductor_*` call is checked by
the registry gate here, and then by its own legality choke point inside the plugin — a
separate mechanism, described in [the tool reference](./tool-reference.md).

## The session-registry gate

Conductor keeps a registry mapping `sessionID` to `{role, itemId, tree}`. The fan-out
engine writes an entry when it creates a sub-session; the `chat.message` hook writes one
for the orchestrator. A session with no entry is a session conductor did not create, so it
has no role, no item, and no file scope.

The registry gate runs first, before every other gate, and dispatches on the tool's class.

| Tool class | Example                                                    | Disposition for a session with no registry entry                           |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| read       | `read`, `grep`, `glob`, `list`, `bash` with no write shape | allow — a stray reader is harmless, and failing it would only be confusing |
| write      | `edit`, `write`, write-shaped `bash`                       | **deny** — "this session has no conductor item assignment"                 |
| conductor  | any `conductor_*` tool                                     | **deny** — state advances only from registered sessions                    |
| spawn      | opencode's `task` tool                                     | **deny in every session, registered or not**                               |

`patch` and `apply_patch` still classify as writes — so a gate crash on one fails closed —
but they never reach this table: the patch-tool refusal above them denies them outright.

A registered session passes this gate for anything except a spawn. What it may *write* is
the edit-scope gate's question, not this one's.

**Why spawning is denied everywhere.** This is the load-bearing half of the gate. Without
it, an implementer could call `task`, get a child session conductor never registered — no
role, no item, no scope — and have that child perform exactly the writes the implementer
is gated out of. A registry-based gate whose registry can be grown by a tool call is not a
gate. Conductor's own fan-out is unaffected: it creates sessions through the opencode SDK,
which is not a tool call and never reaches this gate.

One detail worth knowing: a `bash` command with no write shape classifies as `read`, even
if it contains a git write. That is deliberate. The git gate runs for registered and
unregistered sessions alike, so `git commit` from a stray session is still denied — just by
the next gate down, with a message about publishing rather than about registration.

A `bash` command classifies as a write in one further case with no path-shaped target at all:
an interpreter one-liner whose program text names the `.conductor` state area. Such a command
is refused downstream, and a call refused as a write must not have been classified as a
harmless read on the way in — the fail-closed crash posture reads that classification.

## Git policy

Git is the widest hole in any edit gate: `git apply` writes arbitrary files, `git checkout
--` destroys them, and `git reset` rewrites history, none of which look like an edit tool
call. So git gets its own gate with an **enumerated-allow, default-deny** posture. Any git
subcommand not explicitly listed is denied, and the denial names the subcommand.

The asymmetry is the argument. A missing allow row costs an annoyed model one
`conductor_surface` call. A missing deny row costs the entire edit-scope gate, because
`git apply` walks straight around it. The two failure modes are not comparable, so the
default goes to deny.

One thing this gate does **not** do is vary by role or by `git.mode`. Every session gets the
same git policy — an implementer, a reviewer and the orchestrator alike — and `git.mode` is
consulted nowhere in it. The only decision `git.mode` changes is what `conductor_publish`
does with the item it is publishing. The single policy input the gate does read is
`git.branchPolicy`, and only for branch movement.

### Dispositions

| Command                                                                                                                                                                                                                                 | Disposition                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`, `log`, `diff`, `show`, `ls-files`, `ls-tree`, `rev-parse`, `rev-list`, `cat-file`, `blame`, `shortlog`, `describe`, `grep`                                                                                                    | allow, whatever the operands                                                                                                                                             |
| `branch` list forms, `stash list`, `worktree list`, `remote -v`, `config --get`/`--list`, `reflog show`, `restore --staged`                                                                                                             | allow                                                                                                                                                                    |
| `add`, `mv`, `rm`, `stash push` (and bare `git stash`)                                                                                                                                                                                  | deny — staging is `conductor_publish`'s job                                                                                                                              |
| `commit`, in any spelling                                                                                                                                                                                                               | deny — publishing is `conductor_publish`'s job                                                                                                                           |
| `push`, in any spelling including force and refspec forms                                                                                                                                                                               | deny — pushing is `conductor_publish`'s job                                                                                                                              |
| `reset`, `rebase`, `filter-branch`, `filter-repo`, `clean`, `merge`, `cherry-pick`, `revert`, `am`, `apply`, `update-ref`, `symbolic-ref`, `sparse-checkout`, `submodule`, `bisect`, `gc`, `prune`, `notes`, `replace`, `fetch`, `pull` | deny — destructive, history-manipulating, network-mutating, or a write path around the edit gate                                                                         |
| `stash drop`/`clear`/`pop`/`apply`/`save`                                                                                                                                                                                               | deny — mutates the stash                                                                                                                                                 |
| `worktree add`/`remove`/`move`/`prune`                                                                                                                                                                                                  | deny — worktrees belong to conductor's own worktree adapter                                                                                                              |
| `remote` anything but `-v`                                                                                                                                                                                                              | deny — mutates remotes                                                                                                                                                   |
| `config <key> <value>`, `config --unset`                                                                                                                                                                                                | deny — only the `--get`/`--list` read forms are allowed                                                                                                                  |
| `reflog expire`/`delete`                                                                                                                                                                                                                | deny — only `reflog show` is allowed                                                                                                                                     |
| `branch` with any flag outside the list-form enumeration, or with a positional operand and no `--list`                                                                                                                                  | deny — creating, deleting, renaming, copying or re-pointing a branch writes a ref                                                                                        |
| `checkout --`, `checkout <path>`, multi-operand `checkout`, `checkout -B`, `checkout -f`, `checkout -p`/`--patch`                                                                                                                       | deny — discards or force-creates, unconditionally                                                                                                                        |
| `switch -C`, `switch -f`/`--force`/`--discard-changes`                                                                                                                                                                                  | deny — force-create or discard, unconditionally                                                                                                                          |
| `restore` without `--staged`, `restore --worktree`                                                                                                                                                                                      | deny — the default restore target is the working tree                                                                                                                    |
| branch movement: `switch <br>`, `checkout <br>`, `checkout -b`                                                                                                                                                                          | deny while a run is non-terminal under `git.branchPolicy: "pin"` (the default); allowed under `"check-only"`, where publish's HEAD check catches the consequence instead |
| bare `git` with no subcommand                                                                                                                                                                                                           | deny                                                                                                                                                                     |
| `git -c <key>=<cmd> …` where `<key>` is exec-capable                                                                                                                                                                                    | deny **before** the subcommand is looked at — see below                                                                                                                  |
| `GIT_PAGER=<cmd> git …` and the other exec-capable environment prefixes                                                                                                                                                                 | deny before the subcommand is looked at — see below                                                                                                                      |
| anything else                                                                                                                                                                                                                           | **deny by default**, naming the subcommand and inviting `conductor_surface`                                                                                              |

`git branch` deserves a second look, because its rule is the opposite shape from what it
looks like. It is an **enumerated allow with a default-deny tail**: a flag must be on the
list-form enumeration (`--list`, `-a`, `-r`, `-v`, `--contains`, `--merged`, `--sort`,
`--format` and their siblings), and a positional operand denies unless `--list` makes it a
match pattern. Built the other way round — allow everything except a hand-list of mutating
flags — it admitted bare branch *creation*, since `git branch newbranch` writes a ref with no
flag at all. One deliberate sharp edge: `-l` is a list flag on its own but is **not** treated
as a pattern flag, because on git before 2.28 `-l` spells `--create-reflog` and
`git branch -l topic` creates `topic`. The gate cannot see which git is on the other side of
the call, so the ambiguous spelling is read as the one that writes.

### The execution routes that ride a legal subcommand

Two routes run an arbitrary program under a subcommand the allow-list permits, so both are
decided *before* the subcommand is even resolved:

- **Config-driven.** `git -c core.pager=<cmd> log` runs `<cmd>`. The command word is the
  literal `git`, `-c k=v` is skipped by subcommand resolution, and the decision would land on
  an allow-listed read-only verb. The gate denies when the key is exec-capable — either its
  section is one of `alias`, `pager`, `credential`, `difftool`, `mergetool`, `filter`,
  `trailer`, `guitool`, `instaweb`, or its final component is one of a list of leaves such as
  `pager`, `editor`, `external`, `command`, `helper`, `sshcommand`, `hookspath`, `textconv`.
  Section and key names are compared case-folded, which is git's own rule. `git -c
  user.name=x log` is untouched.
- **Environment-driven.** `GIT_PAGER=<cmd> git log` is the same route through the
  environment. The gate denies an exec-capable assignment prefix — `GIT_PAGER`,
  `GIT_EXTERNAL_DIFF`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_SSH`, `GIT_SSH_COMMAND`,
  `GIT_ASKPASS`, `GIT_PROXY_COMMAND`, `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`, `GIT_TEXTCONV`,
  `GIT_ALTERNATE_OBJECT_DIRECTORIES`, the `GIT_CONFIG*` family, `PAGER`, `EDITOR`, `VISUAL`,
  and anything starting `GIT_CONFIG_KEY_` or `GIT_CONFIG_VALUE_`. `A=b git status` is
  untouched.

`conductor_publish` itself is not affected by any of this: it runs git through `execFile`
inside the plugin, which is not a tool call and never reaches the gate.

### Matching is parsing, not pattern matching

The gate never runs a substring regex over the command text. It tokenizes with a
quote-aware splitter, splits on shell operators and newlines, and decides over the parsed
tokens of each segment. That is what keeps the false-positive rate at zero on ordinary
commands:

| Command                           | Parses as                | Disposition                                                      |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `git add src/config.ts`           | `add`                    | deny (staging) — the path's `config` is a path, not a subcommand |
| `git log --grep config`           | `log`                    | allow — `config` is a search string                              |
| `git commit -m "fix reset logic"` | `commit`                 | deny (commit) — `reset` inside a message is not `git reset`      |
| `git stash push -m drop`          | `stash push`             | deny (staging) — not `stash drop`                                |
| `git branch -D old`               | `branch` + a flag off the list enumeration | deny — `branch` is allow-listed, the flag is not       |
| `git-apply p.diff`                | `apply` (dashed dispatch) | deny — the same terms as the spaced `git apply`                 |

Detection also sees through the ways a command can be dressed up. It skips leading
`NAME=value` env assignments, unwraps one command wrapper (`env`, `command`, `sudo`,
`builtin`, `exec`) along with that wrapper's own options, and resolves the command word by
basename, so `/usr/bin/git` and `./git` are git. It also resolves git's **dashed dispatch**
form: `git-apply`, `git-push` and `git-reset` are the same programs as their spaced
spellings, they ship in `$(git --exec-path)`, and the suffix is read as the subcommand so the
whole matrix — default-deny tail included — decides them identically. Every segment of a
compound command is scanned, so `ls && git commit -am x` is denied by its second segment; an
allowed git read earlier in the line never rescues a denied write later in it.

Two cases fail safe rather than fail open. A second wrapper level (`sudo env git …`) and a
command word the static parser cannot resolve (`$CMD`, a backtick substitution, an ANSI-C
escape residual) both deny the whole command, because the word could resolve to a git write
at shell runtime and no static parser can know.

**What the git gate's unwrap does not cover.** It unwraps exactly the five wrappers above,
exactly one level deep, and it does not recurse into a shell `-c` string. `timeout 5 git
push`, `nice git push`, `xargs git push` and `sh -c 'git push'` therefore reach git through
the *edit* extractor's analysis rather than the git gate's — and the edit extractor finds no
write-shaped path in any of them, so they classify as reads and are allowed. This is a real
gap, stated here rather than papered over; the wider wrapper set described under
[edit scope](#edit-scope) belongs to the edit gate alone.

## Edit scope

The edit-scope gate applies to `edit`/`write` calls and to each write-shaped target
extracted from a `bash` command — redirect targets, `tee` operands, `sed -i` and
`perl -i` files, `mv`/`cp` destinations, `rm` targets, `dd of=`, `gawk -i inplace` files,
and `ex`/`ed` operands. A write hidden behind `sh -c "…"` is re-analyzed by running the same
extraction over the inner string.

| Role                  | May edit                                                                |
| --------------------- | ----------------------------------------------------------------------- |
| orchestrator          | nothing, unless an active inline claim scopes the path                  |
| implementer           | paths matching its item's `fileScope` **minus** everything its `testScope` covers |
| `testWriter`          | only paths matching its item's `testScope`                              |
| planner               | nothing                                                                 |
| reviewer              | nothing                                                                 |
| skeptic               | nothing                                                                 |
| mechanical            | nothing                                                                 |
| any unrecognized role | nothing — unknown roles fail safe                                       |

The implementer's subtraction is checked **first**, before `fileScope` is consulted at all. A
session gated to write the very test it must make pass is a licence to move the proof to meet
the code. Decomposition already refuses an item whose `fileScope` covers its own `testScope`,
and `conductor_mark_green` carries a digest witness that catches a rewritten vetted test after
the fact — but the witness speaks only once a whole sub-session has been spent, so the gate
answers here, where the question costs nothing.

Four rules apply to everyone, whatever the role:

- **A path outside the session's tree is denied outright**, before scope is consulted. A
  wildcard-headed scope such as `**` matches an absolute path — `**` spans separators,
  including the leading one — so leaving an out-of-tree path to the scope match granted edit
  permission to anything on the machine.
- **`.conductor/**` is denied.** The state area is handler-written only. Ledgers, item
  files, and the run state are records of what the harness derived; a session that could
  edit them could fabricate a green. The comparison is **case-folded** (Unicode NFKC plus
  lowercase), because the filesystems this defends are case-insensitive: `.Conductor/…` and
  `.conductor/…` are one file on macOS and on Windows, and a fullwidth or decomposed
  spelling of the token is the state area too.
- **A `..` path segment is denied outright.** Scope globs are matched literally, and `**`
  will happily swallow a `..`, so a traversal could carry an in-scope glob into the state
  area or a sibling item. No legitimate edit path contains one.
- **A live verify marker for the tree denies everything.** See the next section.

**Paths are normalized against the session's tree first.** Every scope is tree-relative, so
an implementer working in a worktree under
`<stateHome>/…/worktrees/<runId>/<itemId>/router/config.hpp` is judged on
`router/config.hpp`. The `.conductor/**` deny is applied to the normalized path — the
state area of the *current* tree — so a tree that happens to live under a `.conductor`
directory does not false-deny every write inside it.

### Wrappers and interpreter one-liners

The write-shape extractor unwraps **twelve** command wrappers, iteratively rather than one
level deep: `env`, `command`, `sudo`, `builtin`, `exec`, `nice`, `nohup`, `time`, `timeout`,
`xargs`, `stdbuf`, `ionice`. Each is unwrapped together with its own flags, its flag values
and — for `env` — its `NAME=value` assignments, and the wrapper name is resolved by basename
so `/usr/bin/env sh -c "…"` unwraps like the bare spelling. Command names are compared
case-folded, so `/usr/bin/RM`, `ENV`, `SH` and `PYTHON3` all resolve. (This is the edit gate's
own set. The git gate's is the five-name, one-level set described above — the two are not the
same, and a doc that states one set for "the gates" is wrong about one of them.)

Interpreter one-liners get two rules of their own:

- A recognized write call inside the program text surfaces its literal path operands, so
  `node -e "require('fs').writeFileSync(p,s)"` and `python3 -c "open(p,'w')"` produce edit
  targets the scope gate adjudicates.
- Any interpreter program text that merely **mentions** `.conductor` (case-folded) is refused
  whole, path operand or not. A program can build the path it writes to, so the mention itself
  is the refusal — the state area's whole value is that a gated session cannot write it, and a
  rule that held only for the spellings the extractor can parse would leave the operator's
  answer-file channel resting on the model's choice of syntax.

## The freeze

While a verify marker is live for a tree, **every** edit in that tree is denied. Production
files, test files, config, an implementer inside its `fileScope`, a test-writer inside its
own `testScope` — all of it, until the verify clears.

The strict reading is deliberate. A verify quarantines the foreign red set by moving those
test files outside the repository and restoring them afterwards from a manifest. If a
session could write a file while it is moved aside, the restore would either clobber the
new content or resurrect the old — so "no edits at all, in this tree, right now" is what
makes the quarantine safe. The freeze is keyed on tree equality, so a different tree's
verify never freezes yours, and under worktree mode two implementers never freeze each
other.

**Freeze is scheduling, not just denial.** The fan-out engine will not dispatch a
write-capable sub-session — an implementer or a test-writer — into a tree with a live
marker. It holds the job: not dispatched, not denied, released when the marker clears. The
gate denial is the backstop, not the mechanism. A sub-session that reads for two minutes
and then takes an exception on its first write has burned a dispatch and an attempt counter
for nothing, which is exactly the cost the scheduler exists to avoid.

## The ask-gate

Sub-sessions are not allowed to stall waiting for a human. Each conductor sub-agent
definition carries `question: "ask"` in its permission block, and the plugin subscribes to
opencode's `permission.asked` bus event and adjudicates it over HTTP
(`POST /session/{id}/permissions/{permissionID}` with a `{response}` body).

A sub-session's ask is rejected at the wire, and the fan-out engine converts the resulting
blocked state into one of two things:

- **`NEEDS_CONTEXT`** — the orchestrator supplies what the sub-session was missing and the
  job continues; or
- **a surfaced question** — `conductor_surface` appends it to the run's question ledger and
  marks the named items `blocked` until `conductor_answer` clears them.

Either way the question becomes a fact about the *run*, visible in status and in the
report, rather than a session sitting idle in a corner. The orchestrator's own questions to
the human are allowed, but counted and journaled with a human-territory verdict, and the
decision protocol governs what may be asked at all — taste, money, irreversible external
commitments, secrets, and genuine ties. Human-territory questions reach the human batched
at run boundaries, in the report or as surfaced questions, not as mid-run interruptions.

**The ask-gate's default is deny.** Exactly two permission kinds are adjudicated: `edit`,
which is granted only when an active inline claim's scope covers the path, and `question`,
which is allowed and counted. Every other permission kind — present or future — is refused,
so a vocabulary that grows upstream cannot silently widen what the orchestrator may do.

A wildcard anywhere in the ask's payload makes it **unadjudicable outright**, and it is
screened before any path is chosen — ahead of the `metadata.filePath`/`metadata.path` fields
the extraction otherwise prefers. The reply grants the ask, not the path the gate happened
to inspect, so filtering wildcards out and deciding on whatever concrete entry remained
would grant `**` on the strength of one covered file. The degradation is "the claim does not work
for this ask", never "the orchestrator may edit anything".

## Fail-closed

Gate evaluation is ordinary code and can crash. When it does, the disposition depends on
what the call was about to do, computed from the real parse rather than from the gate that
just failed:

| The call                                        | Crash disposition |
| ----------------------------------------------- | ----------------- |
| contains a git segment, or has a write shape    | **deny**          |
| is an `edit`/`write`/`patch`/`apply_patch` tool | **deny**          |
| is a `conductor_*` tool, or the `task` tool     | **deny**          |
| is a harmless read                              | allow             |

A denied crash carries the crash message into the refusal, so it is legible rather than
mysterious. Either way the crash is journaled under `gates/gate-crash` at `error` — the
failure is never invisible, whichever way it resolves.

The reason a harmless read fails open is proportionality: denying every `grep` because a
gate module has a bug converts one defect into a dead session, and a read cannot damage the
repository.

## The two hatches

Two gates can be stood down on purpose. Both leave a permanent trail.

### `conductor_inline_claim {itemId, reason, options[], choice}`

For work where dispatching a sub-session costs more than doing the work — a one-line fix
surfaced by review, a mechanical rename. It grants the orchestrator edit permission scoped
to that item's `fileScope`, until the item leaves its current state. Mechanically, the
orchestrator's `edit` permission is `"ask"`, and the plugin allows the ask if and only if
an active claim's scope covers the path. No claim, no edit; a claim that does not cover the
path is still a deny.

The claim is itself a decision — dispatching was the other option — so it carries scored
`options` and a `choice` exactly as `conductor_decide` does, and is refused before anything
is written if it offers fewer than two scored options.

What a claim does **not** do is weaken anything else. The item FSM applies in full — inline
work still goes through red, vet, green, validate, and review like any other item. The
claim changes *who* edits. It never changes *what* is enforced.

### `conductor_override {gate, reason, grantedAction}`

The real hatch. It records an anomaly, appends the override to the item's `taint[]`, and
disables the named gate for exactly **one** next action in the same session. The second
action is gated again. There is deliberately no bulk override and no timed override.

`gate` is a **closed vocabulary of three names**: `session`, `git` and `edit`. Those are
exactly the gate decisions above that offer a grant a consumption point can spend. Any other
name is refused *before* the budget is touched, and that refusal costs nothing at all — no
meter moves, no taint is recorded, no anomaly is appended, and the run does not stop. Under
the older shape, two honest misspellings exhausted the default budget and a third ended the
run.

`grantedAction` names the one next action the bypass permits, and it is written into the
anomaly, into the taint entry and into the grant — so the record says what was let through
rather than only that something was. Which item's budget is spent is not an argument at all:
it comes from the session registry, because the hatch is spent by the session working the
item the bypass applies to. A session carrying no item assignment is refused.

| Property        | Value                                                     |
| --------------- | --------------------------------------------------------- |
| Gate names      | `session`, `git`, `edit` — nothing else                   |
| Per-item budget | `workflow.maxOverridesPerItem`, default 1                 |
| Per-run budget  | `workflow.maxOverridesPerRun`, default 2                  |
| Scope of effect | one named gate, one next action, one session, one item    |
| Record          | an anomaly entry, plus an entry in the item's `taint[]`   |
| Taint lifetime  | permanent for the run, headlined in `report.md`           |
| Over budget     | an `env` stop with a stop-report — never another override |
| Unknown gate    | refused, and nothing is spent                             |

**Why there is a budget at all.** The bookkeeping cost of an override — writing a reason,
adding a ledger line, carrying a taint — is a cost the *human* pays at reading time. The
model does not feel it during the run. An uncapped hatch that the deny messages themselves
advertise is a hatch a struggling local model will find and keep using, and at that point
every gate in this system is advisory while the report still claims a process was followed.
The budget turns "the trail is visible" into "the trail is short enough to read, and the run
stops before it gets longer". A gate that needs overriding twice in one run is a bug in
conductor, and stopping is the correct response to a bug in conductor.

## Responding to a denial

| Denial                                                                | What it means                                            | The legal move                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "sub-agent spawn (the task tool) is denied in every session"          | something tried to create an unregistered session        | let conductor fan out; `conductor_dispatch_wave` is how parallel work starts                                           |
| "this session has no conductor item assignment"                       | the write came from a session conductor did not create   | do the work in a conductor-created session; reads from here still work                                                 |
| "conductor state advances only from registered sessions"              | a `conductor_*` call from an unregistered session        | same — the run advances only from sessions conductor registered                                                        |
| "staging is `conductor_publish`'s job"                                | `git add`/`mv`/`rm`/`stash push`                         | call `conductor_publish`; it stages exactly the harness-changed paths                                                  |
| "publishing is `conductor_publish`'s job"                             | `git commit`, any spelling                               | reach PUBLISHED through the item FSM, then `conductor_publish`                                                         |
| "is not on the git read-only allow-list (default-deny)"               | an unlisted subcommand                                   | `conductor_surface` the need; if it is legitimate, the allow-list is the thing to change                               |
| "branch movement is denied while a run is active"                     | `switch`/`checkout <branch>` under `branchPolicy: "pin"` | finish or stop the run; or set `git.branchPolicy` to `"check-only"` and let publish's HEAD check catch the consequence |
| "outside the item's `fileScope [...]`"                                | the item's declared scope does not cover this path       | report the boundary back to the orchestrator, which widens or splits the scope with `conductor_queue_amend`            |
| "a test-writer may edit only its item's `testScope`"                  | a test-writer touched production code                    | that is the implementer's job; the item's `fileScope` is dispatched separately                                         |
| "this path is inside the item's `testScope [...]`"                    | an implementer reached for the test that proves its item | make the implementation satisfy the test; a test change is the test-writer's, through the review fix routing          |
| "a verify marker is live for this tree (freeze)"                      | a verify is running right now                            | wait; the fan-out engine normally holds the job rather than letting you hit this                                       |
| "the `.conductor` state area is handler-written only"                 | something tried to edit run state directly               | use the `conductor_*` tool that owns that state                                                                        |
| "the orchestrator may not edit source without an active inline claim" | the orchestrator tried to write code                     | dispatch an implementer, or take `conductor_inline_claim` if dispatch genuinely costs more than doing                  |
| "a security gate crashed while judging a guarded call"                | fail-closed, not a policy decision                       | read `gates/gate-crash` in the journal; this is a conductor bug                                                        |
| "the `patch` tool is denied in every session"                         | a patch body has no adjudicable target                   | use `edit` or `write`, one path at a time                                                                              |
| "hands git a program to execute"                                      | an exec-capable `git -c <key>` or environment prefix     | drop the config or environment override; `conductor_surface` it if it is genuinely needed                             |
| "an interpreter one-liner naming the .conductor state area is denied" | a `node -e`/`python -c` program mentioned `.conductor`   | use the `conductor_*` tool that owns that state; the operator writes answer files by hand, outside the session        |
| "the path is outside this session's tree"                             | an absolute or sibling-tree path                         | edit inside the tree the session was dispatched into; no item scope widens that                                       |
| "is not a gate an override can bypass"                                | `conductor_override` named something other than `session`/`git`/`edit` | re-issue naming one of the three, or accept the refusal the gate gave you; nothing was spent           |

## Where gates do not reach

Gates are a property of tool calls inside a conductor-managed opencode session. Five honest
limits follow, and none of them are bugs:

- **A human at a raw terminal is ungated.** Nothing here is operational security. Conductor
  constrains a model working through opencode; it does not constrain you.
- **A second, plain `opencode` session in the same repo is ungated and invisible.** The
  harness travels via the `OPENCODE_CONFIG` that `serve.py` exports into the shell it
  spawns. Another terminal running `opencode` in the same repo loads no plugin, takes no
  workspace lock, and races the conductor session's freshness stamps, quarantine moves, and
  freeze windows. (Two *conductor* sessions are the benign case: the second is **refused**
  by the workspace lock and does no conductor-side work in that workspace at all. There is
  no read-only conductor mode.)
- **The write-shape extractor is an enumeration, not a proof.** It reads the shapes it
  knows — redirects, `tee`, in-place editors, `mv`/`cp`/`rm`, `dd of=`, and the recognized
  write calls inside `node -e` / `python -c` one-liners — and it is measured, not proven,
  against the ones it does not. A program that computes its target, or writes through a call
  the extractor does not recognize, surfaces no path for the scope gate to judge. The one
  place this does not degrade is the state area: any interpreter text that names
  `.conductor` is refused whole, so the operator's answer-file channel does not rest on the
  extractor's coverage. The journal records the command either way, which is the
  detection-over-prevention posture applied honestly.
- **The git gate's wrapper unwrap is narrower than the edit gate's.** One level, five
  wrappers, no recursion into `sh -c`. `timeout 5 git push` is allowed.
- **Declared scopes can lie.** An implementer editing outside its `fileScope` is denied —
  that direction is enforced. A scope declared *too wide* is not: it just serializes the
  wave honestly, because the scheduler treats overlapping scopes as conflicting. Similarly,
  `behavioral: false` is only as honest as the repo's `behavioralPaths` list, which is why
  first-run setup asks for it rather than guessing a default.

The complete list lives in section 9 of
[the conductor plan](../plans/2026-08-07-conductor-harness-plan.md).

## See also

- [Tool reference](./tool-reference.md) — every `conductor_*` tool, including both hatches
- [Run lifecycle](./run-lifecycle.md) — the state machines the phase gate enforces
- [Configuration](./configuration.md) — `git.mode`, `git.branchPolicy`, the override budget
- [Gates (developer)](../developer/gates.md) — the parser, the deny matrix, and the tests
- [Troubleshooting](./troubleshooting.md) — including how to tell whether conductor is loaded
