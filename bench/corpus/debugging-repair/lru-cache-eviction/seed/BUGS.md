# Open field reports

Four reports against this cache. Each was reproduced by the reporter against
this working copy. None names a file, a function or a line: locating the fault
is the work.

The header comments and README state the intended contracts. Where the code and
a stated contract disagree, the contract is right. The build must stay free of
warnings under `-Wall -Wextra -Wpedantic -Wshadow -Wnon-virtual-dtor`.

## FR-1 — a key written as the table grows becomes unreadable

A key written on the insert that crosses the load-factor threshold cannot be
read back afterwards, not even immediately after its own write. The entry is
still counted by `size()`, still weighted into `weight()` and still listed by
`keys_mru_first()`; only the lookup path cannot reach it. Writing the same key
again therefore inserts a second entry under it, and the distinct-key count
comes out one too high.

It shows about half the time per growth event, and a later growth event hides
the damage again, which is why the reproduction checks readability at the write
as well as at the end of the run.

Tombstone handling and probing are correct as they stand: an erased key must
still not block a later lookup on the same chain.

## FR-2 — reclamation stops at the first entry that is still alive

Reclaiming timed-out entries only releases the ones that happen to sit at the
cold end of the recency list, and stops at the first live entry it meets. Every
timed-out entry behind that one survives.

Lifetimes are per entry and a read moves an entry to the hot end, so a live
entry at the cold end is ordinary, not exceptional. The consequence is backwards
from the stated policy: with nothing reported as reclaimed, the capacity loop
falls through and evicts a live entry while a timed-out one stays resident.

Plain recency ordering must not change, an entry with no lifetime must still
never time out, and the reclaim path frees the entries it drops — so a repair
that reads through a node after releasing it is not a repair.

## FR-3 — rewriting a key inflates the resident weight until the cache empties

Overwriting an entry adds the incoming weight to the resident total without
releasing the weight the entry already held. `size()` and the entries stay
correct while the total drifts upward by the old weight on every rewrite.

The cache then believes it is over capacity and evicts entries that fit. The
inflated residue is never recovered, so enough rewrites of a single key evict
every other entry and finally empty the cache while the total still stands.

Recomputing the total by walking the entries, or clamping it where it is
reported, hides this rather than repairing it. The capacity ceiling and the
refusal of an entry heavier than the whole capacity must keep working.

## FR-4 — copy-assigning through an alias empties the cache

Assigning a cache from itself through a reference or another alias leaves it
empty: zero entries, zero weight, no recency list. Self-assignment must leave
the object unchanged.

Copy assignment from a *different* cache must keep replacing the destination's
contents, so turning the operator into a no-op is not the repair. Move
assignment is written with the swap idiom and is already self-safe; it is not
part of this report.
