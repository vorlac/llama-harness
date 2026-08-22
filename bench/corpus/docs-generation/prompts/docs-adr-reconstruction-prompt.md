# Task: reconstruct the architecture decision records of {{TARGET}}

{{TARGET}} was built by people who made decisions and mostly did not write them down.
Your job is archaeology: infer those decisions from the code and its history, and write
them up as **5 to 8 architecture decision records** in standard ADR form.

This is the hardest task in the category, because the evidence is indirect and the
temptation to narrate is enormous. You are not scored on how well-formed your ADRs are —
formatting is cheap. You are scored on whether the decisions you identify are **real
decisions the project actually made**, whether you have **characterised them
correctly**, and whether the evidence you cite actually supports them. A beautifully
structured ADR describing a decision the project never made is the worst possible
output.

---

## 1. Variables

| Variable | Meaning |
|---|---|
| `{{TARGET}}` | Slug of the target repository, e.g. `sqlite` |
| `{{TARGET_PATH}}` | Checkout path: `docs-generation/targets/checkouts/{{TARGET}}/` |
| `{{RUN_ID}}` | Run identifier, e.g. `qwen3.6-27B__llama-harness` |
| `{{TASK_ID}}` | `{{TARGET}}-adr-reconstruction` |

Paths in this prompt are relative to the test-corpus repository root unless stated
otherwise.

---

## 2. Input

The target codebase is checked out at `{{TARGET_PATH}}`, **with its git history
intact**. History is a primary source for this task and you are expected to use it.

Permitted, read-only:

- `ls`, `find`, `grep`, `rg`, `cat`, `sed -n`, `wc`
- `git log`, `git log --follow`, `git log -S<string>`, `git log --diff-filter`,
  `git show`, `git blame`, `git diff <a> <b>`, `git tag -l`, `git shortlog`,
  `git rev-parse`, `git cat-file`

Forbidden:

- modifying, creating, deleting, or moving any file under `{{TARGET_PATH}}`
- building, compiling, installing, configuring, or running the target
- any `git` command that writes: `checkout`, `switch`, `pull`, `fetch`, `reset`,
  `clean`, `gc`, `commit`, `merge`, `rebase`, `stash`, `restore`
- network access

Useful history techniques, since this is where the task is won or lost:

- `git log --oneline --follow <file>` on a file that embodies a decision
- `git log -S'<symbol>' --oneline` to find when an approach appeared or disappeared
- `git log --diff-filter=D --name-only` to find what was removed — deletions are often
  where a decision was reversed
- `git show <commit>` on the commit that introduced the abstraction, to read the message
- `git blame` on a comment that explains why something is done the hard way
- reading `NEWS`, `CHANGELOG`, `docs/`, `RATIONALE`, design notes, and long code
  comments: an explicit rationale in the tree outranks any inference you make

If the checkout has no history (a shallow or exported tree), say so in the Method
section and work from code, comments, and documentation alone. Do not fabricate commit
references to fill the gap.

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
| `ADRS.md` | The deliverable. Exact, case-sensitive filename. All ADRs live in this one file. |
| `run.json` | Per `CONVENTIONS.md` section 5. `language` is `"markdown"`. |
| `build.sh` | No-op. `exit 0`. |
| `run.sh` | Prints the stdout summary in section 8. |
| `test.sh` | Self-check defined in section 8. |

Scripts follow `CONVENTIONS.md` section 6: `chmod +x`, `#!/usr/bin/env bash`,
`set -euo pipefail`, no network, run with `markdown/` as the working directory.

`ADRS.md` opens with this YAML front matter, values filled in:

```yaml
---
task_id: {{TASK_ID}}
target: {{TARGET}}
run_id: {{RUN_ID}}
document: ADRS.md
head_commit: 0000000
word_count: 0
citation_count: 0
adr_count: 0
---
```

`head_commit` is the short hash from `git rev-parse --short HEAD` in the checkout, or
the literal string `none` if the checkout has no history.

---

## 4. THE CITATION RULE

This is the core requirement of this category. Read it twice.

**Every non-obvious factual claim about the target must carry an inline citation.** Any
statement about what the code is, does, contains, enforces, assumes, guarantees, or once
did. General programming background needs no citation; anything specific to {{TARGET}}
does. In this task that includes every claim about history: when something changed, why
it changed, what it replaced.

### 4.1 Code citations

Exactly this form:

```
(path/to/file.c:LINE)
(path/to/file.c:START-END)
```

1. The path is relative to the **checkout root** — relative to `{{TARGET_PATH}}`. No
   `{{TARGET_PATH}}` prefix, no leading `./`, no leading `/`, no absolute paths.
   Forward slashes only.
2. Allowed path characters: `A-Z a-z 0-9 . _ + - /`. A file needing other characters is
   cited anyway and noted in **Open questions**.
3. `LINE`, `START`, `END` are 1-based decimal integers. `START <= END`. `END` must not
   exceed the file's line count at HEAD. Maximum span 60 lines.
4. One path per parenthesis; several citations are several parentheses separated by a
   space.
5. The citation sits in the same sentence, bullet, or table cell as the claim.

Parsed with:

```
\(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
```

### 4.2 Commit citations

Exactly one of these two forms:

```
(git:abc1234)
(git:abc1234 path/to/file.c)
```

1. The hash is 7 to 40 lowercase hexadecimal characters and must resolve in the
   checkout — the checker runs the equivalent of `git cat-file -e <hash>^{commit}`.
2. The optional path names the file the commit touched that you are pointing at; it must
   exist in that commit.
3. When you quote a commit message, quote it verbatim in a blockquote and cite it.

Parsed with:

```
\(git:([0-9a-f]{7,40})(?: ([A-Za-z0-9._+\-/]+))?\)
```

Do not invent a hash. A hash that does not resolve is scored as a fabrication, and
fabricated history is the single most damaging error available to you in this task.
If you cannot find a commit for a decision, cite the code and say in that ADR's Evidence
subsection that no commit-level evidence was found.

### 4.3 Requirements per ADR

Each ADR must carry:

- at least **3 code citations**, and
- at least **1 commit citation** *or* an explicit sentence in its Evidence subsection
  stating that no commit or comment evidence was found and why (shallow checkout,
  squashed import, pre-history code).

**No fabricated paths, symbols, or hashes.** Everything you name must exist in the
checkout.

---

## 5. Code blocks and quotations

Any block showing code from the target is **copied verbatim**, preceded on the line
above by a citation. Any block showing a commit message or a diff is copied verbatim
from `git show` output, preceded by a commit citation. Do not paraphrase a commit
message inside quotation marks.

Written out, outer fence shown as tildes so the example nests:

~~~~
The abstraction is a single function-pointer table, not a class hierarchy (src/vfs.h:88-97):

```c
struct sqlite3_vfs {
  int iVersion;
  int szOsFile;
  int mxPathname;
};
```

The commit that introduced it says (git:9c8f1a2):

> Introduce the VFS layer so the OS interface can be swapped at runtime
> without recompiling the core.
~~~~

Blocks holding your own pseudocode are allowed but must be introduced with the word
`Illustrative` on the preceding line.

---

## 6. Diagrams

At least **one mermaid diagram** in a fenced ` ```mermaid ` block, in the `## Decision
map` section: a `flowchart` or `graph` showing the ADRs as nodes and their relationships
as edges — which decision enabled, constrained, or superseded which. Node ids are ADR
numbers.

- Permitted types: `flowchart`, `graph`, `sequenceDiagram`, `stateDiagram-v2`,
  `classDiagram`, `erDiagram`. Each block is rendered by a mermaid parser; a block that
  fails to parse scores zero for that check.
- Quote labels containing spaces, punctuation, parentheses, or slashes.
- Immediately after the closing fence, a legend list mapping each node id to its ADR
  title. Edges must correspond to relationships actually asserted in the ADR bodies —
  no edge that the text does not support.
- At most 20 nodes.

---

## 7. Required document skeleton

Use these exact H2 headings. The `## ADR-000N: <title>` headings sit between
`## Decision map` and `## Rejected candidates`, numbered from 1 with no gaps.

```
## Method
## Decision map
## ADR-0001: <title>
## ADR-0002: <title>
...
## Rejected candidates
## Open questions
```

**Method** (250-450 words) — the head commit, whether history was available and how deep
it goes, the exact commands you used to mine it (in a `sh` block), how you decided what
counted as an architectural decision as opposed to an implementation detail, and what
parts of the system you did not examine. State your inclusion criterion explicitly: a
useful one is *a choice with system-wide consequences, where a different choice was
available at the time, and where the consequences are visible in the code today*.

**Decision map** — the required mermaid diagram and a short paragraph on how the
decisions relate.

**Each ADR** — H2 heading `## ADR-000N: <short imperative title>`, then exactly these
H3 subsections, in this order:

```
### Status
### Context
### Decision
### Consequences
### Evidence
```

- **Status** — one of `Accepted (inferred)`, `Superseded by ADR-000N (inferred)`,
  `Deprecated (inferred)`, or, when the tree states the status explicitly,
  `Accepted (stated)` with a citation to where it is stated. Every reconstructed status
  carries `(inferred)`; that word is the honesty marker for this task and its absence on
  an inferred status is scored as overclaiming. Add the approximate date or release
  where history supports it, cited.
- **Context** — the situation and forces at the time the decision was made: what the
  constraints were, what problem was pressing, what alternatives were plausible. This is
  where invention is most tempting. Every force you assert must be evidenced by code, a
  comment, a commit message, a changelog entry, or a document in the tree. If you are
  reasoning rather than reporting, write "Inferred:" at the start of the sentence.
- **Decision** — one or two sentences stating what was decided, in the active voice and
  in the past tense, as the project would have written it. Then what it concretely
  means in the code.
- **Consequences** — both directions. What this bought: capabilities, simplifications,
  performance. What it cost: the constraints it imposes today, the workarounds visible
  in the code, the things that are now hard. At least two of each, each cited. The cost
  side is where a real reconstruction separates from a plausible one, because costs
  leave marks: special cases, compatibility shims, comments apologising for something.
- **Evidence** — a bulleted list of the specific evidence, each item a citation plus one
  line saying what it shows. Separate `Code:` items from `History:` items. State
  plainly how strong the evidence is: whether the decision is documented, strongly
  implied, or inferred from structure alone.

**Rejected candidates** — 2 or more decisions you considered writing up and did not,
each with one line on why the evidence was too thin. This section is scored: it shows
you distinguished evidenced decisions from plausible ones rather than promoting
everything you noticed.

**Open questions** — see section 9.

---

## 8. Workspace scripts

`run.sh` prints exactly these four lines to stdout and nothing else (diagnostics to
stderr):

```
document: ADRS.md
words: <N>
citations: <N>
adrs: <N>
```

`citations` counts both citation forms — the regex in section 4.1 of this prompt plus the one in
section 4.2 — and must equal `citation_count`. `adrs` is the number of `## ADR-` headings and
must equal `adr_count`, which must be between 5 and 8.

`words` is authoritative and must equal `word_count`: whitespace-separated tokens
remaining after all fenced code blocks are removed. Compute it with exactly this program
so your count agrees with the scorer's:

```sh
python3 - ADRS.md <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub(r'^```.*?^```', '', t, flags=re.S | re.M)
print(len(t.split()))
PY
```

`test.sh` runs the **category checker** first, then your own additional checks. The
checker is `docs-generation/check_docs.py` and the flags for this task are recorded in
`docs-generation/tasks/<task-id>/task.json` under `verify_args`. From the `markdown/`
working directory that is:

```sh
python3 ../../../../check_docs.py \
  --doc ADRS.md \
  --checkout ../../../../targets/checkouts/{{TARGET}}/ \
  --min-words 2500 \
  --max-words 4500 \
  --min-mermaid 1 \
  --require-section "Method" \
  --require-section "Decision map" \
  --require-section "ADR-0001" \
  --require-section "ADR-0002" \
  --require-section "ADR-0003" \
  --require-section "ADR-0004" \
  --require-section "ADR-0005" \
  --require-section "Rejected candidates" \
  --require-section "Open questions" \
  --json
```

It exits 0 when every hard check passes, 1 when one fails, 2 on a bad invocation. It
resolves every citation against the checkout, checks the required sections, the word
budget, and the mermaid blocks, and warns about path-looking tokens that do not exist.
Run it while you write, not once at the end.

`test.sh` then adds the checks the category checker does not cover. It exits non-zero,
naming the failed check, unless:

1. `ADRS.md` exists; front matter has all eight keys; `head_commit` matches
   `git rev-parse --short HEAD` in the checkout, or is `none`.
2. `## Method`, `## Decision map`, `## Rejected candidates`, `## Open questions` are all
   present, in that relative order, with the ADR headings between the second and third.
3. `adr_count` is between 5 and 8, matches the number of `## ADR-` headings, and the
   numbering runs 0001..000N with no gaps.
4. Every ADR has all five required H3 subsections, in order.
5. Every ADR has at least 3 valid code citations and either a valid commit citation or
   an Evidence line stating none was found.
6. Every code citation resolves against `{{TARGET_PATH}}`; every commit citation
   resolves as a commit in the checkout.
7. `word_count` is in range and matches; `citation_count` matches.
8. At least one ` ```mermaid ` block is present.

The scorer runs the same checker plus checks of its own; `test.sh` exists so you catch
your own errors first.

---

## 9. Uncertainty is a first-class answer

The whole task is inference, so mark the boundary between what you read and what you
concluded. Two mechanisms, both required:

1. Prefix inferential sentences inside **Context** and **Consequences** with
   `Inferred:`.
2. Put everything you could not settle in **Open questions**, with the question, what
   you looked at, and what would settle it. For example:

> Whether the single-writer design was chosen for durability or simply inherited from
> the original prototype is not determinable. The lock is enforced at
> (src/pager.c:1902-1917) and the earliest commit touching it (git:4be21d0) has an
> import-sized diff with the message "initial import", so there is no decision record
> behind it. A maintainer interview would settle it.

Five well-evidenced ADRs plus an honest Open questions section score **higher** than
eight ADRs where three are narrative. If you can only evidence five, write five. If you
cannot evidence five, write what you can, and say so in Method — an underfull document
that is true beats a full one that is partly invented.

---

## 10. Length

**2500-4500 words**, by the definition in section 8 of this prompt. Outside that range costs the length
component outright. Roughly 300-600 words per ADR plus the framing sections. Do not pad
Context with general background about the problem domain; it reads as filler and is
scored as such.

---

## 11. Scoring

Scored by `docs-generation/rubric.md`. Weights for this task, which deliberately push
weight away from form and toward whether the decisions are real:

| Axis | Weight |
|---|---|
| Citation validity, code and commit (mechanical) | 15 |
| Required structure present (mechanical) | 5 |
| Mermaid block parses (mechanical) | 3 |
| Length in range (mechanical) | 5 |
| Path, symbol, and hash integrity — nothing fabricated (mechanical) | 12 |
| Decision reality and characterisation (judged) | 30 |
| Completeness — the decisions that most shape the codebase are present (judged) | 12 |
| Usefulness to a maintainer inheriting the system (judged) | 8 |
| Structure and readability (judged) | 3 |
| Honest treatment of uncertainty (judged) | 7 |

"Decision reality and characterisation" replaces the standard accuracy axis: a judge
with the checkout decides, per ADR, whether the decision was actually made, whether it
is described as the project would recognise it, and whether the cited evidence supports
it. An ADR judged invented scores zero for that ADR and drags the axis down; it is
strictly better not to have written it.

Hard gate: citation validity rate below 0.70, or any unresolvable commit hash, marks the
document `unsupported` and caps the total at 30/100.

---

## DEFINITION OF DONE

- [ ] Workspace exists at `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`.
- [ ] `ADRS.md` exists there with the exact filename.
- [ ] Front matter has all eight keys; `head_commit` matches the checkout (or is
      `none`); `word_count`, `citation_count`, `adr_count` match the computed values.
- [ ] Between 5 and 8 ADRs, numbered `ADR-0001` upward with no gaps.
- [ ] `## Method`, `## Decision map`, the ADRs, `## Rejected candidates`,
      `## Open questions` all present, in that order.
- [ ] Method states the head commit, history depth, the mining commands actually run,
      and the inclusion criterion.
- [ ] Every ADR has `### Status`, `### Context`, `### Decision`, `### Consequences`,
      `### Evidence`, in that order.
- [ ] Every inferred status carries the word `(inferred)`.
- [ ] Every ADR has at least 3 code citations and at least 1 commit citation, or an
      explicit Evidence statement that no commit or comment evidence exists.
- [ ] Every Consequences subsection gives at least two benefits and at least two costs,
      each cited.
- [ ] Every inferential sentence in Context and Consequences is prefixed `Inferred:`.
- [ ] Every commit hash resolves in the checkout — verified by running `test.sh`, not by
      inspection.
- [ ] Every code citation resolves: path exists, lines in range at HEAD.
- [ ] Every quoted commit message is verbatim from `git show` and cited.
- [ ] One ` ```mermaid ` decision map that parses, with a legend, and no edge the ADR
      text does not support.
- [ ] At least 2 rejected candidates, each with a reason.
- [ ] Open questions lists the decisions and rationales you could not settle.
- [ ] Word count between 2500 and 4500 by the definition in section 8 of this prompt.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, follow `CONVENTIONS.md`
      section 6; `run.sh` prints exactly the four lines; `test.sh` exits 0.
- [ ] `run.json` complete per `CONVENTIONS.md` section 5, `language: "markdown"`,
      honest `self_reported_status`.
- [ ] Nothing under `{{TARGET_PATH}}` was created, modified, or deleted; no write-mode
      git command was run; the target was never built or run.
