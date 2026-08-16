# Gates & Security — Enforcement Review (Step 2, R1 sub-lens)

**Scope:** `conductor/core/gates-git.ts`, `gates-edit.ts`, `gates-phase.ts`, `shell-parse.ts`, and
every call site that reaches them. Attack the tokenizer; verify the DENY set and documented residuals
(G7); hunt for an undocumented bypass. Covers step-2 Part A's gate-snapshot item and Part C's
security item.

**Reviewer:** subagent (gates-security lens)
**Date:** 2026-08-15
**Status:** IN PROGRESS

---

## 1. ISSUE register

_(appended continuously as findings are confirmed; IDs `GATES-SECURITY-NNN`)_

### GATES-SECURITY-001 — Any non-enumerated prefix (command wrappers `nice`/`nohup`/`time`/`xargs`/…, AND shell keywords `if`/`while`/`!`/`do`/`for`/`{`) hides a git write from the git gate — UNDOCUMENTED

**Severity:** MAJOR (calibrated down by the documented `python -c` universal catch-all, but this specifically defeats the harness's single most security-critical gate with a trivial, common prefix, and it is not in the G7 residual disclosure).

**Subject:** `conductor/core/shell-parse.ts:145` (`GIT_WRAPPERS`), consumed by `commandWordLocation` (`shell-parse.ts:216`) and the git gate `decideGit` (`gates-git.ts:459`), reached from `conductor/adapter/tools.ts:407`.

**What is claimed vs. what holds.** `gates-git.ts:1-25` calls itself "the single most security-critical gate in the harness: an enumerated-allow / DEFAULT-DENY posture." Detection "sees through … one wrapper (`env`/`command`/`sudo`/`builtin`/`exec`)". The wrapper set is exactly those five (`shell-parse.ts:145`). Any OTHER leading command that passes its tail through to git is not unwrapped, so `commandWordLocation` returns the wrapper itself as the command word, `isGitCommand` resolves its basename to (e.g.) `nice` ≠ `git`, the segment is judged non-git, and `decideGit` returns ALLOW.

**Reproduction (confirmed end-to-end through `gateBeforeToolCall`, `adapter/tools.ts:340`).** Registered implementer, `fileScope: ["src/**"]`, `runActive:true`, `branchPolicy:"pin"`:

```
nice git apply /tmp/evil.diff        => ALLOW (classifyTool => "read")
nohup git push                       => ALLOW
time git apply p.diff                => ALLOW
stdbuf -oL git apply p.diff          => ALLOW
setsid git push                      => ALLOW
xargs git apply                      => ALLOW
ionice git apply p.diff              => ALLOW
taskset -c 0 git apply p.diff        => ALLOW
```

The identical bare command denies: `git apply /tmp/evil.diff => DENY "git apply is destructive …"`. `git apply` writes arbitrary files around the edit-scope gate entirely (`gates-git.ts:85` names `apply` "the single most important row"). `nice`/`nohup`/`xargs` prefixing it re-opens exactly that hole. Also confirmed ALLOW for an **unregistered** session (unregistered reads are allowed, `gates-edit.ts:70`, and the command classifies as read because `writeShapedPaths` sees no write shape).

**Why the wrapper set is under-enumerated.** The header comment (`shell-parse.ts:142-145`) enumerates the wrappers the author thought of (`env git push`, `sudo git push`, …). `nice`/`nohup`/`time`/`xargs`/`stdbuf`/`setsid`/`ionice`/`taskset`/`chrt`/`nohup` are equally tail-passing and equally available to a non-privileged model. This is a P1/P3 enumeration gap: the allow/deny posture inspects less than it claims because the unwrap list is a hand-written subset.

**Second, broader vector — shell GRAMMAR keywords, not just command wrappers.** The git gate scans each operator/newline-separated segment and reads its FIRST token as the command word. Any shell keyword or grammar token that legally precedes a command — and is not one of the operator characters `;&|<>()` — becomes the segment's "command word" and hides the git verb behind it. Confirmed ALLOW (all run `git apply`/`git push` ungated):

```
if git apply p.diff; then true; fi        => ALLOW
! git apply p.diff                        => ALLOW
while git apply p.diff; do :; done        => ALLOW
{ git apply p.diff; }                     => ALLOW
for f in x; do git apply p.diff; done     => ALLOW   (the `do git apply …` segment)
```

By contrast the *operator*-separated forms correctly deny, because the git verb becomes its own segment: `git status && git apply p.diff => DENY`, `echo hi | git apply p.diff => DENY`, `( git apply p.diff ) => DENY`. So the hole is specifically the non-operator prefixes: `if`, `then`, `else`, `elif`, `while`, `until`, `do`, `for`, `!`, `{`, and every command wrapper above. `if git apply x; then :; fi` is core shell grammar a model uses naturally — this is not an exotic evasion.

**Root cause and why enumeration cannot fix it.** Detection resolves a single command word and only sees through an enumerated wrapper list. Shell grammar has unbounded prefix forms (keywords, control structures, wrappers), so no hand-written prefix list is complete. The durable fix is a fail-safe posture: treat a segment as a possible git command whenever ANY token in it basename-resolves to `git` in a command position the static parser cannot rule out, OR reject compound/keyword-prefixed bash the parser cannot fully attribute. Enumerating more wrappers/keywords narrows the hole but never closes it.

**Documentation status.** `docs/build/honest-limits-pending.md:7-24` documents the git-detection residuals as: backtick substitution, alias injection, and non-enumerated separate-value globals. It says the wrappers `env/command/sudo` ARE handled. It does NOT disclose that other common wrappers pass git writes through. So this is an **undocumented** bypass, not a G7 residual. Worse, the shipped `conductor/docs/HONEST-LIMITS.md:119-120` affirmatively claims the extractor does "a bounded unwrap of `sh -c "…"` **so a wrapper cannot hide one**" — a claim this finding (and GATES-SECURITY-004's second vector) falsifies for every wrapper/keyword outside the enumerated set.

**Adversarial self-check.** Could something else catch it? No: the bash gate is the only git gate; `classifyTool` returns "read" (no write shape); `decideSession` allows the read; the edit loop is empty. Nothing downstream re-examines the command. The refutation "a wrapped command is arbitrary code the model may run anyway" fails because the harness runs `bash` freely and the git gate exists precisely to catch a git write "hidden in a compound command" (`tools.ts:396-399`); a leading `nice` is exactly that shape.

**Compounding with G5 fail-closed.** `hasGitSegment` (`tools.ts:237-242`) — which sets the `guarded` flag that makes a gate crash fail CLOSED — uses the same keyword/wrapper-blind detection. For `if git apply x; then …` (and `nice git apply x` with no write shape), `hasGitSegment` returns false, so `guarded` is false, so a gate crash on that command fails OPEN (allow), not closed. The prefix bypass thus also strips the fail-closed guarantee from the very git writes it hides.

**Fix direction (report, do not fix).** Either (a) treat ANY leading token that is not the resolved command as opaque and fail-safe when a later token basename-resolves to `git` inside a wrapper chain, or (b) at minimum extend `GIT_WRAPPERS` to the common tail-passing set AND add a drift guard/test that fails when a new wrapper is added to one site but not the gate. Note: extending the list is itself an enumeration that will always trail reality — the fail-safe posture is the durable fix.

---

### GATES-SECURITY-002 — `git -c core.pager=<cmd>` / `diff.external=<cmd>` config-execution with a read-only subcommand runs arbitrary commands; the honest-limits doc FALSELY claims this class is closed

**Severity:** MAJOR (real arbitrary-command execution) + build-record honesty (the disclosure asserts a closure that does not hold).

**Subject:** `gates-git.ts:268` (`gitSubcommand` skips `-c k=v`), `gates-git.ts:424` (`hasUnresolvedExpansion`), `gates-git.ts:459` (`decideGit`). Interaction with `docs/build/specs/task-15.1.assertions.json:167` and `honest-limits-pending.md:45-55`.

**The claim.** After C-022, `honest-limits-pending.md:47-50` states the git gate "now DENIES (fail-safe) any bash command whose command-word token carries an unresolved shell-expansion sigil … So the earlier 'backtick substitution' and 'alias injection' bypasses are now closed in the DENY direction." Task 15.1 assertion `15.1-honest-current-posture` (task-15.1.assertions.json:167) makes it a REQUIREMENT that HONEST-LIMITS "must NOT describe … git alias injection as an open bypass."

**What actually holds.** The sigil-deny (`hasUnresolvedExpansion`) fires only when the **command word** carries a sigil. For `git -c core.pager='touch pwned' log` the command word is the clean literal `git`; the `-c` value is a later token. `gitSubcommand` deliberately skips `-c` and its value (`gates-git.ts:274`, mandated by plan line 2089), lands on `log`, which is `READ_ONLY_SIMPLE` → ALLOW. git then executes the configured pager/external-diff as a shell command. Confirmed:

```
git -c core.pager=touch\ pwned log          => ALLOW  (git runs `touch pwned` to page output)
git -c diff.external=touch\ pwned diff       => ALLOW  (git runs the external diff program)
git -c pager.log=false -c core.pager=id log  => ALLOW
git -c sequence.editor=id log                => ALLOW
git -c uploadpack.packObjectsHook=id log     => ALLOW
```

This is the same alias/`-c`-injection CLASS the disclosure claims is closed, in a spelling the sigil rule cannot see (no `!`, no `$`, no backtick; a legal read-only subcommand). `git -c alias.x='!git push' x` denies only because `x` is an unknown subcommand (default-deny), not because the sigil rule caught it — swap `x` for `log` and the protection evaporates.

**Two findings in one:** (1) a live arbitrary-command-execution bypass of the git gate; (2) the honest-limits document, whose "only job is honest disclosure" (task-15.1.assertions.json:167), overstates the closure — it should describe `-c <config>=<command>` execution as an OPEN residual.

**Shipped-doc confirmation.** `conductor/docs/HONEST-LIMITS.md:144-146` states the sigil-deny "covers the alias route: a command word that resolves to no real binary is denied rather than trusted." The `-c core.pager=<cmd>` route has a command word that IS a real binary (`git`) and a legal read-only subcommand — the sigil rule never engages — and it is listed in NEITHER of the two disclosed residuals (over-blocking; in-place writers, `HONEST-LIMITS.md:148-157`). So the operator-facing security disclosure omits a live arbitrary-command-execution route. This is a P9-adjacent honesty defect: the closure claim does not hold and the residual is undisclosed.

**Adversarial self-check.** `core.pager`/`core.editor` only fire when git actually pages/edits; `core.editor` needs a subcommand that opens the editor (denied here since those are writes). But `core.pager` fires on any paged read (`log`, `diff`, `show`, `grep` with output through a pager) and `diff.external` fires on `diff` unconditionally — both use allow-listed read subcommands. So exploitability is real, not merely theoretical. Confidence high.

---

### GATES-SECURITY-003 — Hyphenated git plumbing binaries (`git-apply`, `git-push`, `git-reset`) are not detected as git

**Severity:** MINOR-to-MAJOR depending on whether git-core is on PATH (lower confidence on exploitability, real detection gap).

**Subject:** `gitCommandWordIndex` (`shell-parse.ts:242`) resolves the command word by basename and compares `=== "git"`. `git-apply` basename is `git-apply` ≠ `git`.

**Reproduction:**
```
git-apply p.diff   => ALLOW
git-push           => ALLOW
git-reset --hard   => ALLOW
```

`git-apply` is git's own dashed dispatch form (`git apply` == `git-apply`). These binaries live in `$(git --exec-path)` and historically on PATH. Where reachable, `git-apply p.diff` writes arbitrary files with the same effect as the denied `git apply p.diff`. Undocumented. Fix direction: match a `git-<subcommand>` basename shape as well, mapping the suffix to the subcommand.

---

### GATES-SECURITY-004 — Write-shape extractor mis-parses LISTED tools `cp`/`mv` (`-t`/`--target-directory`) and `sed` (`--expression=`/`--file=`), surfacing no target or the wrong one — contradicts the disclosure that names these tools handled

**Severity:** MINOR (documented interpreter catch-all limits the security delta) but a documentation-accuracy defect: `honest-limits-pending.md:53` names "mv/cp, … sed -i" as members of the handled enumerated set.

**Subject:** `writeShapedPaths` / `collectWriteTargets` (`gates-edit.ts:315-433`): the `mv`/`cp` arm (`:378-383`) takes the LAST non-flag operand as the destination; the `sed` arm (`:369-376`) treats the first non-flag operand as the script and pushes the rest.

**Reproduction (confirmed):**
```
cp -t /outside/dir file.ts                  => ["file.ts"]   (surfaces the SOURCE; dest /outside/dir unchecked)
cp --target-directory=/outside/dir file.ts  => []            (edit gate SKIPPED entirely)
mv -t ../sibling src/mine.ts                => ["src/mine.ts"](surfaces source; ../sibling unchecked)
sed --expression='s/a/b/' -i secret.ts      => []            (write to secret.ts MISSED — sed IS on the list)
sed -i --file=prog.sed secret.ts            => []            (write to secret.ts MISSED)
```

The `-t DIR`/`--target-directory=DIR` forms put the destination FIRST (or in a `=`-flag), so "last non-flag operand" is a source file and the actual write target is never handed to `decideEdit`. The `sed` "first non-flag = script" heuristic breaks when the script arrives via `--expression=`/`--file=`/`-e` (a `-`-prefixed flag), leaving zero non-flag operands after index 0 and surfacing nothing. End-to-end, `cp --target-directory=/outside/dir src/mine.ts` and `sed --expression=… -i /outside/secret.ts` both ALLOW through `gateBeforeToolCall` classified as "read".

These are not "obscure writers not on the list" (the disclosed residual) — they are the enumerated, named-as-handled tools defeated by ordinary option spellings. Fix direction: in the `mv`/`cp` arm, honor `-t`/`--target-directory[=]`; in `sed`/`perl`/`awk` arms, do not assume the first non-flag operand is the script when a `--expression`/`--file`/`-e`/`-f` flag supplied it. Update the disclosure to state the option-form limits explicitly.

**Second vector (shared root cause with GATES-SECURITY-001) — keyword/wrapper prefixes defeat the per-command write detector, and downgrade the tool CLASS to "read".** `collectWriteTargets`'s per-command arm reads the command word via `unwrappedCommandIndex` (`gates-edit.ts:296-301`), which skips env-assignments and exactly ONE wrapper — not shell keywords, not non-listed wrappers. So the `tee`/`sed`/`rm`/`cp`/`mv`/`perl`/`dd`/`awk`/`ex`/`ed` detection is hidden behind any prefix:

```
if rm -rf /outside/x; then :; fi   => []   (rm target MISSED)
while true; do rm /outside/x; done => []
! tee /outside/x                   => []
nice rm /outside/x                 => []   (non-listed wrapper)
{ rm /outside/x; }                 => []
sudo rm /outside/x                 => ["/outside/x"]   (listed wrapper still works)
if echo x > /outside/secret; then :; fi => ["/outside/secret"]  (redirect scan is global, survives)
```

Only the redirect scan (`gates-edit.ts:336-343`, over the raw token stream) is robust; the per-command detection is not. **Severity amplifier:** because `writeShapedPaths` returns `[]`, `classifyTool("bash", cmd)` returns `"read"` (`tools.ts:142-143`), so an UNREGISTERED session's `if rm -rf /outside/x; then :; fi` passes the registry gate too (unregistered reads are allowed) — a real out-of-repo deletion with no registration. This is the same fail-safe deficiency as GATES-SECURITY-001 and wants the same fix (attribute compound/prefixed bash, or fail safe when the parser cannot).

---

### GATES-SECURITY-005 — `git branch` allow arm is wider than the spec's "list forms": bare branch CREATION is allowed, and `--set-upstream-to=<x>` (the `=`-glued form) defeats the BRANCH_MUTATING deny

**Severity:** MINOR (both are ref/config writes, neither is destructive nor moves HEAD; but both deviate from §3.5).

**Subject:** `decideBranch` (`gates-git.ts:264-273`), `BRANCH_MUTATING` (`gates-git.ts:112-128`), `includesAny` (`gates-git.ts:198`).

**(a) Branch creation is allowed though it is not a "list form."** Spec §3.5:1372 allows `branch (list forms)` only; §3.5:1379 denies the mutating flags. `decideBranch` denies only when `includesAny(operands, BRANCH_MUTATING)`, otherwise ALLOWs. So `git branch newbranch`, `git branch newbranch origin/main`, `git branch --track feat origin/feat` all ALLOW. These create refs — outside the spec's "list forms" allow-list; by the plan's own default-deny logic they should default-deny (they are neither a list form nor an explicitly-denied flag). Confirmed ALLOW. Non-destructive (no HEAD move, no ref deletion), so low impact — but it is an allow-list wider than the normative table, and `decideBranch`'s own comment claims it returns "list forms (§3.5 line 1372)".

**(b) `--set-upstream-to=<x>` bypasses the mutating-flag deny.** `includesAny` compares tokens for exact equality against `BRANCH_MUTATING`, which lists the bare `--set-upstream-to`. The `=`-glued token `--set-upstream-to=origin/x` is not equal to `--set-upstream-to`, so it is not matched:

```
git branch --set-upstream-to=origin/x feat  => ALLOW   (mutates branch upstream config)
git branch --set-upstream-to origin/x feat  => deny
git branch -u origin/x feat                  => deny
```

The space form and the `-u` form deny; the `=` form slips through — a P3 two-spellings gap inside one check. Writing branch upstream tracking is a config mutation the deny row exists to stop. Fix direction: normalize `--flag=value` to `--flag` before the `includesAny` comparison (the git gate already does this normalization for `--git-dir=` in `gitSubcommand`, so the pattern exists).

---

### GATES-SECURITY-006 — `git checkout -p` / `git checkout --patch` is a worktree-discarding form but is treated as branch movement, so it ALLOWs under `branchPolicy:"check-only"`

**Severity:** MINOR-MODERATE (only under the non-default `check-only` policy; discards uncommitted working-tree changes that the policy's HEAD-check backstop cannot see).

**Subject:** `decideCheckout` (`gates-git.ts:275-317`).

**Spec.** §3.5:1378 enumerates the worktree-discarding checkout forms as UNCONDITIONAL denies: `checkout --`, `checkout .`, multi-operand checkout, `restore` without `--staged`, `switch -C`, `checkout -B`. `git checkout -p`/`--patch` interactively discards working-tree hunks — the same worktree-discard family — but is not in `decideCheckout`'s unconditional list. With no positional and no `--`/`-B`/`-f`, it falls through to `movement(runActive, branchPolicy)`.

**Reproduction:**
```
git checkout -p        (pin)         => deny   (incidentally, movement under pin)
git checkout -p        (check-only)  => ALLOW  ← worktree discard slips through
git checkout --patch   (check-only)  => ALLOW
git restore -p src/x   (check-only)  => deny   (restore w/o --staged correctly denies)
```

Under `check-only` the design's rationale is "publish's HEAD check (§3.3) catches the consequence." But `checkout -p` does not move HEAD — it discards working-tree changes — so the HEAD-check backstop never fires. A session under `check-only` can therefore discard uncommitted work via `checkout -p` undetected. The sibling `restore -p` correctly denies (restore-without-`--staged` rule), which shows the discard family is meant to be denied. Fix direction: add `-p`/`--patch` to `decideCheckout`'s unconditional worktree-discard denies (mirror the `restore` treatment).

---

### GATES-SECURITY-007 — `apply_patch` (a registered WRITE tool) bypasses the edit-scope gate entirely: the snapshot reads a single `args.filePath`, but a patch body carries none, so a registered session writes anywhere with only the registry gate

**Severity:** MAJOR if `apply_patch` is reachable by the model; LATENT-HIGH otherwise (the authors already treat it as a callable write tool, so the scope gate should cover it). Confidence: reproduction of the missing extraction is certain; exploitability hinges on opencode surfacing `apply_patch`.

**Subject:** `plugin/index.ts:1330-1337` (`editPath = args.filePath ?? args.path`, passed to the gate), `adapter/tools.ts:136` (`WRITE_TOOLS = ["edit","write","patch","apply_patch"]`), `adapter/tools.ts:428-439` (edit branch runs only when `input.editPath !== undefined`).

**The gap.** `classifyTool` marks `apply_patch` (and `patch`) as `"write"`, so the **registry gate** denies them from an unregistered session (`gates-edit.ts:79-82`). But the **edit-scope gate** in `gateBeforeToolCall` runs only over `input.editPath`, and the composition root derives `editPath` as `args.filePath ?? args.path` (`plugin/index.ts:1330`). An `apply_patch` call carries a multi-file patch body (OpenAI `*** Begin Patch / *** Update File: <path> / *** End Patch` format), not a single `filePath`. So `filePathRaw` is `undefined` → `editPath` is `undefined` → the edit branch (`tools.ts:428`) is skipped → **no scope check, no `.conductor/**` deny, no tree normalization, no `..` guard, no freeze**. A confirmed grep shows NO patch-body parsing anywhere in `conductor/` — nothing extracts the paths a patch touches.

**Consequence.** A registered implementer/test-writer (whose ordinary `edit`/`write` calls ARE confined to `fileScope`) can call `apply_patch` with a body that updates files outside its `fileScope`, in a sibling item's tree, or under `.conductor/**` (the handler-only state area), and only the registry gate — "are you registered and not a spawn?" — stands in the way. This is the exact hole `git apply` was the "single most important" deny row to close (`gates-git.ts:85`), reopened through opencode's own patch tool.

**Reachability.** `conductor/adapter/wire-notes.md:37` records that at opencode 1.18.15 the tools *offered* to the model are `bash, edit, glob, grep, read, skill, task, todowrite, webfetch, write`, and that `apply_patch` "also exist[s] in the tool registry" but is not in that offered set. So under the pinned version the model may not be handed `apply_patch` — but (a) the build ALREADY classifies it as a gated write, which only makes sense if it is considered reachable; (b) a registry tool present but unoffered is a version/config flip away from reachable; (c) the gate's silence is unconditional — if it ever becomes callable, nothing fails safe. An enforcement layer that lists a tool as "write" and then cannot confine its writes is internally inconsistent.

**Adversarial self-check.** Could the registry gate alone be deemed sufficient? No — the registry gate explicitly defers scope to "a LATER gate's job (decideEdit)" (`gates-edit.ts:65`); for `apply_patch` that later gate never runs. Could opencode validate patch paths itself? Not within the conductor enforcement contract, which is the thing under review. Fix direction: parse the patch body of `apply_patch`/`patch` into its target paths and run `decideEdit` over each (the same shape `writeShapedPaths` gives the bash branch), OR, if `apply_patch` is genuinely unreachable, remove it from `WRITE_TOOLS` and record the decision — do not leave a tool classified as a gated write that no gate can confine.

**Note on `patch`.** `WRITE_TOOLS` also lists `"patch"`, but wire-notes' registry enumeration names `apply_patch`, not a bare `patch`. `"patch"` appears to name no real tool (a P3 phantom-vocabulary entry) — harmless but dead; worth confirming against the live registry.

---

### GATES-SECURITY-008 — Case-folding bypass of the `.conductor/**` state-area deny: `globMatch` is case-SENSITIVE, the build's macOS filesystem is case-INSENSITIVE, so `.Conductor/…` writes the real state area while evading the deny

**Severity:** MAJOR (writing the state area defeats "your claim is not the record" — a session can forge evidence/FSM state). Precondition: case-insensitive filesystem (macOS default, the build's own platform, and Windows) + a role scope broad enough to admit the path.

**Subject:** `globMatch`/`segMatch` (`shell-parse.ts:346-434`, char-exact comparison), the `.conductor/**` deny (`gates-edit.ts:208`), the scope match (`gates-edit.ts:150-155`).

**The asymmetry.** `segMatch` compares `pat[p] === text[t]` — byte-exact, case-sensitive. `headsOverlap` (used by `scopesIntersect`) deliberately folds case "because on a case-insensitive filesystem (darwin) `Src/**` and `src/**` name the same real directory" (`shell-parse.ts:458-467`) — so the authors KNOW the target FS is case-insensitive. But `globMatch`, used for the security-critical `.conductor/**` deny, does NOT fold case. Result: `globMatch(".conductor/**", ".Conductor/state/x")` is `false`, while on macOS `.Conductor/state/x` and `.conductor/state/x` are the SAME file.

**Reproduction (confirmed):**
```
globMatch('.conductor/**', '.conductor/state/x') => true
globMatch('.conductor/**', '.Conductor/state/x') => false
globMatch('**',            '.Conductor/state/x') => true

decideEdit(orchestrator, claim ['**'], '/repo/.conductor/runs/R/state.json') => DENY (.conductor deny)
decideEdit(orchestrator, claim ['**'], '/repo/.Conductor/runs/R/state.json') => ALLOW  ← bypass
decideEdit(implementer, fileScope ['**'], '/repo/.CONDUCTOR/runs/R/state.json') => ALLOW ← bypass
```

**Consequence.** The `.conductor/**` deny exists so "the state area is handler-written only; no session may edit `.conductor/**`" (`gates-edit.ts:208-211`) — it protects run state, the evidence ledger, the journal, quarantine. On a case-insensitive FS a session whose role scope admits the path (an orchestrator with a `**` inline claim, or an item whose `fileScope`/`testScope` is `**` — which the code's own comment says `verifyScopePathsOf` produces "for an item that declares no paths", `gates-edit.ts:123-127`) can write the real state files under a case-varied prefix: `.Conductor/runs/<runId>/state.json`, `.Conductor/runs/<runId>/evidence/…`. That is direct forgery of the machine truth the whole harness rests on. The exposure is sharpest for a session whose `sessionTree` is the repo root (the orchestrator), where the normalized `.Conductor/...` resolves to the shared state area; a worktree session's case-varied write lands in its own tree.

**Why existing tests miss it.** `continuation.test.ts:2775` exercises `(d2) a .conductor/ path under a wildcard claim` — but with the EXACT-CASE spelling `.conductor/state/halt`, so it proves the deny fires for the exact case and never probes the case-varied sibling.

**Adversarial self-check.** Does the `..`/tree-normalization guard catch it? No — `.Conductor/runs/R/state.json` contains no `..` and, at the repo root, is under the tree. Does the scope check catch it? Only if the role scope excludes it — but the bypass's whole premise is a broad scope, which the code documents as reachable. Is macOS's case-insensitivity certain here? The env is `Darwin 25.6.0`; APFS is case-insensitive by default and `headsOverlap`'s own comment asserts "(darwin)". Fix direction: fold case in `globMatch` (or specifically in the `.conductor` deny) on case-insensitive platforms — the same reasoning `headsOverlap` already applies for over-approximation safety applies here for under-denial safety; or canonicalize the normalized path's case before the deny check.

## 2. IDEA register

### IDEA-001 — Replace "detection by enumerating prefixes/tools" with a fail-safe attribution
Origin: GATES-SECURITY-001/004 — the git gate and write-shape extractor both enumerate a fixed set of wrappers/keywords/tools, which shell grammar can always out-run.
Kind: tooling / structural
Value: closes an unbounded class of bypasses instead of playing whack-a-mole. A gate that fails safe when it cannot fully attribute a compound command is durable; an enumerated list is not.
Cost: moderate (rework the segment/command-word resolution to a conservative "any git-resolving token → treat as git" or "reject un-attributable bash").
Relates to: GATES-SECURITY-001, -004

### IDEA-002 — Make the git-deny tests distinguish specific-rule denies from the default-deny net
Origin: mutation M1 — removing `"apply"` from DESTRUCTIVE kept the suite green (default-deny still denies), so ~20 "destructive" test rows do not actually pin their specific rule.
Kind: test-maintainability
Value: a regression that silently drops a command from DESTRUCTIVE (or a discriminated arm) would be caught, not masked by the catch-all. Assert the deny REASON substring, not just `action==="deny"`.
Cost: small
Relates to: M1

### IDEA-003 — `writeShapedPaths` should honor destination-flag and long-option-script forms
Origin: GATES-SECURITY-004 — `cp -t`/`--target-directory=`, `sed --expression=`/`--file=`.
Kind: tooling
Value: the enumerated tools it claims to handle actually get handled; the disclosure becomes true.
Cost: small
Relates to: GATES-SECURITY-004

### IDEA-004 — Over-blocked read forms surface friction: `git remote`, `git reflog`, `git config --global --get`
Origin: probing the discriminated subcommands — bare `git remote` (lists), bare `git reflog` (= `reflog show`), and `git config --global --get x` all DENY though they are read-only.
Kind: ergonomics
Value: fewer needless `conductor_surface` round-trips for a small model doing legitimate reads; the safe direction is preserved by keeping default-deny for anything not clearly a read.
Cost: small (add the bare/`--global`-prefixed read forms to the allow arms).
Relates to: standalone

### IDEA-005 — Document or derive the hardcoded `runActive: true` in the gate snapshot
Origin: `plugin/index.ts:1383` passes `runActive: true` unconditionally, so the git gate's "allow branch movement once the run terminates" path is dead in production.
Kind: docs / naming
Value: a future reader/maintainer sees why the branch-policy "pin" release path never fires (sessions only run during a live run), or the value is derived so the behavior is real.
Cost: trivial
Relates to: GATES-SECURITY-006

## 3. Cross-lens pointers

- **MACRO (design coherence):** "detection by enumeration" is a recurring shape — `GIT_WRAPPERS`, `WRITE_TOOLS`, `SHELLS`, the write-shape command set, `BRANCH_MUTATING`, `DESTRUCTIVE`. Each is a hand-written list a small model can walk around. The macro review should weigh whether the whole gate family wants a fail-safe posture rather than N enumerations.
- **CAPABILITY (structural-vs-advisory):** the edit-scope gate over `bash` is fundamentally advisory — any interpreter (`python -c`, `node -e`) or unenumerated tool writes freely (documented). A structural upgrade — running write-capable sub-sessions inside a filesystem sandbox/overlay confined to the tree — would make out-of-scope writes impossible instead of detected. Grounded in GATES-SECURITY-001/004/007/008.
- **CAPABILITY (missing mechanism):** `apply_patch`/`patch` (and any future multi-file-write tool) need a body-parsing path-extractor to be gateable at all (GATES-SECURITY-007). More broadly, the gate has no notion of a tool that writes many paths from one call.
- **MACRO/continuation review:** `gates-phase.ts` legalTools + `settledForReport`/`cannotEverPublish` composition (P7 wedge territory) is primarily the phase-order/continuation lens's domain; I verified two mutations bind (M4, M5) but did not attack the composition holes — those belong there.
- **Another subsystem (config/setup review):** the C-088 multi-ecosystem `requiredScopes`/`reconfigure` known-open interacts with the edit-scope gate's coverage (a new-extension file is uncovered until reconfigure). Belongs to the setup/config reviewer, not here.
- **Enforcement (already filed):** the `git -c` config-execution bypass (GATES-SECURITY-002) also implicates the build-record honesty audit (P9) — a security-disclosure doc asserting a closure that does not hold; the meta-audit/honesty reviewer may want it cross-listed.

## 4a. Honesty note (P9)

The shipped operator-facing `conductor/docs/HONEST-LIMITS.md` makes two claims this review falsifies: (1) line 119-120 "a bounded unwrap of `sh -c "…"` **so a wrapper cannot hide one**" — falsified by GATES-SECURITY-001/004 (any non-listed wrapper or shell keyword hides a write); (2) line 144-146 the sigil-deny "covers the alias route" — falsified by GATES-SECURITY-002 (`git -c core.pager=<cmd> log` executes arbitrary commands with a clean `git` command word). The document also omits the case-fold `.conductor` bypass (GATES-SECURITY-008). These are honesty defects in the one document "whose only job is honest disclosure."

## 4. Mutation table

| # | File | Mutation | Expectation | Result | Verdict |
|---|------|----------|-------------|--------|---------|
| M1 | gates-git.ts | remove `"apply"` from DESTRUCTIVE | gates-git RED | GREEN (146/146) — still denies via DEFAULT-DENY, only reason text changes | DESTRUCTIVE list is DECORATIVE for the decision; default-deny is the real gate. Tests don't distinguish specific-deny from catch-all-deny. See IDEA-002. |
| M2 | gates-git.ts | ADD `"apply"` to READ_ONLY_SIMPLE (dangerous dir) | gates-git RED | RED (3 fail) | Allow-list is pinned; the dangerous direction (destructive→allow) is caught. Binds. |
| M3 | gates-edit.ts | `REDIRECT_TO_FILE = /ZZZNEVER/` | gates-edit RED | RED (7 fail) | Redirect write-shape detection binds. |

Attack-string probes (positive reproductions, not source mutations) are documented inline in the ISSUE entries; the confirmed bypasses are GATES-SECURITY-001/002/003/004/005/006/007/008.

## 5. Coverage ledger

| File | What I did | Coverage | Conclusion / IDs |
|------|-----------|----------|------------|
| conductor/core/shell-parse.ts | Full read; heavy attack of tokenizer, wrapper unwrap, git-command detection, globMatch/segMatch case-fold, scopesIntersect analysis | high | Findings 001 (wrapper/keyword prefix), 003 (git-<sub>), 008 (globMatch case-fold). scopesIntersect + indexOf-slice CLEARED. |
| conductor/core/gates-git.ts | Full read; attacked DENY matrix, all discriminated subcommands, `-c` config-exec, branch/checkout/stash/restore boundaries; mutations M1, M2 | high | Findings 001, 002, 003, 005, 006. Allow-list dangerous-direction pinned (M2). DESTRUCTIVE decorative for decision (M1 → IDEA-002). |
| conductor/core/gates-edit.ts | Full read; attacked write-shape extractor, decideEdit scope/traversal/freeze, decideSession spawn/registry; mutation M3 | high | Findings 004 (write-shape mis-parse + keyword vector), 007 (apply_patch), 008 (.conductor case-fold). Redirect scan + `..` guard + spawn deny CLEARED. |
| conductor/core/gates-phase.ts | Full read; mutations M4 (RED-before-GREEN), M5 (report-settled) | medium | Both checks bind. No security-lens findings; composition (P7) is the continuation review's domain (cross-lens pointer). |
| conductor/adapter/tools.ts — gate seam (L100-560) + override hatch (L7862-7981) | Read in full | high (for seam) | classifyTool downgrade amplifies 001/004; editPath handling → 007; guardedDecide fail-closed reviewed; override hatch CLEARED (bounded, one-shot, foreign-proof). |
| conductor/plugin/index.ts — gate snapshot (L760-880, L1330-1394) | Read in full | high (for snapshot) | gateScopesFor/freezeTreeFor/inlineClaimScope all fail-closed (NO_GATE_SCOPE); freeze wired at production call site (not null). CLEARED. 008 reachable via broad scope; 007 via editPath. `runActive:true` hardcoded → IDEA-005. |
| conductor/adapter/continuation.ts (decideEdit call site) | Import + call-site skim only | low | Inline-claim coverage adjudication is the continuation review's domain; not deeply attacked. Pointer filed. |
| conductor/adapter/inject.ts (legalTools call site) | Import noted only | none | Injection/doctrine-delivery is another lens; not examined here. |
| conductor/core/schedule.ts, planning.ts, freshness.ts, evidence.ts (scopesIntersect/globMatch consumers) | Analyzed scopesIntersect semantics; noted globMatch case-fold reaches freshness/evidence | low-medium | scopesIntersect over-approx is safe (no de-serializing false negatives). globMatch case-sensitivity may affect freshness/evidence path-matching similarly to 008 — flagged for the crash-safety/freshness reviewer. |

## 6. Cleared areas

Attacks attempted that could NOT break the gate:

- **Operator-separated compound git.** `git status && git apply x`, `a || git push`, `echo|git apply`, `( git apply )`, `;`/newline separation — each puts the git verb in its own segment, correctly detected and DENIED. (The keyword/`{`/wrapper prefixes are the exception → GATES-SECURITY-001.)
- **Quote-glue evasion.** `g"i"t apply`, `$'git' apply`, `"\$(git apply)"`, backtick `` `git push` ``, `$'\x67it'` residual — all either resolve to `git` and DENY, or trip `hasUnresolvedExpansion` and DENY fail-safe. The ANSI-C/sigil residual rule holds.
- **Wrapper-with-flags (listed wrappers).** `sudo -u bob git push`, `env -i git push`, `sudo --user=bob git rm`, `env FOO=bar git push`, `command -p git commit` — the value-flag skip finds the git word and DENIES; read-only `sudo -u bob git status` correctly still ALLOWS. `sudo env git` (two levels) is unresolvable → DENY.
- **Separate-value globals.** `git --namespace foo apply`, `git --work-tree /x rm`, `git -C /x apply`, `git --git-dir /x apply` — DENY (either via the destructive/staging row or the unrecognized-global fail-safe).
- **Override hatch (§3.6).** Budget checked FIRST against both meters; exhaustion → atomic `env` stop + report (run becomes terminal), no grant minted; grant is one-shot, keyed `{sessionID, gate, itemId}`, consumed on first deny→allow conversion, unspendable by a foreign session; a multi-target write cannot be waved through by one grant. Could not spend around a gate beyond the budgeted, tainted, journaled single bypass.
- **`gitSubcommand` indexOf-slice quirk.** When an option value equals the subcommand token, `seg.indexOf(sub)` can slice from an earlier index — but this only WIDENS the operand list, and every discriminated arm can only add denies from more operands. Safe direction; could not turn it into a false ALLOW.
- **`scopesIntersect` false-negative hunt.** Over-approximates by literal-head prefix (case-folded); any two globs sharing a real file necessarily share a head-prefix, so a genuinely-overlapping pair can never report disjoint. No de-serialization of conflicting writers found.
- **Edit-gate path traversal / tree escape.** Absolute out-of-tree path → DENY (normalizeUnderTree null); any `..` segment → DENY (hasDotDotSegment); `.conductor/**` exact-case → DENY. The `..` and out-of-tree guards hold. (The case-fold spelling is the one that slips → GATES-SECURITY-008.)
- **decideSession registry gate.** Spawn (`task`) denied unconditionally in every session; unregistered write/conductor denied; unregistered read allowed (by design). Could not manufacture a registered session or route a write through an unregistered one via the registry gate.
- **Gate snapshot fail-closed derivation.** Every missing precondition (no ws, no registry entry, no itemId, no run, unloadable queue) yields `NO_GATE_SCOPE` (denies) or `null` freeze/claim; the freeze is wired through `freezeTreeFor` at the real call site (not the historical hardcoded `null`). Could not find a permissive default.

## Status: REVIEW COMPLETE for the gates-security scope.
Every scope file has a coverage-ledger row and a verdict. Confirmed findings: GATES-SECURITY-001…008. Mutations M1–M5 recorded. No stray processes; all four gate files restored and `cmp`-clean against snapshots.
