# Enforcement Review Part — State store, evidence, quarantine, crash-safety

**Scope:** `conductor/adapter/state.ts`, `journal.ts`, `evidence.ts`, `quarantine.ts`, `gitio.ts`.
Torn writes, the advisory lock (dead-pid, over-age, TOCTOU), atomic tmp+rename, cross-filesystem
EXDEV, crash-safe quarantine replay, no-clobber restore, out-of-repo isolation, the verify marker
lifecycle. Crash simulation. Evidence forgery/reuse/misattribution/freshness.

**Date:** 2026-08-15
**Reviewer:** state-crash sub-reviewer (step 2 enforcement lens)
**Status:** COMPLETE. 6 ISSUEs (2 MAJOR, 1 MODERATE-evidence, 1 MODERATE, 2 LOW), 4 IDEAs, 5
cross-lens pointers. All source mutations restored + `cmp`-verified. Spawned processes reaped.

---

## 1. ISSUE register

(entries STATE-CRASH-001…; appended as found)

> Note on fields: the enforcement charter says "full record per the briefing's field list
> (§10 conventions)" — the briefing has no §10; it ends at §8. I use: Pattern / Severity /
> Where / Claim / Defect / Evidence / What gets away / Refutation attempted / Fix direction.
> (Filed as a cross-lens pointer too.)

### STATE-CRASH-001 — "read-only conductor" guards 2 of ~12 mutating store methods, and NOTHING consults the flag

- **Pattern:** P4 (name asserts a property the body does not implement) + P7 (composition hole)
- **Severity:** MAJOR
- **Where:** `conductor/adapter/state.ts:497` (createRun guard), `:589` (removeItem guard) — the only
  two `readOnly` checks in the codebase; `saveRun` (548), `saveItem` (576), `setBlocked` (597),
  `clearBlocked` (620), `setDeferred` (632), `setDebugging` (643), `addStaleRed` (405),
  `removeStaleRed` (415), `archiveRun` (563) all write to disk unguarded.
- **Claim:** Plan §4.1 / task 4.1 (plan lines 2287-2289): "the lock guards against two opencode
  sessions sharing a workspace — second session gets **read-only conductor** with a loud journal
  warning." Honest-limits row 8 (plan 3077): "the second gets read-only conductor."
- **Defect:** The contended-open path sets `readOnly = true` and journals `lock.contended`, but the
  store it returns will still happily `saveRun`/`saveItem`/`setBlocked`/`clearBlocked`/`setDeferred`/
  `setDebugging`/`addStaleRed`/`removeStaleRed`/`archiveRun` — i.e. clobber the live writer's
  run.json/item.json/stale-red registry/current-run pointer. Worse, `grep -rn "\.readOnly"` over
  `conductor/` (excluding state.ts and its test) finds **zero** consumers: no handler in `tools.ts`,
  nothing in `plugin/index.ts`, nothing in the composition root refuses work because the store is
  read-only. (`tools.ts:6843`'s `readOnly` is a different concept — `gitMode === "read-only"`.)
  Additionally the liveness beacon (`alive.json`) is written unconditionally BEFORE `acquireLock()`
  (state.ts:738-743), so the demoted second session **overwrites the live writer's beacon** with its
  own pid/sessionID — the §3.8 liveness signal now names the wrong process.
- **Evidence:** reproduced (see mutation/experiment table E3): a store opened against a live foreign
  lock reports `readOnly === true` and then successfully persists `saveRun`/`saveItem`/`setBlocked`
  to disk; beacon on disk carries the second opener's pid.
- **What a crash/second session gets away with:** any dual-session scenario (the exact case the lock
  exists for) has both sessions writing item/run state, evidence, and verify markers into one runDir;
  the "single-writer" property holds only for creating runs and removing items.
- **Refutation attempted:** maybe the plugin refuses to boot at all when contended? No — no consumer
  of the flag exists anywhere; and even if boot refused, the store API itself is the claimed boundary
  and it does not hold. Maybe evidence/verify writes are separately locked? No — `runVerify` takes a
  bare `runDir` and never sees the store.
- **Fix direction:** guard EVERY mutating method behind `readOnly` (one throw helper), or have the
  composition root refuse to register tool handlers when `store.readOnly`; write the beacon only
  after winning the lock (or write a distinct observer beacon).

### STATE-CRASH-002 — stale-lock break is a naked read-then-overwrite: two openers racing on the same stale lock both become writers (TOCTOU)

- **Pattern:** TOCTOU (the same race F4 closed for the fresh-claim path, left open here)
- **Severity:** MAJOR (mechanically confirmed by widening the window; real-world window is small)
- **Where:** `conductor/adapter/state.ts:324-347` (`decideForeign`), `:336` overwrite via
  `writeFileAtomicSync`, reached from `acquireLock` at `:373`.
- **Claim:** single-writer: at most one live session holds the workspace as a writer.
- **Defect:** the fresh-claim path was hardened with exclusive-create (`flag: "wx"`, F4, state.ts:362)
  precisely because "two cold starts that both saw no lock cannot both become writers." The
  stale-break path has the identical shape — read (`readExistingLock`), decide (dead-pid/over-age),
  write (plain atomic overwrite) — with no exclusivity and no re-check. Two processes that both read
  the same dead-pid lock both decide "stale", both overwrite, and BOTH return `readOnly=false`. The
  same hole exists for the corrupt-lock path (`readExistingLock` maps an unparseable lock to null →
  both racers take the wx path, both get EEXIST, both re-read null, both `claimLock` overwrite —
  state.ts:369).
- **Evidence:** experiment E2 (see table): with the decide-to-write window widened by a 300 ms sleep
  (source mutation, snapshotted+restored, `cmp`-verified), two concurrent `openWorkspace` calls
  against one dead-pid lock both reported `readOnly=false`. The unmutated code has the same
  structure; only the window width differs.
- **What gets away:** two crashed-then-restarted conductors (e.g. a user relaunching while an old
  session's lock is stale) both proceed as writers — exactly the double-writer state the lock exists
  to prevent, compounding STATE-CRASH-001.
- **Refutation attempted:** "the window is a few microseconds, so it never happens" — the F4 fix
  rejects that argument for the fresh path; the stale path is strictly more likely in practice
  because stale locks are exactly what simultaneous post-crash restarts see.
- **Fix direction:** break-then-claim exclusively: `rm` the stale lock, then take the SAME `wx`
  fresh-claim path (whose EEXIST arm already handles losing the race).

### STATE-CRASH-003 — release() deletes whoever's lock is present, handing the workspace to a third writer

- **Pattern:** ordinary correctness (unguarded delete), P7 flavor
- **Severity:** MODERATE
- **Where:** `conductor/adapter/state.ts:725-731` (`release`)
- **Claim:** "Only a writer releases its own lock" (comment at :726).
- **Defect:** `release()` checks only the instance's own `readOnly` flag, then `rmSync(lockPath)`
  unconditionally. If our lock was legitimately stale-broken by a second session (over-age break of a
  still-alive holder — the exact case DEFAULT_STALE_LOCK_MS=24h exists for), the file now belongs to
  the NEW writer; our release deletes THEIR lock. Any third opener then fresh-claims and runs as a
  concurrent writer beside the second. The comment claims "its own lock"; the body never verifies
  `lock.pid === pid`.
- **Evidence:** experiment E4 (deterministic, no race): A opens (writer) → B opens with
  `staleLockMs=0` (over-age break, B is writer) → A.release() → lock file GONE (B's lock deleted) →
  C opens → fresh-claims → writer. B and C both writers.
- **What gets away:** a >24h-running session that exits cleanly unlocks a workspace another session
  now owns.
- **Refutation attempted:** "an over-age writer should be dead anyway" — over-age break fires on
  *alive* holders by design (recycled-pid defense), so the survivor calling release() is an intended
  state, not a corner.
- **Fix direction:** re-read the lock in release() and delete only when `pid` matches ours (same
  no-steal discipline the marker gate uses).

### STATE-CRASH-004 — a quarantine partial-move crash leaks its dir forever and is re-scanned on every verify

- **Pattern:** ordinary correctness / resource leak (the §F2 conflict logic conflates two cases)
- **Severity:** LOW (no data loss; unbounded dir accumulation + per-verify rescan cost)
- **Where:** `conductor/adapter/quarantine.ts:302-332` (`restoreEntries`) + `:361-401`
  (`replayPendingRestores`). Root cause: the manifest is written ONCE (`:229`) with every entry
  `restored:false` and is **never re-persisted**; `restoreEntries` flips `entry.restored` in memory
  only (`:322,:329`).
- **Claim:** module header (`:17-20`): "a kill at any point leaves a manifest that names every
  planned move; the next run replays the pending restores." §F2 no-clobber (`:309-314`): a refilled
  slot is preserved.
- **Defect:** if `quarantineFiles` crashes after moving file A out but before moving file B (B never
  left the repo), the manifest lists both `restored:false`. Replay restores A correctly, but for B
  the repo slot EXISTS (B never moved) → treated as a §F2 "conflict" → the whole quarantine dir is
  preserved. Because the manifest is never rewritten, EVERY subsequent `replayPendingRestores` (which
  runs at the head of every `runVerify`, evidence.ts:836) re-reads the same manifest, re-detects A's
  now-restored slot and B's untouched slot as conflicts, and re-preserves the dir. The dead
  `<runId>` dir accumulates permanently and is re-scanned on every verify for the life of the
  workspace.
- **Evidence:** reproduced (experiment E7): a hand-built partial-crash manifest (dead owner pid, A
  parked in quarantine, B still in repo) → replay 1 restored A, left the `r-1` dir; replay 2 restored
  nothing and the dir persisted. Data was never lost (A and B both correct in the repo).
- **What gets away:** nothing corrupts, but a workspace that suffers repeated partial-quarantine
  crashes accumulates dead quarantine dirs, each re-walked on every future verify.
- **Refutation attempted:** "the intended §F2 case (user refills the slot) is correct" — yes, and it
  ALSO leaks the same way: once a slot is legitimately refilled, the stored stale-red file is parked
  forever with no reclamation path.
- **Fix direction:** re-persist the manifest after `restoreEntries` (mark restored entries), and/or
  distinguish "entry never moved (src absent AND dst present)" from "slot refilled (src present AND
  dst present)" — only the latter is a real conflict; the former should be dropped.

### STATE-CRASH-005 — evidence `nextSeq` is a read-max-plus-one with no cross-process guard: two writers on one runDir mint duplicate seqs, and `readEvidenceAt` returns the wrong record

- **Pattern:** P1-adjacent (a monotonic key that isn't) + misattribution; conditional on 001/002
- **Severity:** MODERATE (conditional: requires the double-writer state 001/002 makes reachable)
- **Where:** `conductor/adapter/evidence.ts:249-272` (`nextSeq`) and the twin in `tools.ts:249` for
  the publish batch; consumed by `readEvidenceAt` (`tools.ts:6627-6644`, **first-match wins**,
  `:6641`) and `capturedRedOf` (`tools.ts:3483`, first-match).
- **Claim:** evidence seq is the ledger's monotonic primary key; `item.evidence.{red,green,validated}`
  point at a record BY seq and that pointer resolves the exact record the transition rested on.
- **Defect:** `nextSeq` reads the whole `evidence.jsonl`, takes `max(seq)+1`, with no lock and no
  atomic reserve. Within one process every evidence append is synchronous (spawnSync/appendFileSync),
  so single-process operation is safe. But `evidence.jsonl` is **per-run, not per-item**
  (`ledgerPathOf(runDir)`, runDir = `store.root/.conductor/runs/<runId>`, one dir shared by every
  item — confirmed at `tools.ts:458`). The moment two conductor PROCESSES share a runDir — exactly
  what STATE-CRASH-001 (read-only session's handlers still run) and STATE-CRASH-002/003 (double
  writer) make reachable — both call `runVerify`/`runTest` → `appendEvidence` → `nextSeq`, both read
  the same max, both write the same seq. Now two records share a seq; `readEvidenceAt` returns the
  FIRST, so `item.evidence.validated.seq` can resolve to the OTHER item's/session's verify record.
  Freshness (`verifyFreshFor`) is then checked against the wrong record's `startedMs`/`head`.
- **Evidence:** by construction + the confirmed reachability of 001/002. Not independently
  reproduced with two live processes (would require staging the double-writer harness end-to-end);
  filed as MODERATE with that caveat named. The seq-computation code and the shared-runDir fact are
  both verified by reading.
- **What gets away:** under any dual-session/double-writer scenario, an item can be published on
  another item's (or session's) verify record whose seq happens to collide.
- **Refutation attempted:** "fan-out serializes evidence writes" — within one process, yes (all
  synchronous); this finding is explicitly cross-process and inherits 001/002's reachability.
- **Fix direction:** fix 001/002 (single writer) as the primary defense; additionally have
  `readEvidenceAt`/publish verify `record.itemId === itemId` (see STATE-CRASH-006), and consider an
  O_APPEND-reserved or lock-guarded seq.

### STATE-CRASH-006 — publish resolves its verify record by seq alone and never checks the record's itemId or tree

- **Pattern:** P4-adjacent / missing defense-in-depth attribution check
- **Severity:** LOW (latent; single-process operation is correct)
- **Where:** `conductor/adapter/tools.ts:6862-6884` (publish step 1) resolves
  `record = readEvidenceAt(runDir, item.evidence.validated.seq)` and checks only `record.head`
  against `headSha(treeRoot)`. `readEvidenceAt` (`:6627`) matches seq ONLY — it never inspects
  `itemId`. Contrast `capturedRedOf` (`:3468`) which DOES filter `parsed.itemId !== itemId`.
- **Claim:** the verify a publish rests on is THIS item's verify against THIS tree (§2.6; the
  `tree`/`itemId` fields exist on the record precisely to say so).
- **Defect:** publish confirms `record.head === currentHead` but never confirms
  `record.itemId === itemId` nor `record.tree` matches the tree it is publishing (main vs the
  worktree slug). So any mechanism that makes `validated.seq` point at a foreign record (the seq
  collision of STATE-CRASH-005, or a future handler bug) is not caught here — the record's own
  self-description is ignored. The attribution check is applied inconsistently across the codebase
  (red is filtered by itemId; validated/green via `readEvidenceAt` are not).
- **Evidence:** read-confirmed; `readEvidenceAt` body and publish step-1 both inspected.
- **What gets away:** a mis-pointed `validated.seq` publishes on the wrong item's/tree's green
  without any record-identity check firing.
- **Refutation attempted:** "the handler sets validated.seq from the record it just wrote, so it is
  always this item's" — true in single-process; the finding is about the ABSENCE of the cheap
  defense-in-depth check that would catch the cases 005 and future bugs introduce, given the codebase
  already applies exactly that check for red evidence.
- **Fix direction:** in publish step 1 (and `readEvidenceAt`'s security-relevant callers), assert
  `record.itemId === itemId` and, in worktree mode, `record.tree === expectedTree`; deny otherwise.

---

## 2. IDEA register

### IDEA-SC-1 — sweep orphaned `*.tmp` files from the state area
Origin: E5 (SIGKILL mid-atomic-write) left `run.json.<pid>.<hex>.tmp` behind — the catch/rmSync
never ran because the kill preceded it. No reader mistakes `.tmp` for real data (every reader filters
`.json` exactly, and markers require the `.json` suffix), so this is not corruption, but the tmps
accumulate across every hard crash. Kind: polish/tooling. Value: a clean state dir for a human
debugging a crash; bounded disk. Cost: small (glob-and-unlink stale `*.tmp` at openWorkspace, guarded
by age). Relates to: standalone.

### IDEA-SC-2 — evidence `nextSeq` should not silently reset after a journal-style rotation
Origin: reading journal.ts `readLastSeq` (evidence.ts has the analogous `nextSeq`). The journal
rotates `journal.jsonl` to empty on size overflow; a fresh journal instance created in the window
before the first post-rotation record would read an empty file and restart `seq` at 0, colliding with
archived seqs. Narrow, but a monotonic key that can silently reset is a debuggability trap. Kind:
robustness. Value: seq stays a true primary key across rotation+reopen. Cost: small (persist a
`seq-high-water` sidecar, or read the newest `.gz` archive's last seq on reopen). Relates to:
STATE-CRASH-005.

### IDEA-SC-3 — make `liveVerifyTrees` and `runVerify` read the SAME clock, not two
Origin: `liveVerifyTrees` defaults `now` to `Date.now` (evidence.ts:689) while `runVerify` takes the
handler's injected `now`. In production both are wall-clock so they agree, but under an injected/
pinned clock (tests, or any future deterministic mode) the two over-age judgements can diverge — the
exact two-derivations-of-one-fact shape the module's own comment (:672-677) says it exists to
prevent. Kind: robustness/consistency. Value: the freeze fact stays single-sourced under every clock.
Cost: small (thread the run's clock into the plugin's `liveVerifyTrees` calls). Relates to:
STATE-CRASH cleared-area (marker over-age).

### IDEA-SC-4 — re-persist the quarantine manifest after each restore, or drop never-moved entries
Origin: STATE-CRASH-004. The manifest is write-once; `restored` flips only in memory. Persisting it
(atomically) after `restoreEntries`, or distinguishing "never moved" (src absent, dst present) from
"refilled" (src present, dst present), would let a healed dir be reclaimed. Kind: robustness. Value:
no dead-dir accumulation, no per-verify rescan of un-reclaimable dirs. Cost: small. Relates to:
STATE-CRASH-004.

---

## 3. CROSS-LENS POINTERS

- **MACRO (design coherence):** `store.readOnly` has ZERO consumers outside state.ts. Either the
  "read-only conductor for a second session" is a designed capability that was never wired
  (STATE-CRASH-001), or the flag is vestigial. The macro lens should decide whether second-session
  read-only is a real feature and, if so, where the boundary belongs (composition root vs. every
  store method).
- **MACRO (navigability/design):** `evidence.jsonl` is per-RUN and shared by every item, while
  `nextSeq` is a naive read-max-plus-one. Under `parallel.writes:"worktrees"` this couples items that
  are otherwise isolated. Worth a design look: per-item ledgers, or a reserved-seq allocator.
- **ENFORCEMENT-MAIN (security / gate snapshot):** the `.conductor/**` edit deny is solid for the
  file-edit path (all roles, normalized path, `..` denied), but forgery of `evidence.jsonl` via the
  BASH tool (`echo … > .conductor/runs/<id>/evidence.jsonl`, `tee`, `sed -i`) depends on the
  bash-write-target extractor reaching `checkEdit` with the right tree. That extractor lives in
  gates-edit.ts (§3.5) — the security lens owns confirming a redirect into `.conductor` is denied.
- **ENFORCEMENT-MAIN (freshness):** publish (`tools.ts:6862-6884`) checks `record.head` but never
  `record.tree`; in worktree mode a main-tree verify and a worktree verify with a coincidentally
  equal HEAD are not distinguished. Pairs with STATE-CRASH-006.
- **CAPABILITY:** a structural single-writer — an OS advisory lock (`flock`/`O_EXCL` held open for the
  process lifetime) rather than an advisory pid-file that is read, reasoned about, and rewritten —
  would make STATE-CRASH-001/002/003 impossible by construction rather than by careful sequencing.

---

## 4. Mutation table

| # | File | Mutation | Expectation | Result | Verdict |
|---|---|---|---|---|---|
| E1 | (baseline) | none — ran `test-conductor.sh` on state/quarantine | GATE PASS | PASS (state 19/19; quarantine gate PASS) | baseline green confirmed before mutating |
| E2 | state.ts:336 | inserted a 300ms spin between stale-lock read and overwrite, then raced two child processes against one dead-pid lock | if the stale-break were race-safe, exactly one child is a writer | BOTH children `readOnly:false` (double writer) | **binds a real hole** — STATE-CRASH-002. Restored + `cmp` RESTORED-IDENTICAL |
| E3 | none (API only) | opened a store against a LIVE foreign lock; called saveRun/saveItem/setBlocked/addStaleRed/archiveRun/createRun | a read-only store refuses mutations | saveRun/saveItem/setBlocked/archiveRun **WROTE to disk**; only createRun+removeItem guarded; addStaleRed threw on an unrelated schema error; beacon.sessionID overwritten by the 2nd session | **STATE-CRASH-001** — the read-only guard is decorative for 10 of 12 methods |
| E4 | none (API only) | A(writer) → B over-age-breaks A (staleMarkerMs=0) → A.release() → C opens | release deletes only A's own lock | A.release() deleted **B's** lock; C fresh-claimed; B and C both `readOnly:false` | **STATE-CRASH-003** — release deletes whoever's lock is present |
| E5 | none (crash hook) | SIGKILL a child inside `writeFileAtomicSync`'s onBeforeRename (tmp written, rename pending) | old target byte-for-byte intact | old value survived; **orphan `.tmp` left** (kill preempted the catch) | **CLEARED** (no corruption) + IDEA-SC-1 (tmp leak) |
| E6 | fs.renameSync monkeypatch | attempt to SIGKILL mid-quarantine via namespace patch | crash after 1st move | ESM namespace is read-only → child threw (status 1); crash NOT achieved | inconclusive — superseded by E7 |
| E7 | none (constructed state) | hand-built partial-move crashed manifest (A parked, B never moved, dead owner pid); ran replay twice | A restored, no data loss; dir reclaimed | A restored (data safe); dir `r-1` **leaked**, re-scanned every replay | **STATE-CRASH-004** (LOW leak); data-safety CLEARED |

All source mutations (E2 only) were snapshotted (`cp` to scratchpad), restored, and verified with
`cmp` → RESTORED-IDENTICAL. Baseline re-run after restore: state 19/19 PASS.

---

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion |
|---|---|---|---|
| conductor/adapter/state.ts | Read in full (768 lines). Mutation-tested the stale-break window (E2). API-tested read-only guard + beacon clobber (E3) and release-deletes-foreign (E4). Traced every `readOnly` check and every mutating method. Reviewed atomic write (E5), assertSafeId traversal guards, mintRunId, pruneRuns, createRun ordering (F5), lock acquisition (fresh/own/foreign/stale). | HIGH | 3 findings (001 MAJOR, 002 MAJOR, 003 MODERATE). Atomic write, path-id guards, createRun ordering, over-age/dead-pid break (single-opener) all hold. |
| conductor/adapter/evidence.ts | Read in full (896 lines). Analyzed `nextSeq` concurrency (005), `liveVerifyTrees`/`runVerify` marker over-age (C-081 fix confirmed present + consistent thresholds), runVerify try/finally ordering, SIGKILL/timeout kill (SIGKILL uncatchable), childEnv hygiene, classification relativization. | HIGH | 1 finding (005 MODERATE, cross-process seq). Marker lifecycle, quarantine ordering, timeout-kill, env hygiene all hold. C-081 (liveVerifyTrees honoring dead/over-age) is genuinely fixed and single-sourced. |
| conductor/adapter/quarantine.ts | Read in full (401 lines). Crash-replay tested via constructed partial-crash state (E7); EXDEV path read + test-confirmed; no-clobber conflict read + test-confirmed (6.1-q-noclobber). Traced manifest-before-moves ordering, pidAlive live-owner skip, assertSafeRelPath/assertSafeId trust boundaries. | HIGH | 1 finding (004 LOW leak). Move-aside/restore/replay heal data-safely; out-of-repo isolation and traversal guards hold. |
| conductor/adapter/gitio.ts | Read in full (320 lines). Reviewed GIT_ENV override-stripping, argv/shell:false discipline, tryGit vs runGit failure split, -z NUL parsers, indexMtimeMs zero-index fallback, gitCommonDir (C-021). | MEDIUM-HIGH | No new findings. Env hygiene and argv discipline are sound; the read-only contract (map expected non-zero exits, re-throw spawn faults) is correctly implemented. maxBuffer=64MB on `dirtyFiles`/`stagedFiles` could throw on a pathological untracked set (edge, not filed). |
| conductor/adapter/journal.ts | Read in full (285 lines). Reviewed torn-line healing (endsWithoutNewline, once-per-instance), readLastSeq end-scan, rotation (gzip + nextRotationIndex probe), shrinkToFit 32KiB bound, level/env threshold resolution, unknown-event throw-in-dev / retain-in-prod. | MEDIUM-HIGH | No filed ISSUE; IDEA-SC-2 (seq reset in the post-rotation empty-file window). Torn-line healing and rotation-index probing are correct and crash-safe. |

---

## 6. Cleared areas

Things I attacked and could NOT break, with the attack named:

- **Atomic tmp+rename crash-safety (state.ts `writeFileAtomicSync`).** Attack: real SIGKILL of a child
  inside the onBeforeRename window, tmp fully written, rename pending (E5). The OLD target survived
  byte-for-byte; the next read heals to the old value. The only residue is an orphan `.tmp` no reader
  consumes (IDEA-SC-1). Also confirmed the in-process throw-hook path drops the tmp and re-raises.
- **Out-of-repo quarantine isolation + crash replay (quarantine.ts).** Attack: constructed a
  partial-move crash with a dead owner pid and replayed (E7); also relied on the committed EXDEV
  (injected-rename), no-clobber (6.1-q-noclobber), and dead-pid-only-heal (6.1-q-replay) tests. Data
  is never lost or clobbered; a live owner's quarantine is never stolen; a vanished repoRoot is never
  recreated. Only residue: the dir leak (STATE-CRASH-004, LOW).
- **`.conductor/**` edit forgery via the file-edit gate (gates-edit.ts `checkEdit`).** Attack: read
  the gate for every role. `.conductor/**` is denied for ALL roles against the NORMALIZED
  (tree-relative) path; `..` traversal is denied before scope matching; a path outside the session
  tree is denied at normalization. A worktree session cannot reach the main-root `.conductor` (it
  normalizes to null → deny). Evidence cannot be forged through file edits. (The BASH-redirect path is
  a cross-lens pointer to the security lens.)
- **Path-id trust boundary (state.ts `assertSafeId`, quarantine.ts `assertSafeRelPath`).** Attack:
  reviewed against `/`, `\`, `.`, `..`, leading `..`, absolute paths, and non-slug chars. Every id
  composed into a `.conductor/` path (runId/itemId) and every quarantine target and marker `tree`
  slug is guarded; traversal cannot escape the state area or the repo. Backed by the committed
  4.1-path-safety and F3 tests.
- **Marker over-age / dead-pid lifecycle, and `liveVerifyTrees` honoring it (evidence.ts).** Attack:
  checked whether `liveVerifyTrees` reports a marker `runVerify` would break (the C-081 P4 defect).
  It reuses the same readMarker/pidAlive/over-age rule and the SAME default threshold (24h,
  DEFAULT_STALE_MARKER_MS); no caller overrides it (grep: zero `staleMarkerMs` in tools.ts). The two
  seams agree. Genuinely fixed. (Residual clock-source nit: IDEA-SC-3.)
- **Timeout kill authority (evidence.ts `spawnCapture`).** Attack: confirmed SIGKILL (uncatchable),
  not SIGTERM, so a hung test that traps SIGTERM cannot exit 0 and read as a false GREEN; a non-numeric
  status maps to exit 124 (red). Holds.
- **Journal torn-line healing + rotation (journal.ts).** Attack: reviewed the once-per-instance
  trailing-newline check and the end-scan `readLastSeq`; a crash-torn partial last line is isolated on
  its own unparseable line and skipped, never concatenated onto. Rotation probes upward so a restart
  never clobbers an archive. Holds (residual seq-reset edge: IDEA-SC-2).
- **Git env hygiene (gitio.ts `GIT_ENV`, evidence.ts `childEnv`).** Attack: confirmed both strip
  GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR and set GIT_OPTIONAL_LOCKS=0, so an inherited
  override cannot redirect a query onto the parent repo, and a child test's git reads cannot leak into
  the conductor's checkout. childEnv also strips NODE_TEST_CONTEXT. Holds.
- **BOM tolerance and unparseable-file resilience.** Every reader (readJsonFileSync, readManifest,
  readMarker, readCurrentPointer, readExistingLock, readStaleRed, nextSeq, capturedRedOf,
  readEvidenceAt, countOpenQuestions) strips a leading BOM and/or treats an unparseable file as
  absent rather than throwing. Holds.

---

## Appendix — note on the read-only guard's ONE working case

For completeness: `createRun` (state.ts:497) and `removeItem` (state.ts:589) ARE guarded by
`readOnly` and throw. So the "second session is read-only" claim holds for *creating runs* and
*removing items* only. Every other mutation — including the disposition setters the plan's task-4.1
text explicitly enumerates as part of the store surface ("item CRUD **including the disposition
setters**", plan line 2281) — is unguarded (STATE-CRASH-001). The guard is present exactly where the
tests happen to exercise it and absent everywhere else, which is why the gate stayed green.
