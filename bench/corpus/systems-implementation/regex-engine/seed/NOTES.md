# `regex-engine` — implementation notes

## What this workspace is

A partial implementation of `SPEC.md`. The harness protocol is complete, the
parser covers the whole dialect of §4 with every compile error of §7 at the
right code point, and the compiler emits the instruction program of §9 with
normalised classes and expanded bounds.

The last graded run of this workspace, against the 884-case conformance suite,
reported:

```
GROUP             CASES   PASS   FAIL
alternation          35     35      0
anchors              50     50      0
bounded              98     93      5
captures             50     49      1
classes              59     59      0
dot                  35     34      1
empty-repeat         20     20      0
errors              105    105      0
escapes              36     36      0
findall              44     44      0
literals            108    108      0
pathological         23     10     13
program              44     44      0
protocol             29     29      0
quantifiers          95     71     24
unicode              53     53      0
TOTAL               884    840     44
PASS RATE 95.02%
RESULT FAIL
```

Every one of the 44 failures is attributable to one of the two requirements
below. Thirteen of them are wall-clock failures in `pathological`, which the
runner reports as harness restarts.

## Unimplemented

### §10 and §11 — the linear-time simulation

`src/matcher.py:run_at` walks the compiled program depth first with an explicit
backtracking stack, and `src/matcher.py:search` finds an unanchored match by
trying every start offset in turn. That is correct on the preference order of
§5.3 and on the capture rules of §5.4, and it is neither of the two things §10
requires:

- it is not `O(n * m)`. Restarting the simulation at every start offset is
  `O(n^2 * m)`, which §10 names explicitly as the thing not to do, and the
  nested quantifiers of §11 drive the depth-first walk through an exponential
  number of paths;
- the unanchored search is not a single pass.

The whole `pathological` group is this one requirement, measured. Each of its
cases pairs a pattern with a subject and a hard wall clock that a backtracking
matcher cannot meet on any machine; a reply that arrives late fails the case and
the runner kills and restarts the harness.

What replaces it is the thread-list simulation §12 points at: at each input
position a set of program counters, each carrying its own capture slots, held in
priority order, with a guard that discards a thread reaching an instruction it
has already reached at that position. `split` forks, higher-priority target
first; `save` writes a slot in the current thread's capture array; `match`
records that thread's captures and cuts every lower-priority thread. For the
unanchored search, add a new lowest-priority start thread at each position and
stop adding once a match has been recorded.

Two things that are easy to get wrong and that the suite checks directly:
capture writes belong to the thread that made them, so two threads exploring
different branches must not share one capture array (§5.4); and the duplicate
guard is what pins the empty-iteration semantics of §5.6, which this workspace
already satisfies and must keep satisfying.

### §5.3 — lazy preference order

`src/parse.py` records a quantifier's preference in the node - `("rep", body,
low, high, greedy)` - and `src/compile.py:_emit_rep` does not read it. Every
`split` the lowering emits prefers one more iteration, so `a*?`, `a+?`, `a??`,
`a{m,}?` and `a{m,n}?` all behave as their greedy spellings.

The consequence is exactly the 31 non-`pathological` failures above: every one
of them is a pattern with a lazy quantifier in it. Preference never changes
*whether* a match exists, only which one is reported, so nothing else moves.

Fixing this means giving `_emit_rep`, `_emit_star` and `_emit_plus` the flag and
swapping the two targets of the loop's `split` when it is false: a lazy
repetition prefers to leave the loop before trying one more iteration. The exact
count expansion `x{m}` is unaffected - §4.5 pins `x{m}?` as identical to `x{m}`,
because an exact count offers no choice.

## Requirements index

| Section | Requirement                                                    | Where                                    |
| ------- | -------------------------------------------------------------- | ---------------------------------------- |
| §2      | `build.sh`, `run.sh`, `test.sh`, reached through `bash`          | `build.sh`, `run.sh`, `test.sh`          |
| §3.1    | Harness lifecycle; EOF exits 0; a compile error is a reply       | `src/main.py:serve`                      |
| §3.2    | Line framing, LF only, no fixed line buffer                      | `src/main.py:serve`                      |
| §3.3    | Wire strings, per byte, before UTF-8 decoding                    | `src/wire.py:decode_token`               |
| §3.4    | The five requests and their exact field counts                   | `src/main.py:ARITY`, `src/main.py:handle` |
| §3.5    | Reply shapes; code point offsets; `-1 -1` for a dead group       | `src/main.py:handle`                     |
| §3.6    | Protocol errors: unknown verb, bad request, empty line           | `src/main.py:handle`                     |
| §4.1    | The grammar, including empty branches                            | `src/parse.py:Parser`                    |
| §4.2    | Metacharacters; stray `]` and `}` are errors, not literals       | `src/parse.py:_concat`                   |
| §4.3    | Escapes, including `\xHH` and the six shorthand classes          | `src/parse.py:_escape_body`              |
| §4.4    | Character classes, ranges, negation, the literal roles of `-`    | `src/parse.py:_class`                    |
| §4.5    | Repetition forms and their bounds                                | `src/parse.py:_bound`                    |
| §4.6    | Capture and non-capturing groups; `(?` is unsupported            | `src/parse.py:_group`                    |
| §5.1    | Code point offsets, not byte offsets                             | `src/main.py:handle`                     |
| §5.2    | Leftmost-first, not leftmost-longest                             | `src/matcher.py:search`                  |
| §5.3    | Greedy preference order                                          | `src/compile.py:_emit_rep`               |
| §5.3    | Lazy preference order                                            | **unimplemented** — see above            |
| §5.4    | Capture semantics, including the last completed iteration        | `src/matcher.py:run_at`                  |
| §5.5    | `^`, `$`, `\b`, `\B` against the whole subject                   | `src/matcher.py:holds`                   |
| §5.6    | The pinned empty-iteration rule                                  | `src/matcher.py:run_at`, `src/compile.py:_emit_star` |
| §5.7    | The `FIND` scan, including an empty match after a non-empty one  | `src/matcher.py:find_all`                |
| §6      | Word characters, shorthand classes, `.`; all ASCII-only          | `src/parse.py`                           |
| §7      | The twelve codes, each at the position a single parse reaches    | `src/errors.py`, `src/parse.py`          |
| §8      | The repetition and program-size ceilings                         | `src/parse.py:MAX_REPEAT`, `src/compile.py:compile_pattern` |
| §9.2    | The instruction set and its encoding rules                       | `src/compile.py:format_instruction`      |
| §9.2    | Class ranges sorted, disjoint and merged                         | `src/parse.py:merge_ranges`              |
| §9.3    | Program well-formedness                                          | `src/compile.py:compile_pattern`         |
| §9.4    | The dump format                                                  | `src/main.py:handle`                     |
| §10     | `O(n * m)` matching and a single-pass unanchored search          | **unimplemented** — see above            |
| §11     | The catastrophic-backtracking guard                              | **unimplemented** — see above            |

## Design decisions

- **Compile once, then run the program.** The matcher never sees the node tree.
  That is what makes `PROGRAM` an inspection of the thing that actually runs
  rather than of a second, parallel description of the pattern, and it is what
  the simulation §10 asks for will be built on.
- **`x*` is lowered as an optional `x+`.** One `split` guards entry to the body
  and a second closes the loop, rather than a back-jump to the first. The two
  forms accept the same language, but keeping the loop's exit edge distinct from
  its entry edge is what lets a matcher leave a body that matched the empty
  string with that iteration's capture writes intact, which is what §5.6 pins.
- **The duplicate guard is path-local.** `run_at` withdraws every `(pc, pos)` it
  recorded when the path that recorded it is abandoned. A guard that kept them
  would memoise failure across branches, which would be a different algorithm
  with a different cost, and would hide the cost §11 is there to measure.
- **Classes are computed as code point sets.** A negated shorthand inside a
  class contributes its complement to the union, and the class's own `^` is a
  polarity flag on the result, so `[^\W\d]` is one `class` instruction and not a
  special case.
- **Subjects are lists of code point values.** Every offset in every reply is an
  index into that list, so §5.1 needs no conversion anywhere.
