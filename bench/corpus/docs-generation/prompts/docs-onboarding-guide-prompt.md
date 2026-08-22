# Task: onboarding guide for {{TARGET}}

Write the document a new contributor to {{TARGET}} needs in their first week: how to
build it, how to test it, how the repository is laid out, what the daily edit-run-debug
loop looks like, how one real operation flows end to end through the code, what
conventions the project enforces, and where the landmines are.

This guide will be validated by someone following it **literally**, on a clean machine,
without improvising. A command that is almost right — the wrong target name, a flag the
Makefile does not accept, a directory that does not exist — fails at that step and the
guide fails with it. Precision beats coverage.

---

## 1. Variables

| Variable | Meaning |
|---|---|
| `{{TARGET}}` | Slug of the target repository, e.g. `postgres` |
| `{{TARGET_PATH}}` | Checkout path: `docs-generation/targets/checkouts/{{TARGET}}/` |
| `{{RUN_ID}}` | Run identifier, e.g. `qwen3.6-27B__llama-harness` |
| `{{TASK_ID}}` | `{{TARGET}}-onboarding-guide` |

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

This is the central tension of this task: **you must write exact build and test
commands without ever running them.** Therefore derive every command from a file in the
tree that specifies it — the CI workflow, the Makefile, `CMakeLists.txt`, `package.json`
scripts, `tox.ini`, `Dockerfile`, `CONTRIBUTING.md`, the developer docs — and cite that
file. A command sourced from CI configuration is evidence; a command recalled from
experience with similar projects is a guess, and guesses are what this category is built
to catch. Where you must state a command that no file in the tree specifies, mark it
`unverified` inline and list it in **Open questions**.

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
| `ONBOARDING.md` | The deliverable. Exact, case-sensitive filename. |
| `run.json` | Per `CONVENTIONS.md` section 5. `language` is `"markdown"`. |
| `build.sh` | No-op. `exit 0`. |
| `run.sh` | Prints the stdout summary in section 8. |
| `test.sh` | Self-check defined in section 8. |

Scripts follow `CONVENTIONS.md` section 6: `chmod +x`, `#!/usr/bin/env bash`,
`set -euo pipefail`, no network, run with `markdown/` as the working directory. These
scripts operate on your document; they must never invoke the target's build.

`ONBOARDING.md` opens with this YAML front matter, values filled in:

```yaml
---
task_id: {{TASK_ID}}
target: {{TARGET}}
run_id: {{RUN_ID}}
document: ONBOARDING.md
word_count: 0
citation_count: 0
trace_hops: 0
---
```

---

## 4. THE CITATION RULE

This is the core requirement of this category. Read it twice.

**Every non-obvious factual claim about the target must carry an inline citation.** Any
statement about what the code is, does, contains, requires, enforces, or guarantees.
General programming background needs no citation; anything specific to {{TARGET}} does.
**Every command you tell the reader to run must carry a citation to the file that
specifies it**, or be marked `unverified`.

A citation is a parenthesised path-and-line reference in **exactly** this form:

```
(path/to/file.mk:LINE)
(path/to/file.mk:START-END)
```

Rules the mechanical checker enforces:

1. The path is relative to the **checkout root** — relative to `{{TARGET_PATH}}`. No
   `{{TARGET_PATH}}` prefix, no leading `./`, no leading `/`, no absolute paths.
   Forward slashes only.
2. Allowed path characters: `A-Z a-z 0-9 . _ + - /`. A file needing other characters is
   cited anyway and noted in **Open questions**.
3. `LINE`, `START`, `END` are 1-based decimal integers. `START <= END`. `END` must not
   exceed the file's line count. Maximum span 60 lines.
4. One path per parenthesis; several citations are several parentheses separated by a
   space.
5. The citation sits in the same sentence, bullet, table cell, or command-introducing
   line as the claim.

Parsed with:

```
\(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
```

**No fabricated paths.** Every path mentioned anywhere in the document — prose, tables,
commands, the repository map, the trace — must exist in the checkout. The repository map
is the most common place to invent a directory that sounds right; check every row.

---

## 5. Commands

Every command the reader is told to run appears in a fenced ` ```sh ` block, exactly as
it should be typed. Rules:

- One logical step per block. Do not concatenate a build and a test into one block.
- No placeholders except explicitly angle-bracketed ones (`<your-branch>`), and every
  placeholder is explained on the line immediately below the block.
- No invented flags. If you cannot see the flag in a build file, a script, a CI job, or
  the tool's own vendored documentation, do not use it.
- State the working directory before the first command of each section, and whenever it
  changes.
- The line immediately above each block cites the file the command comes from, or ends
  with the literal word `unverified`.
- Where a command's expected output matters (a version string, a test summary line),
  state what the reader should see, and cite where that expectation comes from.

Every block quoting the target's source — a config snippet, a struct, a function — is
copied **verbatim**, not paraphrased, and is preceded by a citation. Written out, outer
fence shown as tildes so the example nests:

~~~~
The debug build is what CI uses (.github/workflows/ci.yml:31-34):

```sh
make -j"$(nproc)" DEBUG=1
```
~~~~

---

## 6. Diagrams

At least **one mermaid diagram** in a fenced ` ```mermaid ` block: a `flowchart` or
`sequenceDiagram` of the worked trace in section 7, one node per hop, in the same order
as the prose hops.

- Permitted types: `flowchart`, `graph`, `sequenceDiagram`, `stateDiagram-v2`,
  `classDiagram`, `erDiagram`. Each block is rendered by a mermaid parser; a block that
  fails to parse scores zero for that check.
- Quote labels containing spaces, punctuation, parentheses, or slashes.
- Immediately after the closing fence, add a legend list mapping every node id to a
  citation.
- At most 20 nodes.

---

## 7. Required document skeleton

Use these exact H2 headings, in this order, spelled exactly as shown:

```
## 1. What this project is
## 2. Prerequisites
## 3. Build it
## 4. Test it
## 5. Repository map
## 6. The daily loop
## 7. Worked trace
## 8. Conventions
## 9. Landmines
## 10. First tasks
## 11. Open questions
```

**1. What this project is** — 150-250 words: what it does, what problem it solves, what
language and runtime, what it is not. Enough for the reader to orient; no history
lesson.

**2. Prerequisites** — exact tools and exact version constraints: compiler, runtime,
build tool, package manager, system libraries, container runtime. Every version bound
cited to where it is declared (CI matrix, `pyproject.toml`, `go.mod`, `rust-toolchain`,
`configure.ac`, `package.json` `engines`). Where the project supports several
platforms, say which one the rest of the guide assumes and stick to it.

**3. Build it** — the shortest correct path from a fresh checkout to a built artifact,
as an ordered sequence of `sh` blocks, each cited. Say what gets produced and where it
lands. Then a table of the build variants that matter (debug, release, sanitiser,
with/without optional features) with the command for each, cited. Note the expected
first-build duration only if the tree states it.

**4. Test it** — how to run the full suite, how to run one test file, how to run one
test case, and how to see what failed. Each as a cited `sh` block. State roughly how
long the suite takes only if the tree states it. Name any test category that requires
extra setup (network, database, root, a specific platform) and how it is skipped.

**5. Repository map** — a table: `Path | What lives here | Read this first`. Cover every
top-level directory and the significant second-level ones. Every path must exist —
verify each one. `Read this first` names one concrete file worth opening, with a
citation. 10-25 rows.

**6. The daily loop** — the actual edit-build-test-debug cycle: the fastest incremental
build, how to run just the affected tests, how to attach a debugger or turn on debug
logging, how to format and lint before committing. Each step a cited command. This
section is the difference between a guide and a README rewrite; get the fast paths
right.

**7. Worked trace** — **one fully-worked end-to-end trace** of a single concrete
operation through the code: name the operation precisely ("a `GET /healthz` request",
"`SELECT 1` from parse to result", "a single frame render", "`make install` from
invocation to installed file"). Requirements:

- Numbered hops, minimum **8**, formatted as `### Hop N — <function or stage>`.
- Every hop cites the code that performs it, using the citation form in section 4 of this prompt.
- Every hop names the file, the function, and what is transformed or decided there.
- The chain must actually connect: each hop's function must be reachable from the
  previous hop's cited lines. Do not skip from ingress to result with "the request is
  then processed".
- Set `trace_hops` in the front matter to the number of hops.
- The mermaid diagram required by section 6 of this prompt mirrors these hops.

This is the section that most separates a document written from the code from one
written from a general sense of how such systems work.

**8. Conventions** — code style and where it is enforced (formatter config, linter
config, pre-commit hooks, CI checks), naming conventions, error-handling conventions,
test-naming and test-placement conventions, commit message rules, branch and PR rules,
review requirements, changelog or release-note obligations. All cited to
`CONTRIBUTING.md`, config files, or CI. If the project states none, say so rather than
importing conventions from elsewhere.

**9. Landmines** — 5 or more concrete traps, each cited: build steps that must be rerun
after certain edits, generated files that must not be edited by hand, tests that are
flaky or environment-dependent, platform-specific breakage, a directory that looks
current and is dead, an API with two similarly named entry points where one is
deprecated. A landmine is specific and evidenced; "the codebase is complex" is not one.

**10. First tasks** — 2-3 concrete starter changes a newcomer could actually make in
week one, each naming the files to touch (cited), the tests to run, and what "done"
would look like. Pick from real signals in the tree: open `TODO`/`FIXME` comments,
skipped tests, a missing case in a switch, a documented-but-unimplemented option.

**11. Open questions** — see section 9 of this prompt.

---

## 8. Workspace scripts

`run.sh` prints exactly these four lines to stdout and nothing else (diagnostics to
stderr):

```
document: ONBOARDING.md
words: <N>
citations: <N>
trace_hops: <N>
```

`words` is authoritative and must equal `word_count`: whitespace-separated tokens
remaining after all fenced code blocks are removed. Compute it with exactly this program
so your count agrees with the scorer's:

```sh
python3 - ONBOARDING.md <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub(r'^```.*?^```', '', t, flags=re.S | re.M)
print(len(t.split()))
PY
```

`citations` is the number of matches of the regular expression in section 4 of this prompt and must equal
`citation_count`. `trace_hops` is the number of `### Hop N —` headings and must equal
the front-matter field.

`test.sh` runs the **category checker** first, then your own additional checks. The
checker is `docs-generation/check_docs.py` and the flags for this task are recorded in
`docs-generation/tasks/<task-id>/task.json` under `verify_args`. From the `markdown/`
working directory that is:

```sh
python3 ../../../../check_docs.py \
  --doc ONBOARDING.md \
  --checkout ../../../../targets/checkouts/{{TARGET}}/ \
  --min-words 2000 \
  --max-words 4000 \
  --min-mermaid 1 \
  --require-section "What this project is" \
  --require-section "Prerequisites" \
  --require-section "Build it" \
  --require-section "Test it" \
  --require-section "Repository map" \
  --require-section "The daily loop" \
  --require-section "Worked trace" \
  --require-section "Conventions" \
  --require-section "Landmines" \
  --require-section "First tasks" \
  --require-section "Open questions" \
  --json
```

It exits 0 when every hard check passes, 1 when one fails, 2 on a bad invocation. It
resolves every citation against the checkout, checks the required sections, the word
budget, and the mermaid blocks, and warns about path-looking tokens that do not exist.
Run it while you write, not once at the end.

`test.sh` then adds the checks the category checker does not cover. It exits non-zero,
naming the failed check, unless:

1. `ONBOARDING.md` exists; front matter has all seven keys.
2. All eleven required H2 headings are present, in order.
3. `word_count` is in range and matches the computed count; `citation_count` matches.
4. `trace_hops` >= 8 and matches the number of `### Hop N —` headings.
5. Every citation resolves against `{{TARGET_PATH}}` — path exists, lines in range.
6. At least one ` ```mermaid ` block is present.
7. Every ` ```sh ` block is preceded within the two lines above by a citation or the
   word `unverified`.

The scorer runs the same checker plus checks of its own, and additionally executes the
build and test commands from the guide in a clean environment. Commands that fail there
cost you accuracy and usefulness points; commands you honestly marked `unverified` cost
you far less than commands asserted and wrong.

---

## 9. Uncertainty is a first-class answer

If you cannot determine something from the tree, **say so in Open questions**: the
question, what you looked at, what would settle it. For example:

> The exact minimum CMake version is not determinable: `CMakeLists.txt` declares 3.16
> (CMakeLists.txt:1) but the CI image installs 3.25 (.github/workflows/ci.yml:22) and
> two subdirectories use commands I could not confirm exist in 3.16. A build on 3.16
> would settle it; this task does not permit building.

A guide that flags three uncertain commands scores **higher** than one that states all
of them confidently and gets two wrong. Inventing a plausible command is the specific
failure this category exists to detect. The temptation is strongest in Prerequisites and
in The daily loop, where projects vary and habit fills the gap — resist it there
especially.

An empty Open questions section, in a guide written without ever running the build, is
itself a signal.

---

## 10. Length

**2000-4000 words**, by the definition in section 8 of this prompt. Outside that range costs the length
component outright. Do not pad: if you are short, the worked trace or the daily loop is
thin.

---

## 11. Scoring

Scored by `docs-generation/rubric.md`. Weights for this task:

| Axis | Weight |
|---|---|
| Citation validity (mechanical) | 12 |
| Required structure present (mechanical) | 8 |
| Mermaid block parses (mechanical) | 3 |
| Length in range (mechanical) | 5 |
| Path integrity — no fabricated paths (mechanical) | 7 |
| Command executability — build and test commands actually run (mechanical) | 5 |
| Accuracy (judged against the code) | 25 |
| Completeness relative to what week one requires (judged) | 10 |
| Usefulness to a new contributor (judged) | 15 |
| Structure and readability (judged) | 5 |
| Honest treatment of uncertainty (judged) | 5 |

Hard gate: citation validity rate below 0.70 marks the document `unsupported` and caps
the total at 30/100.

---

## DEFINITION OF DONE

- [ ] Workspace exists at `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`.
- [ ] `ONBOARDING.md` exists there with the exact filename.
- [ ] Front matter has all seven keys, with `word_count`, `citation_count`, and
      `trace_hops` matching the computed values.
- [ ] All eleven required H2 headings, spelled exactly, in order.
- [ ] Word count between 2000 and 4000 by the definition in section 8 of this prompt.
- [ ] Every command is in its own ` ```sh ` block, is copy-pasteable, has no
      unexplained placeholder, and is preceded by a citation or marked `unverified`.
- [ ] Every version constraint in Prerequisites is cited to where it is declared.
- [ ] Build section takes the reader from fresh checkout to artifact, and says where the
      artifact lands.
- [ ] Test section covers full suite, single file, single case, and reading failures.
- [ ] Repository map has 10-25 rows and every path in it exists — checked, not assumed.
- [ ] Worked trace has at least 8 numbered `### Hop N —` hops, each cited, forming a
      connected chain from ingress to result.
- [ ] At least one ` ```mermaid ` block mirroring the trace, parsing, with a node legend
      of citations.
- [ ] Conventions section cites enforcement points, or states that the project declares
      none.
- [ ] At least 5 landmines, each specific and cited.
- [ ] 2-3 first tasks, each naming real files and real tests.
- [ ] Every citation matches `(path:LINE)` or `(path:START-END)` relative to the
      checkout root, and every one resolves — verified by running `test.sh`.
- [ ] Every path mentioned anywhere in the document exists in the checkout.
- [ ] Open questions lists every command or fact you could not verify from the tree.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, follow `CONVENTIONS.md`
      section 6; `run.sh` prints exactly the four lines; `test.sh` exits 0.
- [ ] `run.json` complete per `CONVENTIONS.md` section 5, `language: "markdown"`,
      honest `self_reported_status`.
- [ ] Nothing under `{{TARGET_PATH}}` was created, modified, or deleted, and the target
      was never built or run.
