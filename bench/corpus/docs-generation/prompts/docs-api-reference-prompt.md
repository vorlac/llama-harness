# Task: API reference for {{TARGET}}

Produce a complete, generated-quality reference for the **public API surface** of
{{TARGET}}: every exported symbol, with its real signature, its parameters, its return
values, its error conditions, its thread-safety, and a usage example.

Two things are being measured. First **completeness**: a reference that documents 40 of
the 137 public symbols is not 30% of a reference, it is a trap, because a reader
concludes the missing 97 do not exist. Second **accuracy**: a signature you remembered
instead of read is worse than no entry at all. Assume a reviewer diffs your signatures
against the headers.

---

## 1. Variables

| Variable | Meaning |
|---|---|
| `{{TARGET}}` | Slug of the target repository, e.g. `libsodium` |
| `{{TARGET_PATH}}` | Checkout path: `docs-generation/targets/checkouts/{{TARGET}}/` |
| `{{RUN_ID}}` | Run identifier, e.g. `qwen3.6-27B__llama-harness` |
| `{{TASK_ID}}` | `{{TARGET}}-api-reference` |

Paths in this prompt are relative to the test-corpus repository root unless stated
otherwise.

---

## 2. Input

The target codebase is checked out at `{{TARGET_PATH}}`.

**The checkout is READ-ONLY.** You may read any file and run read-only inspection
commands (`ls`, `find`, `grep`, `rg`, `cat`, `sed -n`, `wc`, `git log`, `git show`,
`git blame`). You must **not**:

- modify, create, delete, or move any file under `{{TARGET_PATH}}`
- build, compile, install, configure, or run the target — which also means you may not
  enumerate symbols with `nm`, `objdump`, or an import of the built module
- run any `git` command that writes
- access the network

The enumeration must therefore come from the source tree itself. That constraint is
deliberate: it is the part of the task that separates reading from recalling.

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
| `API-REFERENCE.md` | The deliverable. Exact, case-sensitive filename. |
| `symbols.txt` | The mechanically enumerated public surface, one symbol per line, sorted, no duplicates. |
| `run.json` | Per `CONVENTIONS.md` section 5. `language` is `"markdown"`. |
| `build.sh` | No-op. `exit 0`. |
| `run.sh` | Prints the stdout summary in section 8. |
| `test.sh` | Self-check defined in section 8. |

Scripts follow `CONVENTIONS.md` section 6: `chmod +x`, `#!/usr/bin/env bash`,
`set -euo pipefail`, no network, run with `markdown/` as the working directory.

`API-REFERENCE.md` opens with this YAML front matter, values filled in:

```yaml
---
task_id: {{TASK_ID}}
target: {{TARGET}}
run_id: {{RUN_ID}}
document: API-REFERENCE.md
word_count: 0
citation_count: 0
symbols_enumerated: 0
symbols_documented: 0
---
```

---

## 4. Step one: enumerate the surface mechanically

Do this **before you write any prose**, and do it from the tree, not from memory. You
are not permitted to write the index from what you know about {{TARGET}}; you must
derive it from what is in the checkout.

Determine what "public" means for this project, then enumerate accordingly. Typical
sources, depending on language:

| Language | Where the public surface is declared |
|---|---|
| C / C++ | Installed headers (the `include/` dir, or whatever the build files install), `extern` declarations, export macros, `.def`/version-script files |
| Rust | `pub` items reachable from `src/lib.rs`, re-exports, `#[no_mangle]` |
| Python | `__init__.py` re-exports, `__all__`, names not prefixed with `_`, entry points in packaging metadata |
| Go | Exported (capitalised) identifiers in non-`internal` packages |
| JavaScript / TypeScript | `exports`/`main`/`types` in `package.json`, `export` statements in the entry module, `.d.ts` declarations |
| Java / C# | `public` members of published packages/namespaces |

Rules:

- Find the project's own definition of its public surface first — the install rules in
  the build files, a version script, an `__all__`, a documented "stable API" list — and
  prefer it over your own heuristic. Cite where you found it.
- If the project has no such declaration, choose a rule, **state it explicitly**, and
  apply it uniformly.
- Write the result to `symbols.txt`: one symbol per line, sorted with `LC_ALL=C sort -u`,
  no annotations, no blank lines. This file is compared against your document.
- Record the exact shell commands you ran to produce it, in section 1 of the document.
  They must be real commands that were actually run, reproducible against the checkout.
- Report the count on a line of its own, in exactly this form, in section 1:

```
Public symbol count: 137
```

The mechanical checker reads that line, reads `symbols.txt`, and compares both against
the entries in your reference.

Symbols include functions, methods, types/structs/classes, enums and their members
where they are part of the contract, constants and macros that callers use, and
top-level variables. Do not pad the count with internal helpers to look thorough; do
not trim it to reduce work. Both distortions are detected by re-running the enumeration.

---

## 5. THE CITATION RULE

This is the core requirement of this category. Read it twice.

**Every non-obvious factual claim about the target must carry an inline citation.** Any
statement about what the code is, does, contains, enforces, assumes, or guarantees.
General programming background needs no citation; anything specific to {{TARGET}} does.

A citation is a parenthesised path-and-line reference in **exactly** this form:

```
(path/to/file.h:LINE)
(path/to/file.h:START-END)
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
5. The citation sits in the same sentence, bullet, or table cell as the claim.

Parsed with:

```
\(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
```

**Every symbol entry requires at least two citations**: one for the declaration
(signature) and at least one for the behaviour you describe (the implementation, the
error returns, the documented contract). An entry with a signature citation only is
scored as an undocumented symbol for completeness purposes.

**No fabricated paths and no fabricated symbols.** Every path mentioned anywhere in the
document must exist in the checkout. Every symbol documented must appear in the source
at the cited line. A parameter that does not exist, a return code that is never
returned, or a function that was renamed three releases ago is the exact failure this
category exists to detect.

---

## 6. Signatures and code blocks

Every signature block is **copied verbatim from the source**. Not normalised, not
reformatted, not stripped of macros, attributes, or `const` qualifiers. If the
declaration in the header differs from the definition in the source, show the header
declaration and note the difference.

The line immediately before the opening fence ends with a citation. Written out, outer
fence shown as tildes so the example nests:

~~~~
**Signature** (src/include/sodium/crypto_box.h:41-45):

```c
SODIUM_EXPORT
int crypto_box_easy(unsigned char *c, const unsigned char *m,
                    unsigned long long mlen, const unsigned char *n,
                    const unsigned char *pk, const unsigned char *sk)
            __attribute__ ((warn_unused_result));
```
~~~~

**Examples.** Every entry needs a usage example. Prefer a real one: pull it from the
project's tests, examples directory, README, or documentation, quote it verbatim, and
cite it. Where no real usage exists, write a minimal constructed example and label the
line above the fence `Example (constructed, not from the tree)`. A constructed example
labelled honestly is fine; a constructed example presented as if it came from the repo
is a fabrication.

---

## 7. Required document skeleton

Use these exact H2 headings, in this order, spelled exactly as shown:

```
## 1. Enumeration method
## 2. Symbol index
## 3. Reference
## 4. Coverage
## 5. Open questions
```

**1. Enumeration method** — what "public" means for this project and where that
definition came from (cited); the exact commands you ran, in a `sh` block; the
`Public symbol count: N` line; and any category of symbol you deliberately excluded,
with the reason. 200-400 words.

**2. Symbol index** — one table row per enumerated symbol:
`Symbol | Kind | Declared | Summary`, where `Kind` is one of `function`, `type`,
`macro`, `constant`, `variable`, `method`, `enum`, and `Declared` is a citation to the
declaration. One line of summary. The index must contain **every** line of
`symbols.txt` and nothing that is not in it. Sort it the same way as `symbols.txt`.
Group by module/header with `###` sub-headings if that aids navigation — the row set
must still match exactly.

**3. Reference** — one `### <symbol>` subsection per documented symbol, in the same
order as the index. Each subsection contains these bolded labels, in this order, every
one present even if the answer is "none" or "not determinable from the code":

- **Signature** — verbatim block, cited.
- **Description** — what it does, cited to the implementation.
- **Parameters** — a list, one entry per parameter: name, type, meaning, ownership
  (borrowed/transferred/copied), valid range or nullability, cited.
- **Returns** — the return type and the meaning of each possible value, cited.
- **Errors** — every failure mode: error codes, exceptions, panics, `errno` values,
  negative returns, and what state is left behind. Cite each. If the function cannot
  fail, say so and cite the code that shows it.
- **Thread safety** — safe to call concurrently? reentrant? does it touch global or
  static state? does it require external locking? Cite the evidence — a static
  variable, a lock acquisition, a documented guarantee. If the code does not settle it,
  write `Not determinable from the code` and add it to Open questions. Do not guess:
  an invented thread-safety guarantee is the most dangerous single sentence a reference
  can contain.
- **Example** — real (cited) or labelled constructed.
- **Notes** — deprecations, availability/version gates, platform conditionals,
  surprising behaviour. Omit the label only if there is nothing to say.

**Size cap.** If the enumerated surface exceeds 150 symbols, the index in section 2 must
still cover **all** of them, and section 3 must give full entries to the 150 most
consequential. State the selection rule you used in section 1, and list the deferred
symbols in section 4. Below 150 symbols, every symbol gets a full entry — no exceptions.

**4. Coverage** — the counts: enumerated, fully documented, index-only, deliberately
excluded. Give them as a table. Then list every symbol you did not fully document, with
one reason each. Do not claim coverage you do not have: the checker recomputes these
numbers from your own document and `symbols.txt`, and an inflated claim is scored as a
fabrication, not as an arithmetic slip.

**5. Open questions** — see section 9.

---

## 8. Workspace scripts

`run.sh` prints exactly these four lines to stdout and nothing else (diagnostics to
stderr):

```
document: API-REFERENCE.md
words: <N>
citations: <N>
symbols: <N>
```

`symbols` is the line count of `symbols.txt` and must equal `symbols_enumerated` in the
front matter and the `Public symbol count: N` line in section 1.

`words` is authoritative and must equal `word_count`: whitespace-separated tokens
remaining after all fenced code blocks are removed. Compute it with exactly this
program so your count agrees with the scorer's:

```sh
python3 - API-REFERENCE.md <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
t = re.sub(r'^```.*?^```', '', t, flags=re.S | re.M)
print(len(t.split()))
PY
```

`citations` is the number of matches of the regular expression in section 5 of this prompt, and must equal
`citation_count`.

`test.sh` runs the **category checker** first, then your own additional checks. The
checker is `docs-generation/check_docs.py` and the flags for this task are recorded in
`docs-generation/tasks/<task-id>/task.json` under `verify_args`. From the `markdown/`
working directory that is:

```sh
python3 ../../../../check_docs.py \
  --doc API-REFERENCE.md \
  --checkout ../../../../targets/checkouts/{{TARGET}}/ \
  --min-words 3000 \
  --max-words 8000 \
  --require-section "Enumeration method" \
  --require-section "Symbol index" \
  --require-section "Reference" \
  --require-section "Coverage" \
  --require-section "Open questions" \
  --json
```

It exits 0 when every hard check passes, 1 when one fails, 2 on a bad invocation. It
resolves every citation against the checkout, checks the required sections, the word
budget, and the mermaid blocks, and warns about path-looking tokens that do not exist.
Run it while you write, not once at the end.

`test.sh` then adds the checks the category checker does not cover. It exits non-zero,
naming the failed check, unless:

1. `API-REFERENCE.md` and `symbols.txt` exist; front matter has all eight keys.
2. All five required H2 headings are present, in order.
3. `symbols.txt` is sorted, unique, non-empty, and its line count equals
   `symbols_enumerated` and the `Public symbol count:` line.
4. Every symbol in `symbols.txt` appears as a row in the section 2 index, and the index
   contains no symbol absent from `symbols.txt`.
5. `symbols_documented` equals the number of `### ` subsections in section 3.
6. Every `### ` entry has all required bolded labels and at least two citations.
7. Every citation resolves against `{{TARGET_PATH}}` — path exists, lines in range.
8. `word_count` is in range and matches the computed count; `citation_count` matches.

The scorer runs the same checker plus checks of its own; `test.sh` exists so you catch
your own errors first.

---

## 9. Uncertainty is a first-class answer

If the code does not settle something — thread safety, whether a pointer is borrowed or
owned, whether a return value can be negative — write `Not determinable from the code`
in the entry and record it in **Open questions** with what you looked at and what would
settle it. For example:

> Whether `crypto_box_keypair` is safe to call before `sodium_init` is not determinable
> from the code I read: the RNG accessor (src/randombytes.c:112-130) initialises lazily
> on some platforms and asserts on others, and I could not establish which applies to
> the default build.

Admitted uncertainty scores **higher** than an invented answer. This matters most in
**Errors** and **Thread safety**, which are the two fields a reader will act on and the
two most easily confabulated.

An entry where every field is confidently filled in for a function whose implementation
you never opened is the failure mode this category hunts.

---

## 10. Length

**3000-8000 words**, by the definition in section 8 of this prompt. The range is wide because the real
surface drives it. If the surface is small and you are under 3000 words with every
symbol fully documented, say so explicitly in section 4 — that note is what keeps the
length check from penalising an honest, complete, small reference. Never pad entries
with restated boilerplate to reach a number; padding is visible and is scored under
accuracy and structure.

---

## 11. Scoring

Scored by `docs-generation/rubric.md`. **Completeness is the dominant axis for this
task**, and the weights are overridden accordingly:

| Axis | Weight |
|---|---|
| Citation validity (mechanical) | 15 |
| Required structure present (mechanical) | 8 |
| Index/`symbols.txt` consistency (mechanical, replaces the mermaid check) | 5 |
| Length in range (mechanical) | 5 |
| Path and symbol integrity — nothing fabricated (mechanical) | 7 |
| Completeness relative to the real surface (judged) | 25 |
| Accuracy (judged against the code) | 20 |
| Usefulness to a calling developer (judged) | 5 |
| Structure and readability (judged) | 5 |
| Honest treatment of uncertainty (judged) | 5 |

Completeness is judged against a surface the scorer enumerates **independently**, not
against your `symbols.txt`. Under-enumerating does not reduce the denominator.

Hard gate: citation validity rate below 0.70 marks the document `unsupported` and caps
the total at 30/100.

---

## DEFINITION OF DONE

- [ ] Workspace exists at `docs-generation/solutions/{{RUN_ID}}/{{TASK_ID}}/markdown/`.
- [ ] `API-REFERENCE.md` and `symbols.txt` exist there with exact filenames.
- [ ] `symbols.txt` was produced by commands actually run against the checkout, is
      `LC_ALL=C sort -u` sorted, and those commands appear in section 1.
- [ ] `Public symbol count: N` appears in section 1 in exactly that form, and N equals
      the line count of `symbols.txt` and the `symbols_enumerated` front-matter field.
- [ ] Front matter has all eight keys with values matching the computed ones.
- [ ] All five required H2 headings, spelled exactly, in order.
- [ ] The section 2 index has exactly one row per line of `symbols.txt` and no extras.
- [ ] Every documented symbol has all required labels: Signature, Description,
      Parameters, Returns, Errors, Thread safety, Example.
- [ ] Every signature block is verbatim from the source and preceded by a citation.
- [ ] Every entry carries at least two citations, one of them to the implementation.
- [ ] Every example is either quoted-and-cited from the tree or labelled
      `Example (constructed, not from the tree)`.
- [ ] Every `Thread safety` field is either evidenced by a citation or states
      `Not determinable from the code` and is listed in Open questions.
- [ ] Every citation matches `(path:LINE)` or `(path:START-END)` relative to the
      checkout root, and every one resolves — verified by running `test.sh`.
- [ ] Section 4 reports honest counts and lists every symbol not fully documented with a
      reason.
- [ ] Word count between 3000 and 8000, or a short-surface note in section 4.
- [ ] No symbol, parameter, error code, or path appears that is not in the checkout.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, follow `CONVENTIONS.md`
      section 6; `run.sh` prints exactly the four lines; `test.sh` exits 0.
- [ ] `run.json` complete per `CONVENTIONS.md` section 5, `language: "markdown"`,
      honest `self_reported_status`.
- [ ] Nothing under `{{TARGET_PATH}}` was created, modified, or deleted, and the target
      was never built or run.
