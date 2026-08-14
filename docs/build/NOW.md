# NOW — what the build is doing at this moment

Keep this file open. It is rewritten whenever the work changes, so it is never a summary
written after the fact.

**Last written:** 2026-08-13, immediately after the Phase 9 milestone gate's fix round was
dispatched.

---

## Right now

**Running:** a fix workflow for the Phase 9 milestone gate's confirmed defects.
Three fixes in files nothing else touches went in parallel; everything after them edits
`conductor/adapter/tools.ts`, so those run strictly one at a time.

| Stage | What it fixes | State |
|---|---|---|
| Independent | journal vocabulary breaches; worktree recreation after a crash; queue-amend keeping stale evidence | landing now |
| PublishOrder | `handlePublish` commits before checking it was allowed to | queued |
| PublishStaging | pathspec-less commit sweeps the whole index; empty pathspec diffs the whole tree; deletions never staged | queued |
| WorktreeTrees | stage handlers test the MAIN tree while sub-sessions edit the worktree | queued |
| Remainder | vacuous closing verify; driver abandons a live stage; surface overwrites an existing block | queued |

**Suite:** 1135/1135 GATE PASS. **Tasks:** 43 of 54 committed.

---

## How to see it yourself, without me

```bash
git log --oneline -15                  # what actually landed, newest first
git status --short                     # what is being edited this second
bash scripts/test-conductor.sh         # the TypeScript gate (~90s)
./.out/build/clang-relwdebinfo/router-tests   # the C++ suite
```

The working tree is usually CLEAN, because each task is committed the moment it passes its
gate. That is why an editor's source-control panel looks idle — the work is in the history,
not in pending edits. `git log` is the honest view.

Two files carry the reasoning rather than the result:

- `docs/build/CORRECTIONS.md` — every defect found, why it existed, and how it was closed.
  Newest at the bottom. This is the most useful file in the repo for understanding what has
  gone wrong and what was learned.
- `docs/build/STATE.json` — the task ledger: status and commit sha per task.

---

## What just happened (the last hour)

The Phase 9 milestone gate ran: six blind review lenses over ~9,500 lines, then two
refute-biased skeptics per finding. It returned 46 findings, 29 major, ~20 distinct after
deduplication. Two are fixed and committed:

- **C-054** — `legalTools`' `publishEnabled` flag was passed by NO production call site, and
  the guard test I had claimed prevented exactly that did not exist. I had written that claim
  in a correction record and a code comment, in the past tense, without building it. Under
  no-git the gate therefore recommended a tool the handler always refuses. Guard built, all
  three call sites wired.
- **C-055 (security)** — a wildcard `fileScope` granted edit permission to any absolute path
  on the machine. `globMatch("**", "/etc/passwd")` is true, and an out-of-tree path was being
  left unchanged for scope matching to reject. Now denied at normalization, before any scope
  match.

---

## What is left after this round

11 manifest tasks: the 11.8 live smoke, Phase 10 (continuation + ask-gate), Phase 12
(serve.py wiring), Phase 13 (end-to-end + the composition root), Phase 14 (benchmark) and
Phase 15 (acceptance + completion report). Then the final adversarial review of the whole
repo.
