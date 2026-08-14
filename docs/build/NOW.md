# NOW — what the build is doing at this moment

Keep this file open. It is rewritten whenever the work changes, so it is never a summary
written after the fact.

**Last written:** 2026-08-14, with five agents in flight.

---

## Right now

Four tasks are being built at once, deliberately spread across four different gate legs so
their failures cannot be mistaken for each other:

| Task | Leg | State |
|---|---|---|
| 12.1 serve wiring | python `unittest` | implementer running |
| 15.0 replay tool | node TypeScript | implementer running |
| 15.2 dashboard | `ctest` / C++ | implementer running |
| 5.4a composition root (lifecycle half) | node TypeScript | test-writer running |
| 10.1 continuation + ask gate | node TypeScript | test staged, one row being added |

Every one of those reds was observed by running the command myself. An agent reporting "it
fails" is never accepted as evidence here.

**Suite:** 1158/1158 at the last clean point. **Ledger:** 46 of 55 rows committed.

---

## How to see it yourself, without me

```bash
git log --oneline -15                  # what actually landed, newest first
git status --short                     # what is being edited this second
bash scripts/verify-acceptance.sh      # the §11 checklist, as a script (6 PASS / 15 FAIL today)
bash scripts/test-conductor.sh         # the TypeScript gate (~90s)
./.out/build/clang-relwdebinfo/router-tests   # the C++ suite
```

`verify-acceptance.sh` is new and is the honest progress meter: it implements all twelve rows
of the plan's acceptance checklist plus six hollowness detectors, and it exits 0 only when the
build is genuinely done. Every one of its current failures names a task that has not been built.

---

## What just happened, and it is not comfortable

**The plugin is a shell.** `conductor/plugin/index.ts` never opens a state store, journals to a
`console.error` stub, holds a plain `Map` where the product needs a session registry, binds all
22 conductor tools to a handler that throws, and never registers the `chat.message` hook. So
`handleChatMessage` — the whole of Task 5.4: run creation, git-state capture, orchestrator
registration — **has no caller anywhere in the product.** In a real session no run is created
and no session is registered.

Its own test passes. The gate asked whether the module behaves, never whether anything calls it.

Two honest qualifications. First, this was already half-known: correction C-044 recorded months
of handler work being reachable only from tests, and correctly found the composition root is
assigned to Task 13.1's "glue fixes". What is new is the specific — `chat.message` unwired —
and its consequence: Task 10.1 cannot be built against a production path that does not exist.
Second, my first ruling on it was wrong. I wrote it up as a new defect and opened a task-let
before reading far enough to find C-044 had it. The correction record says so plainly.

The resolution takes C-044's own criticism seriously — that leaving all the glue to the last
coding task means the last task discovers every mismatch at once. Task-let **5.4a** now takes
the lifecycle half only: open the workspace, a real journal, a real registry, the
`chat.message` hook. The 22 tool bindings stay 13.1's, and the tools keep throwing until then.
That boundary is asserted by a test, so nobody later has to wonder whether it was forgotten.

## The live measurement, which found two things worth knowing

The upstream contract owed since Task 11.1 was measured against the 27B model:

- **`--ctx-size` is llama-server's TOTAL context, divided among slots.** The plan says to add
  `--parallel <slots>`; doing exactly that cuts every sub-session's window from 8192 tokens to
  1536. Silently — it is logged as a rounding notice.
- **The model returns an empty answer when it runs out of thinking room.** A schema-constrained
  question with a 1024-token budget spent all 1024 tokens thinking and returned an empty string
  with a success status. Turning thinking off answers the same question in 96 tokens, correctly.
  The widely-cited `/no_think` prompt switch is ignored by this model's template.

Neither was guessed. Both are recorded with the commands and raw output that produced them.

---

## What is left

Manifest tasks: 10.1, 12.2, 13.1, 13.2, 14.1, 14.2, 15.1 — plus the four in flight. Then the
G5 equivalence run, the phase gates for 10 through 15 and the owed Phase 11 gate, an acceptance
script that has to exit 0 in a clean checkout, and the completion report.
