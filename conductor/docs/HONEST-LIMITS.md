# Honest limits

The plan's §9 is normative and the numbered part of this file is its copy. Every entry
below states something conductor **does not** do, or does only partially, so that an
operator reading this page before trusting a run knows exactly where the enforcement
stops.

The whole document rests on the **G7** posture: **detection over prevention**. Conductor
watches a session it does not own, inside a client it does not control. The honest
consequence: a good deal of what could go wrong here is *documented rather than prevented*.
A limit written down on this page is a limit you can plan around; a limit nobody wrote
down is one you find out about from a bad commit.

Read this together with [OPERATIONS.md](./OPERATIONS.md), whose first rule — *no beacon, no
conductor* — is limit 11 turned into a daily habit. The banner limit 11 names is the visible
form of that check; the liveness beacon is the form that exists.

Two of the fifteen have drifted from the code, and both are reproduced here anyway because
this part of the page is pinned verbatim to a plan document that is immutable. Read them with
these corrections in hand:

- **Limit 8** describes a second conductor session getting a read-only conductor, and calls
  the lock advisory. Neither holds. `run.lock` is an OS-level claim published with `linkSync`,
  and `openWorkspace` **refuses** the second session outright — it gets no store at all,
  rather than a demoted one. There is no read-only mode to fall back into.
- **Limit 11** names a visible session banner. One exists, but it is CONDITIONAL, which the
  limit's wording does not convey. opencode 1.18.15 offers no unconditional channel for
  operator-visible text: a text part appended inside the `chat.message` hook reaches neither
  the transcript nor the model, and `tui.showToast` answers success with no TUI attached, so a
  200 from it proves reachability and not visibility. The one measured channel is a
  `tool.execute.after` output mutation, so the banner rides the session's FIRST tool result and
  a session that calls no tool never shows one. The beacon file remains the check that does not
  depend on a tool running.

---

1. **Gates fire inside opencode.** A human terminal, or any process outside the plugin's
   sight, is ungated. Operational security is out of scope.
2. **No pre-emptive turn-end gate exists in opencode.** Continuation is idle-driven
   re-entry (§3.7); between the turn ending and the re-prompt, the model has "stopped".
   The disengage backstop bounds the failure mode; upstream FR noted.
3. **Ledgers are records, not proofs** — but every FSM-advancing record is written by a
   handler that re-derived the evidence itself (G6); the model's only fabrication path
   is `conductor_override`, which is loud, tainted, and reported.
4. **The schema guard validates non-streaming JSON only.** Streamed structured outputs
   pass with a warning; the fan-out engine's receipt-validation covers them (G5's
   two-layer posture).
5. **Model quality is a floor, not a gate.** A 27B reviewer upholding garbage findings
   costs fix-loop rounds; the skeptic layer and round caps bound the damage, and the
   bench (Phase 14) measures it instead of assuming it away.
6. **`scopesIntersect` is conservative.** False positives serialize work that could
   have parallelized; they never corrupt. Declared scopes can still LIE (an implementer
   editing outside its scope is denied, but a scope declared too wide serializes
   honestly).
7. **Verify trusts the target repo's own test command.** Vacuous tests get vacuous
   protection; the TEST_VETTED stage exists to raise exactly this floor for tests the
   pipeline itself writes.
8. **Two opencode sessions sharing one workspace**: the second gets read-only conductor
   (run-dir lock, Task 4.1; a dead holder's lock is broken automatically); the lock is
   advisory and a human deleting it lies to both sessions.
9. **The router observes; it never enforces.** Its schema check is a recorded
   observation, not a rejection (§4.4) — a request the direct path would have served is
   never failed by the router. Response observation covers non-streaming bodies only, so
   if opencode streams (Task 0.2 determines this), that dataset is empty and the router
   is justified by scheduling and metrics alone.
10. **macOS/Apple Silicon only for the POC** (G12 note); nothing gratuitously breaks
    Linux, nothing verifies it.
11. **Conductor cannot detect its own absence.** If opencode fails to load the plugin,
    every gate in this document is silently absent and the session looks normal. The
    liveness beacon and the session banner (§3.8) make it *visible*; nothing can make it
    *impossible*. First rule of the ops guide: no banner, no conductor.
12. **A second, plain opencode session in the same repo is ungated.** The harness travels
    via `OPENCODE_CONFIG` in the shell `serve.py` spawns; any other terminal running
    `opencode` in that repo has no plugin, takes no lock, and is invisible to the
    conductor session — whose freshness stamps, quarantine moves, and freeze windows are
    then racing an unmanaged writer. (Limit 8 covers two *conductor* sessions, which is
    the benign case.)
13. **In-session interpreters bypass the write-shape extractor.** `node -e`,
    `python -c`, and friends can write files without matching any redirect/tee/sed
    pattern. The edit gate catches shapes, not intent; G7's detection-over-prevention
    posture applies, and the journal records the command either way.
14. **`behavioral:false` is only as honest as `behavioralPaths`.** The path arithmetic is
    mechanical, but the path list is human-confirmed at setup (§2.1). A repo that lists
    `src/**` while keeping logic in `lib/**` has handed the model a legal TDD bypass.
    Setup asks rather than defaults for exactly this reason.
15. **Single-model routing is a POC constraint, not a finding.** G13 makes the quality
    delta attributable to process, and costs whatever a larger reviewer would have added.
    §10's multi-model stretch is how that question gets asked separately.

---

## Limits the build itself discovered

The fifteen above were written before the code was. These were found while building it,
and they are recorded here rather than in a commit message nobody reads. They follow the
same rule: each says what conductor does **not** reach, and where the enforcement stops.

### Git-command detection reaches the enumerated globals only

The git gate decides on the **subcommand**, and finding the subcommand means skipping
git's value-taking global options first. Three are enumerated by name: `-c k=v`, `-C dir`
and `--git-dir <dir>` (plus the inline `--git-dir=<dir>`). Every other leading option is
**non-enumerated** — `--work-tree <dir>`, `--exec-path <path>`, `--namespace <ns>`, and any
option a future git adds — and the parser cannot know whether the token after it is that
option's value or the real subcommand.

It therefore **denies**: the unrecognised option is returned verbatim as the subcommand,
lands on no allow-list, and the default-deny row fires. That is the safe direction, and it
is a real cost: it **over-denies** legitimate read-only commands, so `git --no-pager log`
or a `--work-tree` read is refused in a gated session even though it changes nothing. The
model is told which token caused it and can re-issue the command without the global.

### The git gate unwraps one wrapper, from a list of five

Before it can find a subcommand, the gate has to find the command word, and it looks through
a leading `NAME=value` environment prefix and through exactly **one** level of five
recognised wrappers — `env`, `command`, `sudo`, `builtin` and `exec` — together with that
wrapper's own options and their values. The five are matched as **bare words**: the test is
token equality, not the basename resolution the edit gate uses, so a path spelling is not a
recognised wrapper at all. A second wrapper level, as in `sudo env git push`,
leaves the real command word unknowable to a static parser, so it denies. That is the safe
direction.

Everything outside those five is simply not unwrapped, and there the cost runs the other
way. `timeout 5 git push`, `nice git push`, `xargs git push`, `sh -c 'git push'` — and any
path spelling of one of the five, such as `/usr/bin/env git push` — all present a command
word that is not `git`, so the gate finds no git invocation in the segment and the git
matrix never decides the command. The bash **edit** gate has its own, wider
list — twelve wrapper names, unwrapped repeatedly, including a shell's `-c` string — so a
wrapped *file write* is still analysed as the write it wraps; a wrapped *git subcommand* is
not analysed as git. G7 applies as everywhere else: the gate journals only what it refuses
— `gates: deny`, `gates: gate-crash`, and the `gates: allow` an override grant spends — so a
git write the matrix never decided leaves no record in the journal at all, and the
disclosure here is the only place it is written down.

### Freshness fails safe on a non-finite timestamp

Freshness is a *proof* that no edit landed after a verify, and the proof is arithmetic on
timestamps. A **non-finite** value — `NaN` or `Infinity` from a filesystem that answered
strangely — makes the numeric comparison false, and a false comparison would read as
*fresh*. So any non-finite `startedMs`, staged mtime, or (when a staged entry is a
deletion) index mtime is treated as **stale** up front. The cost is a publish refused for
a clock or filesystem oddity that may have been harmless; the alternative was a stale
green reading fresh, which is the one failure this rule exists to prevent.

### `classifyFailure` reads text, and only text

The §2.6.1 verdict on a failing test — `assertion`, `missing-subject` or `error` — is
decided from the runner's **output shape**, never from exit codes (runners disagree: pytest
exits 2 for a collection error). That makes the causality **text-only**: it is bounded by
the per-runner **runner rule** data — the regex sources that recognise an unresolved
specifier and a genuine assertion. A runner whose rules are missing or whose message
wording changes classifies as `error`, the conservative default, so a legal red can be
demoted to an illegal one by nothing more than a version bump in the target's test runner.

### Edit detection matches an enumerated set of write shapes

The bash edit gate extracts write targets from an **enumerated** set of shapes: output
redirects, `tee`, `sed -i`, `perl -i`, `gawk -i inplace`, `ex`/`ed`, `dd of=`, the
destination of `mv`/`cp`, the operands of `rm`, and a bounded unwrap of leading command
wrappers — `env`, `command`, `sudo`, `builtin`, `exec`, `nice`, `nohup`, `time`,
`timeout`, `xargs`, `stdbuf`, `ionice`, plus a shell's `-c "…"` string — so a wrapped write
is analysed as the write it wraps. That unwrap **narrows the wrapper route without closing
it**: three residuals still escape — `eval`'s string argument is never re-analysed
(ISSUE-014), an `LD_PRELOAD`-injected write never appears in the command at all, and a
`cp -t DIR` whose destination the parser mis-reads slips through (ISSUE-018) — `cp -t /etc
a.txt` surfaces the SOURCE as the write target, and the long spelling
`cp --target-directory=/etc a.txt` surfaces nothing at all.

It matches shapes, not intent. A write performed by a shape outside that set is not seen
as a write, and adding a shape means adding it to the set — which is exactly the
maintenance burden the enumeration buys in exchange for never guessing.

### The M5 scan's marker rules cover production sources only

The mechanical scan walks the tracked TypeScript under `conductor/`, the C++ under `router/`
and `tools/`, and `scripts/*.py`. Two of its five rules — the stub-marker scan, and the bare
word "stub" in a source file — are **production**-only: they skip everything under
`conductor/tests/` and `router/tests/`, because those tokens appear there legitimately as
test *data*, as the *subject* of anti-stub enforcement, and inside example strings. The
other three rules — a test the file marks as skipped or left unfinished, a trivially-true
assertion, and an empty catch block — run over every scanned file, tests included.

So the exclusion is narrower than "tests are not scanned", and what it leaves uncovered is
narrower too: a marker word sitting in a test file. The real risk behind that word — a test
that never ran — is caught independently and does not rely on this scan at all:
`scripts/test-conductor.sh` hard-fails any test the suite declined to execute, and the TAP
directives that mark one, at any depth.

### The current posture on shell expansion, and what it still misses

The git gate's rule on expansion is a **shell-expansion sigil** rule, and it is a deny.
When a command-word token still carries an **unresolved** expansion sigil after the
splitter has done its work — a backtick, a `$VAR`, a `${…}` or `$(…)` splice, a `$'…'`
span, or a backslash escape a real shell would decode — the command word names something
knowable only at shell runtime. Detection resolves the command word by token equality, so
such a word would read as "not git" and let a git write straight through. Conductor cannot
adjudicate what it cannot read, so it **denies** the whole command and tells the model to
surface a question through `conductor_surface` instead of executing it.

A companion rule closes git's own run-a-program routes, which would otherwise carry an
arbitrary command under a read-only verb. A `-c` key or an environment prefix that names a
program git executes — the `alias`, `pager`, `credential`, `difftool`, `mergetool`,
`filter`, `trailer`, `guitool` and `instaweb` config sections, exec-shaped leaf keys such
as `core.pager` and `diff.external`, and the `GIT_*` variables of the same shape — is
denied before the subcommand is even resolved. A git alias invoked by name is decided by
the ordinary matrix instead: it arrives as its own subcommand, lands on no allow-list, and
the default-deny row fires.

Two residuals survive that, and both are over- or under-reach rather than a hole:

- **Over-blocking.** A perfectly legitimate expansion in command position — a path built
  from a variable, a wrapper resolved at runtime — is denied in a gated session, because
  the rule cannot tell it apart from the case it exists to stop. The refusal names the
  token, and `conductor_surface` is the route through.
- **In-place writers outside the write-shape set.** A program that opens a file and
  rewrites it in place, invoked by a name the extractor's **write-shape** set does not
  enumerate, writes without being recognised as a write. The journal still records the
  command; the edit gate simply did not adjudicate it as an edit.

### The built-in class table reaches the names it declares, and nothing else

Every tool opencode can put in front of the model carries a declared side-effect class, and a
tool carrying none is refused rather than treated as a harmless read. That is a real
tightening — the previous posture was a catch-all that classified `webfetch`, `grep`, `skill`
and every unknown name alike as `read`, which was not a decision to permit them so much as the
absence of one.

What it does not do is anticipate. The table is keyed by name, and the offered set it is
written against is the set measured on opencode 1.18.15 and pinned by
`conductor/tests/wire-contract.test.ts`. An opencode release that adds a tool turns that pin
red, which is the intended order of events — the tool becomes an explicit decision before it
becomes reachable. But the refusal in the meantime is indiscriminate: an operator who installs
a second plugin finds its tools refused in a conductor session, with a message naming the
missing class rather than the plugin. That is the fail-closed direction and it is deliberate,
and `toolSurface.classifyBuiltins` turns the lane off for an operator who needs the old
behaviour back.

### Network detection is an enumeration, and package managers are outside it

A network call is refused in two lanes: the `webfetch` and `websearch` names, and a `bash`
command whose shape reaches an enumerated network program. The shape is read with the same
quote-aware tokenizer, operator segmentation and wrapper unwrapping the write-shape extractor
uses, so `env sh -c "curl …"`, `xargs curl`, `nice -n 10 wget …` and a nested `sh -c` are all
seen, and so is a network call inside a `node -e` or `python3 -c` one-liner.

The enumeration is `curl`, `wget`, `nc`, `ncat`, `netcat`, `ssh`, `scp`, `sftp`, `rsync`,
`ftp` and `telnet`. A program not on that list is not detected. Two absences are deliberate
rather than oversights, and both are real gaps:

- **`git` is excluded** because it has its own gate, which adjudicates the whole command
  including the subcommands that touch a remote. A second opinion here would deny `git log`
  for being spelled `git`.
- **Package managers are excluded.** `npm`, `pip`, `bun`, `uv` and `cargo` all fetch, and all
  of them are also how a repository's own toolchain runs. Denying them would remove far more
  than a network lane, so a session that runs one reaches the network through a door this
  extractor does not watch.

Detection is also the only control. There is no egress proxy in this build, so the refusal
binds the tool call and nothing binds the process: a program the enumeration misses is not
stopped by anything else.

### An allowed read is journaled at debug, so a campaign must ask for it

Every call every gate allows now leaves one `gates: allow` record, and the level is chosen for
volume: a network allow is `warn` because it should be rare, and everything else is `debug`
because a read allow is the highest-volume event in the system.

The consequence is that at the default `logging.level` of `info` the read allows are filtered
at the sink and do not reach `journal.jsonl`. A benchmark or an audit that intends to answer
"what did this session reach" must run at `debug` and know that it is doing so. A transcript
gathered at `info` shows the denies and the network allows only, which looks like a complete
record and is not.

`gates: allow` also fires in a second circumstance — an override grant converting a deny —
and those records carry `via: "override-grant"` where an ordinary allow carries no `via`. A
count that ignores the discriminator double-counts every bypassed deny.

### What an observer of a run cannot see

`conductor/tools/observe.ts` derives a run's position and its strain signals from
the run directory alone, and it is read-only by construction — a separate process that
opens files, imports no handler and holds no store. What it reports is therefore bounded
by what was recorded, and four things are not.

Anything the gates never adjudicated leaves **no record at all**, which is different from
being allowed and different again from being denied. A `git` write outside the enumerated
globals, or a network program outside `NETWORK_PROGRAMS`, is not in the journal in any
form. A reader counting denies and allows is counting decisions, not calls.

Anything in a second, ungated session is invisible: the workspace lock means that session
got no store, so it wrote nothing here.

Allowed reads are journaled at `debug`, and the default `logging.level` is `info`. A run
gathered at `info` shows the denies and the network allows only. That looks like a
complete record and is not, and no property of the file distinguishes the two cases — the
reader says so when it sees no gate decisions at all, which catches the extreme case and
not the ordinary one.

And the journal records what the harness decided, never what the model was reasoning
about. That lives in opencode's own session storage, one indirection away through the
`sessionID` on each fan-out record.

---

## How to use this list

Two of these limits change what an operator should *do*, not merely what they should
expect:

- **Limit 11 → check the liveness beacon.** The §3.8 session banner is the visible form of
  this check and nothing emits one, so the signal that works is `.conductor/state/alive.json`,
  written when the plugin opens the workspace and naming the `pid`, `startMs`, `version` and
  `sessionID` of the conductor that owns it. A missing beacon — or one naming a dead `pid`,
  or a different session — means a session with no gates at all. Nothing downstream — not a
  green suite, not a clean report — distinguishes it from a gated one.
- **Limit 12 → one terminal per workspace.** A second plain `opencode` in the same repo
  is not merely unhelpful; it races the freshness stamps that publish depends on.

The remaining limits are bounds on interpretation: they say how much a green run is
worth, and the answer is "exactly as much as the target repo's own tests are worth"
(limit 7) plus whatever the review layer caught (limit 5).
