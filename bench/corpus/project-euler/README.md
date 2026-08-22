# Project Euler bench tasks

Twenty bench tasks, one per Project Euler problem the answer key here holds a
verified answer for and this repository can ask for in its own words.

Nothing here is edited by hand except the two files named as inputs below.
`bench/corpus-euler.json`, `seed/` and `hidden/` are written by
`scripts/generate_euler_tasks.py`, and `--check` is the guard that says so:

```sh
/usr/bin/python3 scripts/generate_euler_tasks.py            # rewrite everything
/usr/bin/python3 scripts/generate_euler_tasks.py --check    # verify, write nothing
```

## What is committed, and what is not

| File | Origin |
|------|--------|
| `expected-answers.json` | the answer key: one verified answer per problem, or null where none was verified |
| `hard-subset.json` | the brute-force-proof list: the problems a direct loop cannot finish |
| `restatements.json` | the question each task asks, in this repository's words |
| `seed/` | generated: the work tree every task starts from |
| `hidden/<task>/gauge/` | generated: the measurement, never seeded |

No Project Euler statement, image or data file is committed here, and the
generator reads none. Statement text is copyright Project Euler, so mirroring
it into a committed manifest would redistribute it. Each prompt therefore
states its question from `restatements.json` and is complete without the
statement it replaces, which is what makes this set reproducible on a clone
that has fetched nothing.

`--audit-statements` is the one mode that reads statement text, and it is the
check that keeps the committed prose ours: it writes nothing, and it fails a
restatement that shares a long run of words with the statement it replaces.

**It reads a directory this repository does not carry, and cannot.** The
argument is a directory of fetched statements named `problem-NNN-challenge.md`,
one per problem, three-digit zero-padded. Committing that directory is the
redistribution the paragraph above refuses, and `restatements.json` cannot
stand in for it — auditing this repository's prose against itself compares a
string with a copy of itself and passes by construction. So the audit is an
operator's tool for a machine that has fetched the statements itself, and a
clone that has fetched none runs the generator without it:

```sh
/usr/bin/python3 scripts/generate_euler_tasks.py \
    --audit-statements <statements-dir> \
    --require-statements
```

Without `--require-statements` a missing statement file is reported by name and
is not a failure, which is what makes the flag usable over a partial fetch.

It composes with `--check`, which is the other reading mode: the pair audits
the prose and reports any generated file that has drifted from what the inputs
would produce. Regenerating is a plain run with neither flag, and that is the
only invocation that writes.

## The shape of a task

The seed is a solver registry: `src/registry.py`, one module per problem under
`src/solvers/`, and a command line over both. Two worked solvers ship with it,
`sum_of_squares` and `count_divisors`, and neither is a Project Euler problem —
which is what lets the set cover problems 1 and 2 as well, because no seeded
work tree contains any Euler answer for any task.

Every task draws the same `seed/`. The task's whole difference is its prompt
and its gauge, so one seed tree on disk is what the set actually is.

The gauge asks for the registered answer, that the module registers itself
under its own module name, that the two worked solvers still answer, that the
command line still lists and runs, and that the answer was computed rather than
written down or read from anywhere.

That last pair is two checks. The first parses every module under `src/`, folds
every expression whose own text decides it, and refuses any that comes to the
answer — so `233168`, `233000 + 168`, `int("2331" + "68")` and a constant parked
in `src/tables.py` and imported back are one shape, not four. The second refuses
a module that calls `open`, `input`, `eval`, `exec`, `compile` or `__import__`,
or imports anything outside `src` and the computation modules the prompt lists.
Both rules are stated in the prompt, so no run is graded on something it was not
told. Neither can see a derivation the model recalled whole and then wrote out
as working code, and the manifest says so.

## Six answerable problems get no task

Problems 8, 11, 13 and 18 carry the data they operate on inside the statement,
and problems 22 and 67 read a data file the source corpus fetches and
gitignores. Each has its reason recorded beside its answer in
`restatements.json`, and the generator prints it on every run.
