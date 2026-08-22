# Task: subsystem deep dive — {{SUBSYSTEM}} in {{TARGET}}

You are writing the document a maintainer of the **{{SUBSYSTEM}}** subsystem would keep
open while working on it. Not an introduction — a working reference: every important
type and function, the lifecycle, the locking rules, the error paths, the performance
shape, and the places where the code will bite someone who assumes the obvious.

The thing being measured is **accuracy**. A fluent document describing a subsystem
subtly unlike the one in the checkout scores worse than a plain one whose every claim
points at a line of code. Assume a reviewer opens every file you cite.

---

## 1. Variables

| Variable | Meaning |
|---|---|
| `{{TARGET}}` | Slug of the target repository, e.g. `redis` |
| `{{TARGET_PATH}}` | Checkout path: `docs-generation/targets/checkouts/{{TARGET}}/` |
| `{{SUBSYSTEM}}` | The subsystem you are documenting, e.g. `replication`, `query-planner`, `scheduler` |
| `{{RUN_ID}}` | Run identifier, e.g. `qwen3.6-27B__llama-harness` |
| `{{TASK_ID}}` | `{{TARGET}}-{{SUBSYSTEM}}-deepdive` |

Paths in this prompt are relative to the test-corpus repository root unless stated
otherwise.

---

## 2. Input

The target codebase is checked out at `{{TARGET_PATH}}`.

**The checkout is READ-ONLY.** You may read any file and run read-only inspection
commands (`ls`, `find`, `grep`, `rg`, `cat`, `sed -n`, `wc`, `git log`, `git show`,
`git blame`). You must **not**:

- modify, create, delete, or move any file under `{{TARGET_PATH}}`
- build, compile, install, configure, or run the target
- run any `git` command that writes
- access the network

Establishing the subsystem's boundary is part of the task. `{{SUBSYSTEM}}` names a
concern, not necessarily a directory. Decide which files constitute it, list them, and
justify the boundary in section 1 of the document. If the name maps to a directory,
say so and check whether anything outside that directory belongs.

If a claim can only be settled by building or running, do not build or run — put it in
**Open questions**.

---

## 3. Output

Create your workspace per `CONVENTIONS.md` section 4; for this category the
`<language>` slot holds the **output format**:

```sh
tools/new_workspace.sh {{RUN_ID}} {{TASK_ID}} markdown
```

Workspace root: `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`

| File | Contents |
|---|---|
| `SUBSYSTEM-{{SUBSYSTEM}}.md` | The deliverable. Exact, case-sensitive filename. |
| `run.json` | Per `CONVENTIONS.md` section 5. `language` is `"markdown"`. |
| `build.sh` | No-op. `exit 0`. |
| `run.sh` | Prints the stdout summary in section 8. |
| `test.sh` | Self-check defined in section 8. |

Scripts follow `CONVENTIONS.md` section 6: `chmod +x`, `#!/usr/bin/env bash`,
`set -euo pipefail`, no network, run with `markdown/` as the working directory.

The document opens with this YAML front matter, values filled in:

```yaml
---
task_id: {{TASK_ID}}
target: {{TARGET}}
subsystem: {{SUBSYSTEM}}
run_id: {{RUN_ID}}
document: SUBSYSTEM-{{SUBSYSTEM}}.md
word_count: 0
citation_count: 0
---
```

---

## 4. THE CITATION RULE

This is the core requirement of this category. Read it twice.

**Every non-obvious factual claim about the target must carry an inline citation.** A
non-obvious factual claim is any statement about what the code is, does, contains,
enforces, assumes, or guarantees. General programming background needs no citation;
anything specific to {{TARGET}} does.

A citation is a parenthesised path-and-line reference in **exactly** this form:

```
(path/to/file.c:LINE)
(path/to/file.c:START-END)
```

Rules the mechanical checker enforces:

1. The path is relative to the **checkout root** — relative to `{{TARGET_PATH}}`. Never
   include `{{TARGET_PATH}}`, never a leading `./`, never a leading `/`, never an
   absolute path. Forward slashes only.
2. Allowed path characters: `A-Z a-z 0-9 . _ + - /`. If a file you must cite contains
   another character, cite it anyway and note the problem in **Open questions**.
3. `LINE`, `START`, `END` are 1-based decimal integers. `START <= END`. `END` must not
   exceed the file's line count. A range spans at most 60 lines; use several tight
   ranges rather than one loose one.
4. One path per parenthesis. Several citations are several parentheses separated by a
   space: `(src/repl.c:120) (src/repl.h:44-51)`.
5. The citation sits in the same sentence, bullet, or table cell as the claim.

The checker parses citations with:

```
\(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
```

and verifies path existence and line-range validity. It reports **citation validity
rate** and, via the judge, **unsupported claim rate**. Both are scored — see
`docs-generation/rubric.md`.

**No fabricated paths.** Every path mentioned anywhere in the document — prose, tables,
commands, diagram legends — must exist in the checkout. A path that does not exist is
treated as fabrication and is the most damaging error available to you in this
category. The same applies to symbol names: do not describe a function that does not
exist.

**Density expectation.** Every row of the type and function inventories carries a
citation, and every subsection of the lifecycle, concurrency, error, and performance
sections carries at least one. In practice a passing document has **at least 20
citations across at least 6 distinct files**. If the subsystem genuinely spans fewer
than 6 files, say so explicitly in section 1 and cite what exists; the floor is a
symptom, not a target to pad toward.

---

## 5. Code blocks

Any fenced block showing a signature, struct, macro, config fragment, or snippet from
the target must be **copied verbatim from the source**. Do not retype from memory, do
not tidy formatting, do not rename, do not elide except with a marked comment
(`/* ... */`) while keeping the surrounding lines exact.

The line immediately before the opening fence ends with a citation covering the
snippet. Written out, outer fence shown as tildes so the example nests:

~~~~
The replica handshake state is a plain enum on the client struct (src/server.h:1102-1115):

```c
typedef enum {
    REPL_STATE_NONE = 0,
    REPL_STATE_CONNECT,
    REPL_STATE_CONNECTING
} replState;
```
~~~~

Blocks holding your own pseudocode or illustrative usage are allowed but must be
introduced with the word `Illustrative` on the preceding line.

---

## 6. Diagrams

The document must contain **at least two mermaid diagrams** in fenced ` ```mermaid `
blocks:

- **Required:** a `stateDiagram-v2` in section 5 showing the subsystem's lifecycle or
  state machine. If the subsystem genuinely has no state machine, replace it with a
  `flowchart` of the object/ownership graph and justify the substitution in section 5.
- **Required:** a `flowchart` in section 6 that is a **call graph of the main entry
  path** — from the outermost public entry point down through the functions it calls,
  to the point where the work is done or handed off. Depth of at least 4 levels where
  the code allows.

Diagram rules:

- Permitted types: `flowchart`, `graph`, `sequenceDiagram`, `stateDiagram-v2`,
  `classDiagram`, `erDiagram`. Each block is rendered by a mermaid parser; a block that
  fails to parse scores zero for that check.
- Quote labels containing spaces, punctuation, parentheses, or slashes:
  `A["replicationCron() (src/replication.c)"]`.
- Immediately after each closing fence, add a legend list mapping every node id to a
  citation: `` - `A` — replicationCron (src/replication.c:3402) ``. For the call graph,
  each node is one function and the citation points at its **definition**.
- At most 20 nodes per diagram. If the real graph is larger, draw the spine and say so.

---

## 7. Required document skeleton

Use these exact H2 headings, in this order, spelled exactly as shown:

```
## 1. Scope and method
## 2. Responsibilities and boundaries
## 3. Type inventory
## 4. Function inventory
## 5. Lifecycle and state machine
## 6. Main entry path call graph
## 7. Concurrency and locking rules
## 8. Error paths and failure modes
## 9. Performance characteristics
## 10. Sharp edges
## 11. Open questions
```

**1. Scope and method** — the commit you read, the exact list of files you treat as the
subsystem (each path cited or listed as a path that exists), what you excluded and why,
and what you read versus sampled. 200-350 words.

**2. Responsibilities and boundaries** — what this subsystem owns, what it explicitly
does not own, who calls into it (with call-site citations), and what it calls out to.
Name the public entry points here; they are the surface everything else in the document
hangs from.

**3. Type inventory** — a table of every important type: `Type | Kind | Purpose |
Defined | Lifetime/ownership`, where `Defined` is a citation. "Important" means a type
whose layout or invariants a maintainer must understand; skip trivial aliases. For the
two or three central types, follow the table with a verbatim definition block and prose
on each non-obvious field, including which fields are mutable, who may mutate them, and
under what lock.

**4. Function inventory** — a table of every important function: `Function | Signature
location | Called by | Preconditions | Effects`. Every row cited. Then, for each public
entry point, a subsection with the verbatim signature, the parameter contract, the
return contract, and what it does in order. If the subsystem has more than 40 important
functions, table all of them and give subsections to the entry points plus the ten most
consequential internal functions, stating that selection rule in section 1.

**5. Lifecycle and state machine** — how instances are created, initialised, used,
reset, and destroyed; the states and the transitions, with the trigger and the guard on
each transition cited to the code that performs it. Required `stateDiagram-v2` here.
Explicitly list which transitions are impossible and what enforces that.

**6. Main entry path call graph** — the required `flowchart`, plus a numbered walk of
the same path in prose: each hop names the function, the file, and what it does, with a
citation per hop. Minimum 6 hops where the code allows.

**7. Concurrency and locking rules** — which threads, tasks, coroutines, or signal
contexts touch this subsystem; every lock, its scope, and its ordering relative to other
locks; what data is protected by what; what is thread-local; what is lock-free and why
that is safe; what is documented as single-threaded. Cite the lock acquisitions, not
just the lock declarations. If the subsystem is single-threaded, prove it: cite the
code or comments establishing the constraint rather than asserting it. State the lock
ordering as an explicit ordered list if more than one lock exists.

**8. Error paths and failure modes** — how errors are represented, how they propagate,
which failures are recoverable and which are fatal, what is cleaned up on each path, and
where resources can leak or state can be left inconsistent. Cite each error site. Call
out any path where an error is swallowed.

**9. Performance characteristics** — the complexity of the main operations, the
allocation behaviour, the hot loops, the syscall or I/O boundaries, the buffering and
batching, and any cache or memoisation. Base every statement on code you cite. Do not
report benchmark numbers: you cannot run the code, and invented numbers are the exact
failure this category detects. If a comment or a checked-in benchmark reports numbers,
you may quote it as a claim made by the repository, cited as such.

**10. Sharp edges** — the things that will bite a maintainer: implicit ordering
requirements, functions that must not be called from certain contexts, fields that look
safe to touch and are not, subtle aliasing, integer or overflow assumptions, error codes
that are reused for different meanings, TODO/FIXME/XXX comments that flag real hazards.
Minimum 5 entries, each cited. This section is what makes the document worth keeping
open.

**11. Open questions** — see section 9 of this prompt.

---

## 8. Workspace scripts

`run.sh` prints exactly these three lines to stdout and nothing else (diagnostics to
stderr):

```
document: SUBSYSTEM-{{SUBSYSTEM}}.md
words: <N>
citations: <N>
```

`words` is authoritative and must equal the `word_count` front-matter field: the number
of whitespace-separated tokens remaining after all fenced code blocks (mermaid included)
are removed. Compute it with exactly this program so your count agrees with the
scorer's:

```sh
python3 - "SUBSYSTEM-{{SUBSYSTEM}}.md" <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub(r'^```.*?^```', '', t, flags=re.S | re.M)
print(len(t.split()))
PY
```

`citations` is the number of matches of the regular expression in section 4 of this prompt, and must equal
`citation_count`.

`test.sh` runs the **category checker** first, then your own additional checks. The
checker is `docs-generation/check_docs.py` and the flags for this task are recorded in
`docs-generation/tasks/<task-id>/task.json` under `verify_args`. From the `markdown/`
working directory that is:

```sh
python3 ../../../../check_docs.py \
  --doc "SUBSYSTEM-{{SUBSYSTEM}}.md" \
  --checkout ../../../../targets/checkouts/{{TARGET}}/ \
  --min-words 2500 \
  --max-words 5000 \
  --min-mermaid 2 \
  --require-section "Scope and method" \
  --require-section "Responsibilities and boundaries" \
  --require-section "Type inventory" \
  --require-section "Function inventory" \
  --require-section "Lifecycle and state machine" \
  --require-section "Main entry path call graph" \
  --require-section "Concurrency and locking rules" \
  --require-section "Error paths and failure modes" \
  --require-section "Performance characteristics" \
  --require-section "Sharp edges" \
  --require-section "Open questions" \
  --json
```

It exits 0 when every hard check passes, 1 when one fails, 2 on a bad invocation. It
resolves every citation against the checkout, checks the required sections, the word
budget, and the mermaid blocks, and warns about path-looking tokens that do not exist.
Run it while you write, not once at the end.

`test.sh` then adds the checks the category checker does not cover. It exits non-zero,
naming the failed check, unless:

1. `SUBSYSTEM-{{SUBSYSTEM}}.md` exists and its front matter has all seven keys.
2. All eleven required H2 headings are present, in order.
3. `word_count` is in range and matches the computed count.
4. `citation_count` matches the computed count.
5. Every citation resolves against `{{TARGET_PATH}}` — path exists, lines in range.
6. At least two ` ```mermaid ` blocks exist, one `stateDiagram-v2` (or the justified
   `flowchart` substitute) and one `flowchart` call graph.
7. At least 20 citations across at least 6 distinct files, or section 1 states why the
   subsystem spans fewer files.

The scorer runs the same checker plus checks of its own. `test.sh` exists so you catch
your own errors first; weakening it gains you nothing.

---

## 9. Uncertainty is a first-class answer

If you cannot determine something from the code, **say so in Open questions**: the
question, what you looked at, and what evidence would settle it. For example:

> Whether `replicaof` may be invoked while a background save is in flight is not
> determinable from the code I read. The guard at (src/replication.c:2914-2921) rejects
> some overlapping states but I could not find the one that would cover this case, and
> the test suite does not appear to exercise it.

A document with a substantive Open questions section scores **higher** than one that
answers everything with some answers guessed. Inventing a plausible answer is the
specific failure this category exists to detect. Concurrency and error-path claims are
where invention is most tempting and most damaging: if you cannot see the lock
discipline, say you cannot see it.

An empty Open questions section on a non-trivial subsystem is itself a signal.

---

## 10. Length

**2500-5000 words**, by the definition in section 8 of this prompt. Outside that range costs the length
component outright. Do not pad: if you are short, sections 7, 8, and 10 are almost
certainly thin.

---

## 11. Scoring

Scored by `docs-generation/rubric.md`. Weights for this task:

| Axis | Weight |
|---|---|
| Citation validity (mechanical) | 15 |
| Required structure present (mechanical) | 8 |
| Mermaid blocks parse (mechanical) | 5 |
| Length in range (mechanical) | 5 |
| Path integrity — no fabricated paths or symbols (mechanical) | 7 |
| Accuracy (judged against the code) | 25 |
| Completeness relative to the real subsystem (judged) | 15 |
| Usefulness to a maintainer (judged) | 10 |
| Structure and readability (judged) | 5 |
| Honest treatment of uncertainty (judged) | 5 |

Hard gate: citation validity rate below 0.70 marks the document `unsupported` and caps
the total at 30/100.

---

## DEFINITION OF DONE

- [ ] Workspace exists at `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`.
- [ ] `SUBSYSTEM-{{SUBSYSTEM}}.md` exists there with the exact filename.
- [ ] Front matter has all seven keys, with `word_count` and `citation_count` matching
      the computed values.
- [ ] All eleven required H2 headings, spelled exactly, in order.
- [ ] Word count between 2500 and 5000 by the definition in section 8 of this prompt.
- [ ] A `stateDiagram-v2` (or justified substitute) in section 5 and a call-graph
      `flowchart` in section 6, both parsing, both followed by a node legend with
      citations to function definitions.
- [ ] Every citation matches `(path:LINE)` or `(path:START-END)`, relative to the
      checkout root.
- [ ] Every cited path exists and every line range is inside the file — verified by
      running `test.sh`.
- [ ] At least 20 citations across at least 6 distinct files, or an explicit
      justification in section 1.
- [ ] Every path and every symbol name mentioned in the document exists in the checkout.
- [ ] Every code block quoting the target is verbatim and preceded by a citation;
      non-source blocks are marked `Illustrative`.
- [ ] Type inventory and function inventory tables are complete for the boundary you
      declared, every row cited.
- [ ] Concurrency section states the lock ordering explicitly, or proves the subsystem
      is single-threaded with a citation.
- [ ] At least 5 sharp edges, each cited.
- [ ] No invented performance numbers; any quoted numbers attributed to a cited source.
- [ ] Open questions lists real unresolved questions.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, follow `CONVENTIONS.md`
      section 6; `run.sh` prints exactly the three lines; `test.sh` exits 0.
- [ ] `run.json` complete per `CONVENTIONS.md` section 5, `language: "markdown"`,
      honest `self_reported_status`.
- [ ] Nothing under `{{TARGET_PATH}}` was created, modified, or deleted.
