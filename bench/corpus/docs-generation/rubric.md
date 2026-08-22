# `docs-generation` scoring rubric

The shared rubric for all five tasks in this category:

| Task | Prompt | Deliverable |
|---|---|---|
| `{{TARGET}}-architecture-overview` | `docs-architecture-overview-prompt.md` | `ARCHITECTURE.md` |
| `{{TARGET}}-{{SUBSYSTEM}}-deepdive` | `docs-subsystem-deepdive-prompt.md` | `SUBSYSTEM-{{SUBSYSTEM}}.md` |
| `{{TARGET}}-api-reference` | `docs-api-reference-prompt.md` | `API-REFERENCE.md`, `symbols.txt` |
| `{{TARGET}}-onboarding-guide` | `docs-onboarding-guide-prompt.md` | `ONBOARDING.md` |
| `{{TARGET}}-adr-reconstruction` | `docs-adr-reconstruction-prompt.md` | `ADRS.md` |

Every deliverable lands in
`docs-generation/solutions/<run-id>/<task-id>/markdown/` per `CONVENTIONS.md`
section 4, alongside `run.json` (section 5) and `build.sh` / `run.sh` / `test.sh`
(section 6).

**What this category measures.** Not whether a model can write documentation — every
model can write documentation. Whether the documentation it writes is *true of the code
in front of it*. The failure mode being hunted is the fluent, well-structured, entirely
plausible document that describes a system slightly different from the one in the
checkout. Every mechanical check and every judged criterion below exists to make that
failure visible and expensive.

---

## 1. Scoring shape

Each task scores out of 100: **40 mechanical**, **60 judged**.

Mechanical points are computed by script from the deliverable and the checkout, with no
model in the loop. They are fully reproducible: the same document scores the same
mechanical points every time. Judged points come from an LLM-judge pass run under the
protocol in section 6.

The task's own prompt carries the weight table that applies to it. Section 4 below
restates all five tables together.

---

## 2. Mechanical checks

All checks run against the deliverable and the read-only checkout at
`docs-generation/targets/checkouts/<target>/`. All of them are recomputed by the scorer
independently of anything the document claims about itself.

Most of them are already implemented by `docs-generation/check_docs.py`, which the
workspace's own `test.sh` also runs: it resolves citations (M1), checks required
sections (part of M2), mermaid block form (M3), the word budget (M4), and reports
path-looking tokens that do not exist in the checkout (M5). Its per-task flags live in
`docs-generation/tasks/<task-id>/task.json` under `verify_args`, so the budgets and
section names are stated in exactly one place. The scorer layers the remaining checks on
top: front-matter/self-report agreement, per-entry sub-structure, the api-reference
index-versus-`symbols.txt` consistency, commit-hash resolution for the ADR task, and M6.
A run that passes `check_docs.py` has cleared the hard gate, not earned full mechanical
marks.

Where the task registry and a prompt disagree about a budget or a section name, the
prompt is authoritative and the registry entry is the bug.

### M1 — Citation validity

**Definition.** Extract every citation with the code-citation regex

```
\(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
```

and, for the ADR task only, additionally

```
\(git:([0-9a-f]{7,40})(?: ([A-Za-z0-9._+\-/]+))?\)
```

A code citation is **valid** iff: the path resolves to a regular file under the checkout
root, the path does not escape the checkout, `START <= END`, `END <= ` the file's line
count, and `END - START <= 59`. A commit citation is valid iff the hash resolves to a
commit object in the checkout and any named path exists in that commit.

```
validity_rate = valid_citations / total_citations        (0 if total_citations == 0)
```

**Points.** `round(weight * f(validity_rate))` where

| `validity_rate` | `f` |
|---|---|
| 1.00 | 1.00 |
| 0.98 – 0.999 | 0.90 |
| 0.95 – 0.979 | 0.75 |
| 0.90 – 0.949 | 0.50 |
| 0.80 – 0.899 | 0.25 |
| < 0.80 | 0.00 |

**Density floor.** A document with fewer than `0.8` citations per 100 words scores at
most `0.50` on M1 regardless of validity — a document with four perfectly valid
citations is not a cited document. The subsystem task additionally applies its own floor
(20 citations across 6 distinct files) as stated in its prompt; falling short without the
justification the prompt permits caps M1 at `0.50`.

**Hard gate.** `validity_rate < 0.70` marks the run `unsupported` and caps the **total**
score at 30/100. For the ADR task, any unresolvable commit hash triggers the same gate
independently of the rate.

### M2 — Required structure

**Definition.** Checks, each pass/fail:

1. Deliverable exists at the exact required path and filename.
2. YAML front matter present with every key the prompt requires.
3. Self-reported `word_count` and `citation_count` (and `symbols_enumerated`,
   `trace_hops`, `adr_count` where required) equal the independently computed values.
4. Every required H2 heading present, spelled exactly, in the required order.
5. Every required sub-structure present: per-symbol labels (api-reference), per-ADR H3
   subsections (adr-reconstruction), `### Hop N —` headings (onboarding), inventory
   tables (subsystem), component table and invariant list (architecture).
6. `run.json` present and valid per `CONVENTIONS.md` section 5, with
   `language: "markdown"`.
7. `build.sh`, `run.sh`, `test.sh` present, executable, `run.sh` emitting exactly the
   stdout lines the prompt specifies.

**Points.** `weight * (checks_passed / checks_total)`, rounded.

A self-reported count that disagrees with the computed count fails check 3 and is also
reported separately as a **self-report divergence**, the documentation analogue of the
`self_reported_status` divergence in `CONVENTIONS.md` section 5. It is worth tracking on
its own: a run that miscounts its own document is a run that did not verify itself.

### M3 — Diagram / index integrity

**Diagram form** (architecture, subsystem, onboarding, adr). Every ` ```mermaid ` block
is rendered by a mermaid parser. Checks: the required number of blocks is present; each
block parses; each block declares one of the permitted diagram types; each block is
followed by a legend list whose entries cover every node id used; node count `<= 20`.
Points are `weight * (blocks_passing / blocks_required)`, zero if the required blocks are
missing.

**Index integrity** (api-reference, which has no diagram requirement). Checks:
`symbols.txt` exists, is `LC_ALL=C sort -u` ordered and duplicate-free; its line count
equals both `symbols_enumerated` and the `Public symbol count: N` line; the section 2
index has exactly one row per line of `symbols.txt` and no extra rows; the number of
`### ` entries in section 3 equals `symbols_documented`; the coverage table in section 4
is arithmetically consistent with all of the above. Points are
`weight * (checks_passed / checks_total)`.

### M4 — Length in range

**Definition.** Word count is whitespace-separated tokens after removing every fenced
code block, mermaid blocks included — the exact program is printed in each prompt, and
the scorer runs that same program.

| Task | Range |
|---|---|
| architecture-overview | 2000 – 4000 |
| subsystem-deepdive | 2500 – 5000 |
| api-reference | 3000 – 8000 |
| onboarding-guide | 2000 – 4000 |
| adr-reconstruction | 2500 – 4500 |

**Points.** Full weight inside the range. Outside it, `weight * max(0, 1 - 2*d)` where
`d` is the fractional distance outside the nearer bound (a document 10% over the ceiling
scores 80% of the weight; 50% over scores zero). One exception: for api-reference, a
document under the floor that documents every symbol in an independently confirmed small
surface **and** states this in its Coverage section receives full weight — an honest
complete reference is not penalised for the surface being small.

### M5 — Path, symbol, and hash integrity

**Definition.** Extract every filesystem-looking path anywhere in the document — prose,
tables, command blocks, diagram legends, repository maps — not only the ones inside
citations. Each must resolve under the checkout. Extract every commit hash (adr task) and
every symbol named as existing (api-reference: every row of the index; other tasks:
symbols named in inventory tables and call graphs). Each must be found in the checkout.

```
integrity_rate = resolvable_references / total_references
```

**Points.** Full weight at `1.00`. Each unresolvable reference costs `weight * 0.25`,
floored at zero. Fabrication is deliberately punished steeply here: this check is the
most direct measurement of the failure mode the category exists to detect, and a
document that invents four paths scores zero on it.

Note the asymmetry with M1: an invalid *line number* is a sloppiness signal, an invalid
*path* is a fabrication signal. They are weighted accordingly.

### M6 — Command executability (onboarding-guide only)

**Definition.** In a clean container matching the target's declared prerequisites, run,
in order, the commands the guide gives in `## 3. Build it` and `## 4. Test it`. Record
per command: exit status, and whether it was marked `unverified` in the document.

```
command_score = executed_ok / (commands_total - unverified_marked * 0.5)
```

capped at 1.0. A command marked `unverified` that nonetheless works counts as a success;
a command marked `unverified` that fails costs half of what an unmarked failure costs.
That asymmetry is intentional and mirrors the category's central preference: flagged
uncertainty is cheap, confident error is expensive.

**Points.** `weight * command_score`, rounded. If the environment cannot be constructed
at all (the target needs hardware or a network service the harness cannot supply), M6 is
recorded as `not_applicable`, its weight is redistributed proportionally across M1, M2,
M4, and M5, and that redistribution is noted in the result record.

---

## 3. Judged criteria

Each judged criterion is scored **0–5** by the protocol in section 6, then scaled:
`points = weight * score / 5`.

The bands below are the scoring instrument. A judge is given one criterion's band table,
the document, and the checkout, and nothing else.

### J1 — Accuracy

*Is what the document says true of the code?* For adr-reconstruction this criterion is
replaced by J1' below.

| Score | Meaning |
|---|---|
| 5 | The judge sampled at least 15 claims across all sections, opened the cited code for each, and found no false claim and no misleading emphasis. Where the document simplifies, it says so. |
| 4 | One minor inaccuracy: a detail wrong in a way that would not mislead a reader into a bad decision (an off-by-one in a described bound, a slightly wrong responsibility split). |
| 3 | Two or three minor inaccuracies, or one significant one — a claim a reader would act on that is wrong, but recoverable once they open the code. |
| 2 | A significant inaccuracy in a load-bearing section (the flow, the locking rules, an error contract, a build command), or a pattern of small errors suggesting the document was written from a skim. |
| 1 | Multiple significant inaccuracies, or one fabrication: a described function, parameter, error code, flag, or file that does not exist. |
| 0 | The document describes a system materially different from the checkout. Reading it would make a newcomer slower, not faster. |

**Fabrication rule.** Any *fabrication* — a symbol, parameter, return code, command
flag, file, or commit that does not exist and is presented as existing — caps J1 at 1.
Two or more cap it at 0. This is a cap, not a deduction: it cannot be offset by strength
elsewhere.

**Attribution rule.** A claim correctly attributed to its source ("the comment at
`(src/x.c:44)` says the buffer is never resized") is judged on whether the attribution is
accurate, not on whether the source is right. Reporting a stale comment as a comment is
accurate; repeating it as fact is not.

### J1' — Decision reality and characterisation (adr-reconstruction only)

Judged per ADR, then averaged and rounded to the nearest whole score.

| Score | Meaning |
|---|---|
| 5 | The decision was demonstrably made, is characterised as the project itself would recognise it, and every cited item genuinely supports it. Consequences name real costs visible in the code. |
| 4 | Real decision, correctly characterised, but the evidence is thinner than presented or one consequence is speculative without being marked `Inferred:`. |
| 3 | Real decision, but mischaracterised: the right subject, the wrong reason, or an effect promoted to a decision. |
| 2 | An implementation detail or a language/framework default written up as a deliberate architectural decision. |
| 1 | The decision is a plausible narrative with no support in the cited evidence; the citations resolve but do not show what is claimed. |
| 0 | Invented. The code shows the opposite, or the cited commits do not exist. |

An ADR scoring 0 or 1 costs more than it earns: the average drops further than omitting
it would have. Five evidenced ADRs beat eight where three are narrative.

### J2 — Completeness relative to the actual surface

*Does the document cover what is really there?* Judged against a surface the scorer
establishes independently — its own component list, subsystem file set, symbol
enumeration, or decision candidate list — never against the document's own claims about
what exists.

| Score | Meaning |
|---|---|
| 5 | Every element of the independently established surface is covered at the required depth. Omissions, if any, are explicit and justified. |
| 4 | ≥ 90% covered; nothing important missing; omissions acknowledged. |
| 3 | ≥ 75% covered, or full coverage with several elements documented too thinly to use. |
| 2 | ≥ 50% covered. A reader would form a materially incomplete picture and would not know it. |
| 1 | < 50% covered, or the document presents partial coverage as complete. |
| 0 | Covers a small fraction while implying totality. |

**Silent partiality rule.** Undocumented omission is worse than documented omission at
every band. A document that covers 60% and says which 40% it skipped scores 3; one that
covers 60% and implies it covered everything scores 1.

### J3 — Usefulness to the stated audience

Audience per task: architecture — an engineer new to the system; subsystem — a
maintainer changing that subsystem; api-reference — a developer calling the API from
outside; onboarding — a contributor in week one; adr — a maintainer inheriting the
system and deciding what may be changed.

| Score | Meaning |
|---|---|
| 5 | The reader could act directly: make the change, call the API, complete the first week, decide what is safe to alter. It answers the questions that audience actually has, in the order they arise. |
| 4 | Useful with one or two lookups into the source. |
| 3 | Useful as orientation; the reader still has to reconstruct the important parts themselves. |
| 2 | Restates what is obvious from directory names and file headers. |
| 1 | A summary of the README with citations attached. |
| 0 | No use to the stated audience. |

Judges must resist rewarding polish here. The question is not whether the document reads
well; it is whether it removes work from the reader.

### J4 — Structure and readability

| Score | Meaning |
|---|---|
| 5 | Required skeleton followed and used well: sections carry their intended content, tables where tables help, prose where prose helps, no filler, navigable by heading alone. |
| 4 | Well organised; minor redundancy or one section padded. |
| 3 | Skeleton present but unevenly filled; noticeable repetition or content in the wrong section. |
| 2 | Skeleton followed nominally; substantial padding or boilerplate repeated per entry. |
| 1 | Hard to navigate; sections mislabelled relative to their content. |
| 0 | Skeleton not followed. |

This is deliberately the lightest criterion. Structure is easy for a model and near-free
to fake; it must not be able to compensate for inaccuracy.

### J5 — Honest treatment of uncertainty

| Score | Meaning |
|---|---|
| 5 | Open questions names real, specific, hard-to-answer things, each with what was examined and what would settle it. Inferences are marked as inferences throughout. Confidence tracks evidence everywhere the judge samples. |
| 4 | Good uncertainty markers; one or two places where an inference is stated as fact. |
| 3 | Open questions present but generic ("more investigation needed"), or uncertainty acknowledged in one section and ignored in others. |
| 2 | Perfunctory Open questions; the body reads uniformly confident regardless of evidence. |
| 1 | Open questions empty or absent on a codebase where the judge can readily name unresolved questions. |
| 0 | Confident answers given where the code does not support any answer — the failure this category exists to detect. |

**Rewarded honesty.** An honestly flagged non-answer scores higher than a confident
wrong answer at every band, and a judge who catches the document declining to guess
where guessing was tempting should score 5. This is the one criterion where saying less
scores more.

---

## 4. Weights

All five tables sum to 100: 40 mechanical, 60 judged.

| Axis | arch | subsys | api | onboard | adr |
|---|---|---|---|---|---|
| M1 Citation validity | 15 | 15 | 15 | 12 | 15 |
| M2 Required structure | 8 | 8 | 8 | 8 | 5 |
| M3 Diagram / index integrity | 5 | 5 | 5 | 3 | 3 |
| M4 Length in range | 5 | 5 | 5 | 5 | 5 |
| M5 Path/symbol/hash integrity | 7 | 7 | 7 | 7 | 12 |
| M6 Command executability | — | — | — | 5 | — |
| **Mechanical total** | **40** | **40** | **40** | **40** | **40** |
| J1 Accuracy (J1' for adr) | 25 | 25 | 20 | 25 | 30 |
| J2 Completeness | 15 | 15 | 25 | 10 | 12 |
| J3 Usefulness | 10 | 10 | 5 | 15 | 8 |
| J4 Structure and readability | 5 | 5 | 5 | 5 | 3 |
| J5 Honest uncertainty | 5 | 5 | 5 | 5 | 7 |
| **Judged total** | **60** | **60** | **60** | **60** | **60** |

Rationale for the three deviations from the base shape:

- **api-reference** moves 5 points from accuracy to completeness. A reference that omits
  half the surface actively misleads, because absence from a reference reads as absence
  from the API.
- **onboarding-guide** moves 5 points into usefulness and adds M6 by trimming M1 and M3.
  The guide's whole value is that a reader can follow it; an accurate guide nobody can
  execute has failed.
- **adr-reconstruction** moves weight away from form (M2, M3, J4 all drop) and into
  whether the decisions are real (J1' at 30, M5 at 12, J5 at 7). Formatting an ADR is
  trivial; identifying a real decision is the task.

---

## 5. Bands and reporting

| Total | Band | Meaning |
|---|---|---|
| 90 – 100 | Trustworthy | A maintainer would accept this into the repository as-is. |
| 75 – 89 | Sound | Accurate and useful; needs light editing or a few gaps filled. |
| 60 – 74 | Serviceable | Broadly right, with real gaps or a few errors a reader would hit. |
| 40 – 59 | Unreliable | Mixed truth and plausibility. Cannot be trusted without checking each claim. |
| 20 – 39 | Misleading | More confident than correct; a reader is worse off than with no document. |
| 0 – 19 | Fabricated | Substantially describes a system that is not in the checkout. |

Every task result also records, separately from the score, the four numbers that make
runs comparable across models without any judge in the loop:

```json
{
  "task_id": "redis-architecture-overview",
  "run_id": "qwen3.6-27B__llama-harness",
  "language": "markdown",
  "citations_total": 84,
  "citations_valid": 82,
  "citation_validity_rate": 0.976,
  "citation_density_per_100w": 2.7,
  "unresolvable_paths": 0,
  "unresolvable_hashes": 0,
  "word_count": 3120,
  "self_report_divergence": false,
  "mechanical_points": 37,
  "judged_points": 48,
  "total": 85,
  "band": "Sound",
  "gated_unsupported": false
}
```

Report `citation_validity_rate`, `unresolvable_paths`, and `self_report_divergence` in
every comparison table produced by `tools/compare.py`. They are the cheapest, most
reproducible signal in the category, they need no judge, and they are where a
harness-driven run is most likely to separate from a vanilla one.

---

## 6. Running the LLM-judge pass fairly

The judged criteria carry 60 of 100 points, so the judging protocol is part of the
measurement instrument. Follow it exactly; deviations make runs non-comparable in the
sense of `CONVENTIONS.md` section 1.

**Blind.** The judge never learns which run produced the document. Strip front matter,
strip any run identifier, rename the file to a neutral name, and present documents in a
randomised order. Never place a vanilla document and a harness document in the same
judging context: each document is scored against the code, on its own, and the totals
are compared afterwards. Comparative judging invites the judge to split the difference.

**Against the code, not against a reference.** The judge is given read access to the same
checkout and is instructed to open the cited files. A claim is confirmed by reading the
code, never by whether it sounds right. There is no golden document to compare against;
if one existed, this category would be measuring imitation rather than comprehension.

**One criterion at a time.** Each criterion gets its own pass, its own context, and only
its own band table from section 3. A judge holding all five criteria at once produces
correlated scores — a document that reads well scores high on accuracy for no reason
connected to accuracy. Separate passes are the main defence against halo effects.

**Evidence required for every deduction.** For any score below 5, the judge must name the
specific claim and the file and line it checked. A deduction without a located
counter-example is discarded and the criterion is re-run. This makes judge output
auditable, and audit is how you find out the judge is the thing that is wrong.

**Sampling rule for accuracy.** J1/J1' requires at least 15 sampled claims for documents
under 4000 words and at least 25 above, drawn across all sections rather than from the
first two. Sample selection is seeded by the document's SHA-256 so the same document
draws the same sample on re-runs. Always include: every claim about concurrency or
locking, every claim about an error path, every command, and every performance claim —
these are both the most consequential and the most confabulated.

**Determinism.** Temperature 0, a fixed judge model recorded in the result record, and a
fixed prompt template per criterion. Changing the judge model invalidates comparison
with earlier results; record it and re-run both sides of any comparison.

**Two judges plus tie-break.** Every criterion is scored by two independent judge
instances. Agreement within 1 band averages, rounding down. A gap of 2 or more triggers
a third pass whose transcript is retained; the median wins. Report inter-judge
disagreement per criterion — persistent disagreement means the band table is ambiguous
and needs fixing, not that the documents are borderline.

**Order of operations.** Mechanical checks run first. If the hard gate in M1 fires, the
document is recorded `unsupported`, capped at 30, and judged anyway — the judged scores
are kept for analysis but do not lift the cap. Judging a gated document is what tells you
whether a run was fluent-but-unanchored or simply careless with line numbers, and those
are different failures worth distinguishing.

**Judges do not edit.** The judge produces scores and evidence. It never rewrites the
document, never suggests improvements in the score record, and never sees this rubric's
weight table — only the band table for the criterion it is scoring. Weighting is
arithmetic and belongs to the scorer, not the judge.
