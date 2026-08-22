# Scoring a docs-generation task through the bench's human rubric lane

`bench/corpus/DEFERRED.md` records why the five docs-generation tasks are not in
a manifest: their mechanical checker passes on filler, sixty of their hundred
points are an LLM judge this bench does not have, and their targets are 1.2M
lines fetched from six third-party repositories at pins on moving branches.

This document is the other half of that decision. A documentation deliverable is
not unscoreable — it is unscoreable *by exit status*. The driver already carries
a lane that reads a judgement, and this is how a docs task would go through it.

## The lane that exists

`scripts/conductor_bench.py` holds a hand-scored rubric lane beside the pass
rate. It is the only thing in that file that reads a judgement, and it is
entered by a person rather than derived. Four pieces:

| Piece | What it does |
|---|---|
| `stratified_review_sample(plan, tasks, per_stratum)` | Names which cells a human should read: one stratum per (tier, arm), the first `per_stratum` cells of each, in sorted order. A pure function of the plan, so two people asking for the sample get the same cells. |
| `RUBRIC_CRITERIA` | The five criteria: `structure`, `decomposition`, `testQuality`, `deadCode`, `overBuilding`. |
| `write_rubric(rubric_dir, row)` / `validate_rubric(row)` | One JSON file per reviewed cell, named for the cell. A record carries `cellId`, `reviewer`, `scores` (every criterion present, each an integer 0-3), `findings` (a list of strings) and `notes` (text). Anything missing, out of range, or outside the criteria is a refusal. |
| `aggregate_rubrics(rubrics, results)` | Per-arm medians per criterion over the cells a human actually reviewed, rendered into the report's `## Rubric` section. An arm with no reviewed cell reports "not measured" rather than a zero. |

The command that produces the sample:

```
python3 scripts/conductor_bench.py --manifest <manifest> --review-sample 1
```

and `--rubric-dir` is where the records are read from and written to.

## How a docs cell would run

A docs task in this shape would still be an ordinary manifest task with a seed
and a hidden test, because the driver has no other cell shape. The difference is
what each of those two things is for.

- **The seed** is the target checkout, at a pinned content hash, vendored or
  content-addressed rather than fetched — a cell that clones from github.com is
  not hermetic and is not reproducible.
- **The hidden test** is not the score. It is the *admissibility gate*: does the
  named document exist, is it inside the word band, does it carry the required
  sections, does every citation resolve to a real file and a real line, do the
  mermaid blocks parse. That is exactly what `check_docs.py` already does, and it
  is a fair thing for it to do as long as nobody calls its exit status a score.
  A document that fails it is not reviewable; a document that passes it has
  earned a reviewer's time and nothing more.
- **The rubric record** is the score. It is entered by a person from the sample,
  and the report's `## Rubric` section is where a docs comparison would actually
  be read.

This split is what keeps the bench honest. A pass rate over an admissibility
gate would report "both arms produced a well-formed document" as though it meant
"both arms produced an accurate one", which is precisely the trap section 1 of
`DEFERRED.md` documents.

## What the five criteria mean for a document

The criteria are named for code, because every task in the bench today is code.
Four of the five carry over to prose without straining; one does not.

| Criterion | Read against a document |
|---|---|
| `structure` | Does the document have a shape a reader can navigate — sections in an order that builds, headings that say what is under them, no section that exists only because the template asked for it? |
| `decomposition` | Is the subject broken into the pieces it actually has, rather than the pieces the repository's directory names suggest? This is where a component map that lists modules instead of explaining responsibilities loses points. |
| `testQuality` | **Reinterpret as citation quality.** Does a non-obvious claim carry a citation, and does the cited span actually support the claim? This is the axis the mechanical checker cannot reach, so it is the reviewer's most valuable minute: sample five citations, open the cited lines, and score what is there. |
| `deadCode` | **Reinterpret as filler.** Passages that restate the heading, paragraphs that survive being deleted, a diagram that adds nothing the prose did not say. The word band makes filler *profitable*, so this axis is the counterweight to it. |
| `overBuilding` | Scope the document did not need — a tutorial inside an architecture overview, an exhaustive API dump where a map was asked for, invented subsystems. |

Two of those five are reinterpretations, and a reinterpretation that lives only
in a document like this one is a reinterpretation that will drift. The honest
version is a docs-specific criteria set — accuracy, completeness, usefulness,
structure, honest uncertainty, which is what `rubric.md` already uses — and that
is a change to `RUBRIC_CRITERIA` in `scripts/conductor_bench.py`, not something
a manifest can express.

Note what is *not* on the list: nothing here scores prose style, and nothing here
asks a reviewer to guess whether a document is "good". Every axis is a question
with a checkable answer, which is what makes two reviewers' medians comparable.

## The sample

`stratified_review_sample` strata are (tier, arm). With three arms and one docs
tier, `--review-sample 1` yields three cells — one per arm — which is the
minimum that lets the report's per-arm medians mean anything, and it is one
document per arm to read. `--review-sample 2` doubles it. The sample is drawn
from the plan and not from the results, so it is fixed before anybody knows
which cells passed, which is the property that stops a reviewer from
unconsciously sampling the interesting failures.

## What has to change first

Three things, none of which this material can do on its own.

1. **`RUBRIC_CRITERIA` would have to gain a docs-shaped set**, or the two
   reinterpretations above become folklore. That is an edit to
   `scripts/conductor_bench.py` and its test.
2. **The targets have to become hermetic.** A vendored or content-addressed
   checkout, small enough to live under the per-directory ceiling that
   directory-sourced seeds are held to. The current targets are 56k to 600k
   lines each; a subsystem-sized slice at a pinned content hash is the realistic
   shape, and it changes what the task asks for.
3. **The report has to say plainly that a docs task's pass rate is an
   admissibility rate.** Otherwise the `## Per-task pass rates` table will carry
   a docs row next to a conformance row and read as though the two numbers mean
   the same thing.

Until those three are done, a docs-generation task in a manifest would be a cell
that reports a number nobody should use. It is not here, and that is the finding.
