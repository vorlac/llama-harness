# Task: architecture overview of {{TARGET}}

You are documenting a codebase you did not write. Produce an architecture overview
that a competent engineer joining the project could trust as their mental model of
the system.

The thing being measured here is **accuracy**, not fluency. A well-written document
that describes a system slightly different from the one in the checkout scores worse
than a plainer document whose every claim is anchored to a line of code. Assume a
reviewer will open every file you cite.

---

## 1. Variables

The harness substitutes these before handing you this prompt. Wherever they appear
below, they are already resolved.

| Variable | Meaning |
|---|---|
| `{{TARGET}}` | Slug of the target repository, e.g. `redis` |
| `{{TARGET_PATH}}` | Checkout path: `docs-generation/targets/checkouts/{{TARGET}}/` |
| `{{RUN_ID}}` | Run identifier, e.g. `qwen3.6-27B__llama-harness` |
| `{{TASK_ID}}` | `{{TARGET}}-architecture-overview` |

All paths in this prompt are relative to the repository root of the test corpus
unless stated otherwise.

---

## 2. Input

The target codebase is checked out at `{{TARGET_PATH}}`.

**The checkout is READ-ONLY.** You may read any file in it and run read-only
inspection commands (`ls`, `find`, `grep`, `rg`, `cat`, `sed -n`, `wc`, `git log`,
`git show`, `git blame`). You must **not**:

- modify, create, delete, or move any file under `{{TARGET_PATH}}`
- build, compile, install, configure, or run the target
- run any `git` command that writes (`checkout`, `switch`, `pull`, `fetch`, `reset`,
  `clean`, `gc`, `commit`, `stash`)
- access the network

If you believe a claim can only be settled by building or running the code, do not
build or run it — put the claim in **Open questions** instead.

---

## 3. Output

Create your workspace exactly as described in `CONVENTIONS.md` section 4. For this
category the `<language>` slot holds the **output format**:

```sh
tools/new_workspace.sh {{RUN_ID}} {{TASK_ID}} markdown
```

Workspace root: `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`

Write these files into it:

| File | Contents |
|---|---|
| `ARCHITECTURE.md` | The deliverable. Filename is exact and case-sensitive. |
| `run.json` | Per `CONVENTIONS.md` section 5. `language` is `"markdown"`. |
| `build.sh` | No-op. `exit 0`. |
| `run.sh` | Prints the stdout summary defined in section 8 below. |
| `test.sh` | Self-check defined in section 8 below. |

`build.sh`, `run.sh`, and `test.sh` follow the contract in `CONVENTIONS.md`
section 6: `chmod +x`, `#!/usr/bin/env bash`, `set -euo pipefail`, no network,
invoked with the `markdown/` directory as the working directory.

`ARCHITECTURE.md` opens with this YAML front matter, filled in with real values:

```yaml
---
task_id: {{TASK_ID}}
target: {{TARGET}}
run_id: {{RUN_ID}}
document: ARCHITECTURE.md
word_count: 0
citation_count: 0
---
```

---

## 4. THE CITATION RULE

This is the core requirement of this category. Read it twice.

**Every non-obvious factual claim about the target must carry an inline citation.**
A non-obvious factual claim is any statement about what the code is, does, contains,
enforces, assumes, or guarantees. General programming background ("a hash table gives
amortised O(1) lookup") needs no citation. Anything specific to {{TARGET}} does.

A citation is a parenthesised path-and-line reference in **exactly** this form:

```
(path/to/file.c:LINE)
(path/to/file.c:START-END)
```

Rules the mechanical checker enforces:

1. The path is relative to the **checkout root** — i.e. relative to `{{TARGET_PATH}}`.
   Never include `{{TARGET_PATH}}` itself, never a leading `./`, never a leading `/`,
   never an absolute path. Forward slashes only.
2. Allowed path characters: `A-Z a-z 0-9 . _ + - /`. If a file you need to cite
   contains any other character, cite it anyway and note the problem in
   **Open questions**.
3. `LINE`, `START`, `END` are 1-based decimal integers. `START <= END`. `END` must not
   exceed the number of lines in the file. A range must span at most 60 lines; cite
   several tighter ranges instead of one loose one.
4. One path per parenthesis. To cite several places, write several parentheses
   separated by a space: `(src/a.c:12) (src/b.c:40-58)`.
5. The citation appears in the same sentence, bullet, or table cell as the claim it
   supports.

The checker parses citations with this regular expression:

```
\(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
```

It then verifies that the path exists under the checkout and that the line numbers are
in range. Two derived metrics are reported: **citation validity rate** (valid
citations / total citations) and **unsupported claim rate** (behavioural claims with no
citation, judged). Both are scored. See `docs-generation/rubric.md`.

**No fabricated paths.** Every file or directory path you mention *anywhere* in the
document — in prose, in tables, in commands, in diagrams — must exist in the checkout.
A path that does not exist is treated as a fabrication and is the single most damaging
error you can make in this category.

---

## 5. Code blocks

Any fenced code block showing a signature, a struct, a config fragment, or a snippet
from the target must be **copied verbatim from the source**. Do not retype from memory,
do not tidy the formatting, do not rename anything, do not elide with `...` unless the
elision is marked `/* ... */` or the language's comment equivalent and the surrounding
lines are exact.

The line immediately **before** the opening fence must end with a citation covering the
snippet. Written out, with the outer fence shown as tildes only so the example nests:

~~~~
The event loop's per-iteration hook is installed here (src/ae.c:70-74):

```c
void aeSetBeforeSleepProc(aeEventLoop *eventLoop, aeBeforeSleepProc *beforesleep) {
    eventLoop->beforesleep = beforesleep;
}
```
~~~~

Blocks that contain your own pseudocode or illustrative shell usage are allowed, but
must be introduced with the word `Illustrative` on the preceding line so a reader does
not mistake them for source.

---

## 6. Diagrams

The document must contain **at least two mermaid diagrams**, in fenced blocks tagged
` ```mermaid `:

- at least one **component/structure** diagram in section 3 (`flowchart` or `graph`)
- at least one **flow** diagram in section 4 (`sequenceDiagram` or `flowchart`)

Diagram rules:

- Use only these diagram types: `flowchart`, `graph`, `sequenceDiagram`,
  `stateDiagram-v2`, `classDiagram`, `erDiagram`. The checker renders each block with a
  mermaid parser; a block that fails to parse scores zero for that check.
- Quote any node label containing spaces, punctuation, parentheses, or slashes:
  `A["command table (server.c)"]`.
- Every node that represents a real code element must be traceable: immediately after
  the closing fence, add a **legend list** mapping each node id to a citation, e.g.
  `- \`A\` — command dispatch table (src/server.c:3423-3512)`.
- No more than 20 nodes per diagram. If the system is larger, draw the top level and say
  so.

---

## 7. Required document skeleton

Use these exact H2 headings, in this order, spelled exactly as shown. Sub-headings are
yours to choose.

```
## 1. Scope and method
## 2. System context
## 3. Component map
## 4. Data and control flow
## 5. Key invariants
## 6. Build, packaging, and deployment shape
## 7. Formative design decisions
## 8. Open questions
```

What each section must contain:

**1. Scope and method** — the commit or tag you read (`git rev-parse HEAD` output is
fine), what you read and what you deliberately did not read, and how you decided what
counted as a major component. Roughly 150-300 words. Be honest about coverage: "I read
the networking and storage layers in depth and sampled the test suite" is a better
answer than an implied claim of totality.

**2. System context** — what the system is for, who or what talks to it, what it talks
to, and its external interfaces (protocols, ports, file formats, APIs). Every external
interface gets a citation to where it is defined or served.

**3. Component map** — a table of the major components, and the required structure
diagram. The table has these columns: `Component | Responsibility | Primary source |
Entry point`. `Primary source` is a directory or file path; `Entry point` is a function
or symbol with a citation. Between 5 and 15 components. A component earns its place by
owning a distinct responsibility, not by being a large directory.

**4. Data and control flow** — trace how a representative unit of work moves through the
system from ingress to result, and the required flow diagram. Name the representative
unit explicitly (a request, a message, a build step, a frame — whatever this system's
unit is) and cite each hop.

**5. Key invariants** — 4 to 8 invariants: properties the code assumes and maintains.
For each: state the invariant, cite where it is established or enforced, and state what
breaks if it is violated. Prefer invariants you can see enforced (an assertion, a
guard, a lock discipline, an ordering requirement in a comment) over invariants you
merely infer. Mark inferred ones as inferred.

**6. Build, packaging, and deployment shape** — build system, produced artifacts,
dependency handling, test entry points, and how the thing is meant to be shipped or
run. Cite the build files, CI configuration, packaging manifests, and container or
service definitions. You are not building the project; describe what the build files
say.

**7. Formative design decisions** — the two or three decisions that most shape the
codebase: the ones where a different choice would have produced a visibly different
repository. For each: the decision, the evidence (code, comments, commit messages,
documentation), what it buys, and what it costs. Depth beats breadth here; three
well-evidenced decisions beat eight assertions.

**8. Open questions** — everything you could not determine from the code. See section 9.

---

## 8. Workspace scripts

`run.sh` prints exactly three lines to stdout, in this order, and nothing else on
stdout (diagnostics go to stderr):

```
document: ARCHITECTURE.md
words: <N>
citations: <N>
```

`words` is the authoritative word count and must match the `word_count` front-matter
field. It is defined as the number of whitespace-separated tokens remaining after all
fenced code blocks (including mermaid blocks) are removed. Compute it with exactly this
program so your count agrees with the scorer's:

```sh
python3 - ARCHITECTURE.md <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub(r'^```.*?^```', '', t, flags=re.S | re.M)
print(len(t.split()))
PY
```

`citations` is the number of matches of the citation regular expression in section 4,
and must match the `citation_count` front-matter field.

`test.sh` runs the **category checker** first, then your own additional checks. The
checker is `docs-generation/check_docs.py` and the flags for this task are recorded in
`docs-generation/tasks/<task-id>/task.json` under `verify_args`. From the `markdown/`
working directory that is:

```sh
python3 ../../../../check_docs.py \
  --doc ARCHITECTURE.md \
  --checkout ../../../../targets/checkouts/{{TARGET}}/ \
  --min-words 2000 \
  --max-words 4000 \
  --min-mermaid 2 \
  --require-section "Scope and method" \
  --require-section "System context" \
  --require-section "Component map" \
  --require-section "Data and control flow" \
  --require-section "Key invariants" \
  --require-section "Build, packaging, and deployment shape" \
  --require-section "Formative design decisions" \
  --require-section "Open questions" \
  --json
```

It exits 0 when every hard check passes, 1 when one fails, 2 on a bad invocation. It
resolves every citation against the checkout, checks the required sections, the word
budget, and the mermaid blocks, and warns about path-looking tokens that do not exist.
Run it while you write, not once at the end.

`test.sh` then adds the checks the category checker does not cover. It exits non-zero,
naming the failed check, unless:

1. `ARCHITECTURE.md` exists and its front matter contains all six keys.
2. All eight required H2 headings are present, in order.
3. `word_count` is within the target range and matches the computed count.
4. `citation_count` matches the computed count.
5. Every citation resolves: the path exists under `{{TARGET_PATH}}` and the line
   numbers are within the file.
6. At least two ` ```mermaid ` blocks are present.

The scorer runs the same checker plus checks of its own; `test.sh` exists so you catch
your own errors before declaring done. Weakening `test.sh` gains you nothing.

---

## 9. Uncertainty is a first-class answer

If you cannot determine something from the code, **say so in Open questions**. Give the
question, what you looked at, and what evidence would settle it. For example:

> Whether the replication backlog is trimmed on a timer or only on write is not
> determinable from the code I read; the trim call site (src/replication.c:412) is
> reachable from both paths and I could not establish which dominates in practice.
> Settling this needs a run under load, which this task does not permit.

A document with a substantive Open questions section scores **higher** than one that
answers everything, when some of those answers are guesses. Inventing a plausible answer
is the specific failure this category exists to detect. Do not do it.

An empty or perfunctory Open questions section on a large unfamiliar codebase is itself
a signal — it is very unlikely you resolved everything.

---

## 10. Length

**2000-4000 words**, by the definition in section 8 of this prompt. Outside that range costs you the
length component of the score outright. Do not pad to reach the floor: if you are short,
you have under-documented something in sections 4, 5, or 7.

---

## 11. Scoring

You are scored by `docs-generation/rubric.md`. Summary of the weights that apply to this
task:

| Axis | Weight |
|---|---|
| Citation validity (mechanical) | 15 |
| Required structure present (mechanical) | 8 |
| Mermaid blocks parse (mechanical) | 5 |
| Length in range (mechanical) | 5 |
| Path integrity — no fabricated paths (mechanical) | 7 |
| Accuracy (judged against the code) | 25 |
| Completeness relative to the real system (judged) | 15 |
| Usefulness to a new engineer (judged) | 10 |
| Structure and readability (judged) | 5 |
| Honest treatment of uncertainty (judged) | 5 |

Hard gate: if the citation validity rate is below 0.70 the document is marked
`unsupported` and the total is capped at 30/100 regardless of quality.

---

## DEFINITION OF DONE

Verify each of these yourself before you declare the task complete.

- [ ] Workspace exists at `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`.
- [ ] `ARCHITECTURE.md` exists there, with the exact filename.
- [ ] Front matter present with all six keys, values filled in, `word_count` and
      `citation_count` matching the computed values.
- [ ] All eight required H2 headings present, spelled exactly, in order.
- [ ] Word count is between 2000 and 4000 by the definition in section 8 of this prompt.
- [ ] At least two ` ```mermaid ` blocks, each parsing, each followed by a node legend
      with citations.
- [ ] Every citation matches the exact form `(path:LINE)` or `(path:START-END)`,
      relative to the checkout root.
- [ ] Every cited path exists and every cited line range is inside the file — verified
      by running `test.sh`, not by inspection.
- [ ] Every path mentioned anywhere in the document exists in the checkout.
- [ ] Every code block quoting the target is verbatim and preceded by a citation;
      every non-source block is marked `Illustrative`.
- [ ] Component table has 5-15 rows, each with an entry point and citation.
- [ ] 4-8 invariants, each with enforcement site and consequence-of-violation.
- [ ] 2-3 formative design decisions, each with evidence.
- [ ] Open questions section lists real unresolved questions, or explains why there are
      none.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, and follow
      `CONVENTIONS.md` section 6.
- [ ] `run.sh` prints exactly the three stdout lines from section 8.
- [ ] `test.sh` exits 0.
- [ ] `run.json` is complete per `CONVENTIONS.md` section 5, with `language: "markdown"`
      and an honest `self_reported_status`.
- [ ] Nothing under `{{TARGET_PATH}}` was created, modified, or deleted.
