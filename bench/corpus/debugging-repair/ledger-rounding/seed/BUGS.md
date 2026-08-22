# Open field reports

Four reports against this book-keeping package. Each was reproduced by the
reporter against this working copy. None names a module, a function or a line:
locating the fault is the work.

The README and the docstrings state the intended contracts. Where the code and
a stated contract disagree, the contract is right.

## FR-1 — per-account balances are a cent adrift on the real journal

Closing balances for the full 820-posting journal do not equal the exact sum of
the postings they aggregate: seven of the seventeen accounts come out one minor
unit short. Re-running with the postings in a different order moves which
accounts are wrong, so the aggregation is not order-independent either.

The short, round-numbered fixtures the rest of the suite uses come out right,
which is why this was only noticed on the real data.

Balances must stay integer minor units and stay sorted by account name.

## FR-2 — a monthly period excludes its own last day

A reporting period is half-open, `[start, end)`. A month's period is built with
the wrong end, so the last day of the month falls outside it: January 2024
reports thirty days of activity, activity dated the 31st lands in no period at
all, and consecutive months do not tile the calendar — one month's end and the
next month's start are a day apart. Quarters are built from month boundaries and
inherit the same hole.

Widening the membership test to include the end date is not the repair: periods
would then share a boundary day with the period after them, and a period must
still exclude the day it ends on.

## FR-3 — an allocation loses the remainder and the book stops balancing

Splitting an amount across weighted destinations discards whatever does not
divide evenly. Splitting 1.00 three ways yields 33 + 33 + 33 = 0.99, and the
missing cent never reaches an account, so the postings of that transaction no
longer net to zero. Sixty-three of the three hundred and thirty-six sample
transactions are affected.

Every minor unit must land somewhere, deterministically, and an even split must
leave no two shares differing by more than one minor unit — so handing the whole
remainder to the first or the last destination is not the repair. The existing
weight ratios and the order the shares come back in must not change.

## FR-4 — a second reconciliation of the same statement reports duplicates

The first reconciliation of a period looks right. Every later one reports the
same statement lines as duplicates and matches nothing — including a
reconciliation of a *different* account, and including one performed by a
freshly constructed reconciler. State that should belong to one reconciliation
is outliving it.

The intended contract is that a reference is reconciled once within one
statement, so a statement that genuinely lists the same reference twice must
still report the second occurrence as a duplicate. The command-line report
reconciles only once, so it looks healthy.
