# TUI Games — Task 6 of 8: `roguelike`

## 1. Objective

Build a complete, playable, traditional roguelike as a terminal application in {{LANGUAGE}}:
a multi-level procedurally generated dungeon explored one turn at a time, with symmetric
shadowcasting field of view and explored-map memory, A*-driven monsters with distinct
behaviours, an energy-based turn scheduler so fast and slow actors interleave correctly,
inventory with equipment slots and cursed/unidentified items, status effects, hunger,
experience and levelling, exact-round-trip save/load, permadeath with a death log, and a
scrollable message log. Everything must be reproducible from a single integer seed, and the
program must be drivable without a terminal so a script can score it. This is the largest
single-application task on the ladder: the code must be split into coherent modules, and the
module structure is scored.

Read `CONVENTIONS.md` at the repository root before you write anything. It defines run IDs,
the workspace layout, `run.json`, the `build.sh` / `run.sh` / `test.sh` contract, and how your
work is scored. This prompt does not restate it.

## 2. Substitution variables

| Variable       | Meaning                                                                     | Example                      |
| -------------- | --------------------------------------------------------------------------- | ---------------------------- |
| `{{LANGUAGE}}` | Language slug for this run; one of `rust`, `go`, `cpp`, `python`, `ts`      | `rust`                       |
| `{{RUN_ID}}`   | Run ID as defined in `CONVENTIONS.md` §3, `<model-slug>__<harness-variant>` | `qwen3.6-27B__llama-harness` |

## 3. Workspace

All your files go in exactly one directory:

```
tui-games/solutions/{{RUN_ID}}/roguelike/{{LANGUAGE}}/
```

Resolved example for `{{RUN_ID}}` = `qwen3.6-27B__llama-harness` and `{{LANGUAGE}}` = `rust`:

```
tui-games/solutions/qwen3.6-27B__llama-harness/roguelike/rust/
```

Create it with `tools/new_workspace.sh {{RUN_ID}} roguelike {{LANGUAGE}}` and fill in
`run.json` as `CONVENTIONS.md` §5 requires. Write nothing outside that directory. In
particular `tui-games/tasks/roguelike/` is read-only reference material (`CONVENTIONS.md` §10).

---

## 4. Functional requirements

Every numbered requirement below is independently checkable. Where a number, formula, table,
or tie-break rule is given, implement it exactly as written — two different implementations of
this task are compared against these same values, so "something equivalent" is wrong.

### 4.1 Determinism and randomness

**R1.** The program takes `--seed <n>`, a non-negative 64-bit integer. The entire game is a
pure function of the seed and the sequence of input keys. `--seed` is mandatory in headless
mode (§6). In interactive mode, if it is omitted, derive a seed from OS entropy and print it
as the first message in the message log.

**R2.** All randomness comes from SplitMix64, implemented exactly as:

```
next_u64(state):            # state is u64, all arithmetic wrapping mod 2^64
    state = state + 0x9E3779B97F4A7C15
    z = state
    z = (z XOR (z >> 30)) * 0xBF58476D1CE4E5B9
    z = (z XOR (z >> 27)) * 0x94D049BB133111EB
    return z XOR (z >> 31)
```

For an initial state of `0`, the first five outputs must be exactly:

```
0xE220A8397B1DCDAF
0x6E789E6AA1B965F4
0x06C45D188009454F
0xF88BB8A8724C81EC
0x1B39896A51A8749B
```

**R3.** Bounded draws are defined as `rng_int(lo, hi) = lo + (next_u64() mod (hi - lo + 1))`,
inclusive on both ends. `d(n) = rng_int(1, n)`. `NdM` is the sum of `N` successive `d(M)`
draws, evaluated left to right. `rng_bool(p_percent)` is `rng_int(1, 100) <= p_percent`.
Shuffles are Fisher–Yates from the last index down: `for i = len-1 down to 1: j = rng_int(0, i);
swap(a[i], a[j])`. Do not use any language-provided RNG, hash map iteration order, or
wall-clock value anywhere in game logic.

Two ordering conventions make every "random" and every "farthest" phrase in this prompt exact,
and both are mandatory wherever such a phrase appears. **Draws:** a rule that draws from a set
of tiles enumerates that set in row-major order (`y` ascending, then `x` ascending within a
row) and indexes it with `rng_int(0, count - 1)`; a rule that draws from a set of ids
enumerates the legal ids in the order this prompt's table lists them. **Extrema:** a rule that
selects a maximum or a minimum breaks ties by lowest `y` then lowest `x` over tiles, by lowest
room index over rooms, and by lowest actor id over actors.

**R4.** There are exactly two RNG streams:

- the **map stream** for depth `d`, seeded with `seed + 0x9E3779B97F4A7C15 * d` (wrapping);
- the **game stream**, seeded with `seed XOR 0xD1B54A32D192ED03`, used for everything else
  (combat, AI, item generation on pickup-independent events, wandering spawns, appearance
  shuffling, level-up rolls).

Because each level has its own map stream, the initial layout of depth `d` is a pure function
of `(seed, d)` and does not depend on when the player first arrives there.

### 4.2 Dungeon generation

**R5.** The dungeon has exactly 8 levels, depth 1 (top) through 8 (bottom). Each level is a
grid of 80 columns × 40 rows. Column 0, column 79, row 0, and row 39 are always wall.

**R6.** Levels are generated by binary space partitioning, in this exact shape:

```
MIN_LEAF_W = 12, MIN_LEAF_H = 8, MAX_SPLIT_DEPTH = 4
split(node, depth):
    if depth == MAX_SPLIT_DEPTH: emit leaf(node); return
    can_split_v = node.w >= 2 * MIN_LEAF_W      # vertical cut, splits width
    can_split_h = node.h >= 2 * MIN_LEAF_H      # horizontal cut, splits height
    if not can_split_v and not can_split_h: emit leaf(node); return
    if can_split_v and can_split_h:
        if node.w * 4 > node.h * 5:      axis = vertical
        elif node.h * 4 > node.w * 5:    axis = horizontal
        else:                            axis = vertical if rng_bool(50) else horizontal
    else:
        axis = vertical if can_split_v else horizontal
    if axis == vertical:
        cut = rng_int(MIN_LEAF_W, node.w - MIN_LEAF_W)
        split(left part of width cut, depth+1); split(right part, depth+1)
    else:
        cut = rng_int(MIN_LEAF_H, node.h - MIN_LEAF_H)
        split(top part of height cut, depth+1); split(bottom part, depth+1)
```

The root node is the rectangle `x=1, y=1, w=78, h=38`. Leaves are emitted in depth-first
order, first child before second child; that order is the room index order.

**R7.** Each leaf gets one room: `rw = rng_int(5, min(leaf.w - 2, 16))`,
`rh = rng_int(4, min(leaf.h - 2, 10))`, `rx = leaf.x + rng_int(0, leaf.w - rw - 1)`,
`ry = leaf.y + rng_int(0, leaf.h - rh - 1)`. Every tile of the room rectangle becomes floor.
Rooms never touch the map border because leaves never do.

**R8.** Corridors: for every internal BSP node, connect the room whose index is lowest in its
left/top subtree to the room whose index is lowest in its right/bottom subtree, using an
L-shaped corridor between room centres — horizontal segment first then vertical if
`rng_bool(50)`, otherwise vertical then horizontal. Corridor tiles that are wall become floor;
tiles that are already floor are left alone. Then add `rng_int(2, 4)` extra corridors between
two distinct rooms chosen with `rng_int(0, room_count-1)` (reroll if equal), using the same
L-shape rule, to create loops.

**R9.** Doors: after all corridors are carved, scan the map in row-major order; every floor
tile that (a) lies on a room's
rectangle boundary ring, (b) has exactly two passable orthogonal neighbours, and (c) those two
neighbours are opposite each other, becomes a closed door with probability 60%
(`rng_bool(60)`). Doors are closed on generation. Moving into a closed door opens it (costing
a full action) rather than moving through it. Closed doors block movement and sight; open
doors block neither.

**R10.** Stairs: the up staircase `<` is placed on a random floor tile of room 0; the down
staircase `>` on a random floor tile of the room whose centre is at the greatest Chebyshev
distance from room 0's centre (ties by lowest room index, per R3). Depth 8 has no `>`.
Depth 1's `<` is the dungeon exit.

**R11.** Connectivity is guaranteed, not hoped for. After generation, flood fill (4-way,
through floor, doors, and stairs) from `<`. If any floor tile is unreachable, repeatedly take
the unreachable floor tile nearest (Manhattan) to any reachable floor tile and carve an
L-corridor between them, then re-flood, until every floor tile is reachable. The `--selftest`
mode must assert this property (§6).

**R12.** Levels persist. Once generated, a level keeps its state — monster positions and HP,
dropped and picked-over items, opened doors, explored tiles — when the player leaves and
returns. Arriving by `>` places the player on that level's `<`; arriving by `<` places the
player on that level's `>`.

**R13.** The Amulet of Yendor is placed on a random floor tile of depth 8, in the room whose
centre is at the greatest Chebyshev distance from that level's `<` (ties by lowest room index,
per R3). Picking it up sets a flag. The player wins by carrying it to
depth 1 and pressing `<` on the up staircase; the game ends with status `escaped`.

### 4.3 Field of view

**R14.** Field of view is **symmetric shadowcasting**: the eight-octant recursive shadowcast
in which a tile is visible when its centre is inside the un-shadowed slope range and, for wall
tiles, when any part of it is. It must be symmetric: for any two floor tiles A and B within
radius, an actor at A sees B if and only if an actor at B sees A. Sight radius is 8 (Chebyshev
bound: no tile with `max(|dx|,|dy|) > 8` is ever visible). Walls and closed doors block sight;
open doors, floors, stairs, items, and other actors do not.

**R15.** The player's map memory: every tile that has been visible at least once is
"explored". Explored-but-not-currently-visible terrain (walls, floors, doors, stairs) is drawn
dimmed from memory. Items are remembered at the position where they were last seen. Monsters
are **never** drawn from memory — only when currently visible.

**R16.** Monsters use the same FOV routine with their own sight radius (8 unless the monster
table says otherwise) to decide whether they can see the player.

### 4.4 Turn scheduling

**R17.** Time is energy-based, not round-robin. Every actor has `speed` (energy per tick) and
`energy` (starts at 0). The scheduler is exactly:

```
tick():
    turn_counter += 1
    for each living actor, in ascending actor-id order: actor.energy += actor.speed
    while some living actor has energy >= 100:
        a = the living actor with the highest energy; ties broken by lowest actor id
        act(a)                      # act() subtracts the action's cost from a.energy
```

The player is actor id 0, so the player wins all ties. Baseline speed is 100; hasted is 150,
slowed is 50; monster speeds come from the table in §4.5.

**R18.** Action costs, subtracted from the acting actor's energy:

| Action                                                                                 | Cost |
| -------------------------------------------------------------------------------------- | ---- |
| Move, attack, wait, open door, ascend/descend, quaff, read, eat, equip, unequip, throw | 100  |
| Pick up, drop                                                                          | 50   |

Every other key costs no energy and does not advance the scheduler: opening or dismissing an
overlay (`i`, `m`, `x`, `?`), cancelling a prompt (`Esc`), the automatic gold pickup of R26
(the move that triggers it still costs 100), saving (`S`), quitting (`Q`), and any key with no
binding in the current context. A zero-cost key never changes `turn_counter` — that is what
makes the split save/load run of H8.4 byte-identical to the unsplit run.

**R19.** The consequence of R17/R18 is exact and is asserted by `--selftest`: over 1000 ticks,
a speed-150 actor takes exactly 1500 actions, a speed-100 actor exactly 1000, and a speed-60
actor exactly 600, when every action costs 100.

### 4.5 Monsters and AI

**R20.** Monster table. `acc` is accuracy, `dmg` is the damage dice, `arm` is armor, `eva` is
evasion, `spd` is speed, `xp` is experience granted on kill, `depths` is the inclusive depth
range in which the monster may be generated.

| id       | name          | glyph | hp  | acc | dmg  | arm | eva | spd | xp  | behaviour    | depths |
| -------- | ------------- | ----- | --- | --- | ---- | --- | --- | --- | --- | ------------ | ------ |
| `rat`    | giant rat     | `r`   | 4   | 2   | 1d3  | 0   | 3   | 120 | 2   | melee chaser | 1–3    |
| `kobold` | kobold        | `k`   | 6   | 3   | 1d5  | 1   | 2   | 100 | 4   | melee chaser | 1–4    |
| `archer` | goblin archer | `g`   | 7   | 4   | 1d4  | 1   | 3   | 100 | 6   | ranged       | 2–5    |
| `zombie` | zombie        | `z`   | 14  | 4   | 1d8  | 2   | 0   | 60  | 8   | sleeper      | 3–6    |
| `imp`    | cave imp      | `i`   | 9   | 5   | 1d6  | 1   | 5   | 130 | 10  | coward       | 3–7    |
| `ogre`   | ogre          | `O`   | 24  | 6   | 2d6  | 3   | 1   | 80  | 20  | melee chaser | 5–8    |
| `wraith` | wraith        | `W`   | 18  | 7   | 1d10 | 4   | 4   | 110 | 25  | melee chaser | 6–8    |
| `whelp`  | dragon whelp  | `d`   | 30  | 8   | 2d8  | 5   | 2   | 100 | 40  | ranged       | 7–8    |

**R21.** Population: on generation, a level at depth `d` receives `4 + d` monsters, each of a
type drawn uniformly from the types whose `depths` range contains `d`, each placed on a random
floor tile at least 10 tiles (Chebyshev) from the level's `<`. Thereafter, every 150 ticks one
additional monster of a legal type spawns on a random floor tile that is not currently visible
to the player, unless the level already holds 20 living monsters.

**R22.** Pathfinding is A* on the 8-connected grid: uniform step cost 1, Chebyshev distance
heuristic, walls and closed doors impassable, other actors impassable, diagonal movement
allowed only if at least one of the two adjoining orthogonal tiles is passable. The open set
is ordered by `(f, h, y, x)` ascending, so the path is deterministic. Cap expansion at 2000
nodes; if the cap is hit, fall back to a single greedy step that reduces Chebyshev distance to
the goal. A* must return a shortest path — `--selftest` compares its length against BFS.

**R23.** Four behaviours, each implemented as written:

1. **melee chaser** — If the player is visible, record the player's position as
   `last_known` and A*-path toward it; if already adjacent (Chebyshev 1), attack instead of
   moving. If the player is not visible but `last_known` is set, path to `last_known`; on
   arriving there, clear it. With no target, move to a uniformly chosen passable adjacent tile
   (`rng_int` over the passable neighbours in the fixed order N, NE, E, SE, S, SW, W, NW), or
   wait if there are none.
2. **ranged** — If the player is visible and the Chebyshev distance is between 2 and 6
   inclusive and the projectile line (R24) is clear, make a ranged attack. If the distance is
   1, step to the adjacent passable tile that maximises Chebyshev distance from the player
   (ties broken by the fixed neighbour order above); if no such tile exists, attack in melee.
   If the distance is greater than 6, path toward the player as a melee chaser does.
3. **coward** — Behaves as a melee chaser while `hp * 10 > max_hp * 3` (that is, above 30% HP).
   At or below 30%, it flees: A*-path toward the reachable tile within 12 steps that maximises
   Chebyshev distance from the player (ties by lowest `y` then lowest `x`, per R3). If it is
   adjacent to the player and no fleeing move exists, it attacks. Fleeing monsters at or below
   30% HP never make ranged or melee attacks unless cornered.
4. **sleeper** — Starts asleep and takes no action while asleep. On each of its turns it wakes
   if the player is adjacent, or if it took damage since its last turn, or if the player is
   within Chebyshev distance 5 and `rng_bool(25)`. Once awake it is a melee chaser and never
   sleeps again.

**R24.** Ranged attacks and thrown items travel along a Bresenham line from source to target
(when `|dx| >= |dy|`, step along x and accumulate error on y; otherwise step along y; on an
exact half-step tie, round toward the source). The projectile stops at the first wall or
closed door (it misses) or the first actor on the line (it resolves against that actor, which
may not be the intended target). Ranged attacks use the same combat resolution as melee (§4.7)
with accuracy reduced by 1 per tile of distance beyond 3.

### 4.6 Items, inventory, equipment

**R25.** Inventory holds at most 26 stacks, addressed by the letters `a`–`z`. A new stack takes
the lowest free letter; letters freed by dropping or consuming become available again. Item
glyphs: `!` potion, `?` scroll, `%` food, `)` weapon, `[` body or head armor, `=` ring,
`*` gold, `"` the Amulet.

**R26.** Consumables (potions, scrolls, food) stack by type: identical types occupy one slot
with a count. Equipment never stacks — each weapon, armor piece, and ring is a distinct
instance with its own enchantment and curse state. Gold is a counter, not an inventory stack;
walking over gold picks it up automatically at no action cost.

**R27.** Four equipment slots: `weapon`, `body`, `head`, `ring`. Equipping into an occupied
slot first unequips the current occupant (one action total). Equipping cannot be undone if the
item turns out to be cursed (R31).

**R28.** Item tables.

Weapons (`)`), effect is `dmg` dice and an accuracy modifier:

| id            | name        | dmg | acc | depths |
| ------------- | ----------- | --- | --- | ------ |
| `dagger`      | dagger      | 1d4 | +1  | 1–8    |
| `short_sword` | short sword | 1d6 | 0   | 1–8    |
| `mace`        | mace        | 1d8 | −1  | 2–8    |
| `battle_axe`  | battle axe  | 2d4 | −1  | 4–8    |
| `war_hammer`  | war hammer  | 2d6 | −2  | 6–8    |

Armor (`[`):

| id        | name          | slot | armor | evasion | depths |
| --------- | ------------- | ---- | ----- | ------- | ------ |
| `leather` | leather armor | body | 2     | 0       | 1–8    |
| `chain`   | chain mail    | body | 4     | −1      | 3–8    |
| `plate`   | plate armor   | body | 6     | −2      | 5–8    |
| `cap`     | leather cap   | head | 1     | 0       | 1–8    |
| `helm`    | iron helm     | head | 2     | 0       | 3–8    |

Rings (`=`), all depths 2–8:

| id                  | name                 | effect                                                   |
| ------------------- | -------------------- | -------------------------------------------------------- |
| `ring_protection`   | ring of protection   | armor +2                                                 |
| `ring_accuracy`     | ring of accuracy     | accuracy +3                                              |
| `ring_regeneration` | ring of regeneration | applies the `regenerating` status permanently while worn |
| `ring_hunger`       | ring of hunger       | nutrition drain doubled                                  |
| `ring_weakness`     | ring of weakness     | melee damage −2                                          |

Potions (`!`), all depths 1–8:

| id                     | name                    | effect on quaff                                 |
| ---------------------- | ----------------------- | ----------------------------------------------- |
| `potion_healing`       | potion of healing       | heal `4d4`, capped at max HP                    |
| `potion_extra_healing` | potion of extra healing | heal `6d6`, capped at max HP, and `max_hp += 1` |
| `potion_speed`         | potion of speed         | `hasted` for 20 turns                           |
| `potion_confusion`     | potion of confusion     | `confused` for 12 turns                         |
| `potion_poison`        | potion of poison        | `poisoned` for 10 turns                         |
| `potion_blindness`     | potion of blindness     | `blind` for 15 turns                            |

Scrolls (`?`), all depths 1–8:

| id                      | name                     | effect on read                                                |
| ----------------------- | ------------------------ | ------------------------------------------------------------- |
| `scroll_identify`       | scroll of identify       | prompts for an inventory letter; identifies that item         |
| `scroll_enchant_weapon` | scroll of enchant weapon | equipped weapon enchantment +1 (no weapon: "nothing happens") |
| `scroll_enchant_armor`  | scroll of enchant armor  | equipped body armor enchantment +1                            |
| `scroll_remove_curse`   | scroll of remove curse   | uncurses every equipped item                                  |
| `scroll_teleport`       | scroll of teleport       | move the player to a uniformly chosen floor tile on the level |
| `scroll_magic_mapping`  | scroll of magic mapping  | marks every tile of the level explored (not visible)          |

Food (`%`), all depths 1–8: `ration` food ration (+800 nutrition), `bread` loaf of bread
(+400 nutrition).

**R29.** Item generation: a level at depth `d` receives `rng_int(3, 7)` items plus
`rng_int(0, 2)` gold piles of `rng_int(10, 40 + 10*d)` gold each, on random floor tiles. Each
item's category is drawn by rolling `rng_int(1, 100)` and taking the first category whose
cumulative weight reaches the roll — potion ≤ 30, scroll ≤ 55, food ≤ 70, weapon ≤ 82,
armor ≤ 94, ring ≤ 100 (weights 30/25/15/12/12/6) — then a legal id for depth `d` is drawn
uniformly within that category, over that category's legal ids in R28 table order. Monsters drop
nothing on death except that a monster killed while carrying nothing leaves no corpse — there
are no corpses in this game.

**R30.** Unidentified items. At game start, shuffle the appearance list below with R3's
Fisher–Yates and pair the shuffled result element-wise with the six potion ids in R28 table
order; then do the same for the label list and the six scroll ids. Potions are shuffled first
and scrolls second, both from the game stream:

```
potion appearances: fizzy blue, murky red, cloudy green, silver, oily black, sparkling
scroll labels:      XYZZY, ELBERETH, NR 9, GNIK SISI VLE, VE FORBRYDERNE, THARR
```

The mapping is per-game and fixed for the whole game. Until a type is identified, it is shown
as "fizzy blue potion" / "scroll labelled XYZZY". A type becomes identified when it is quaffed
or read, or when a scroll of identify is applied to it; from then on every instance of that
type shows its true name, and stacking follows the true type either way. Weapons, armor, and
rings display their base name immediately but their enchantment and curse status only once
identified — an unidentified weapon shows as "short sword", an identified one as
"short sword +1" or "cursed short sword −2".

**R31.** Curses. Each generated weapon, armor piece, and ring is cursed with probability 20%
(`rng_bool(20)`). A cursed instance has enchantment `−rng_int(1, 3)`; an uncursed instance has
enchantment `+1` with probability 20% and `0` otherwise. A cursed item cannot be unequipped
("You cannot remove it — it is welded to you.") until a scroll of remove curse is read.
Equipping a cursed item reveals its curse status (and prints "A malevolent aura surrounds it.").

### 4.7 Combat, statuses, hunger, progression

**R32.** Player derived stats:

```
accuracy = 4 + player_level + weapon.acc_mod + weapon.enchantment + ring_accuracy_bonus
evasion  = 2 + floor(player_level / 3) + sum(armor evasion modifiers)
armor    = sum(equipped armor values + their enchantments) + ring_protection_bonus
damage   = weapon dice + floor(player_level / 2) + weapon.enchantment + ring/status modifiers
```

With no weapon equipped the damage dice are `1d3` and `acc_mod` is 0.

**R33.** Attack resolution, identical for the player and for monsters, melee and ranged:

```
raw = d(20)
if raw == 1:  miss                                  # always
if raw == 20: hit, critical                         # always
else: hit if raw + attacker.accuracy >= 10 + defender.evasion
on hit:
    base = roll(attacker.damage_dice) + attacker.damage_bonus
    dealt = max(1, (2 * base if critical else base) - defender.armor)
    defender.hp -= dealt
```

Monsters use their table `acc` as accuracy, table `dmg` as damage dice, damage bonus 0.
A defender reduced to 0 HP or below dies immediately.

**R34.** Status effects are a single generic system: `{kind, magnitude, remaining}` attached to
any actor. `remaining` decreases by 1 at the start of each of the **affected actor's** own
turns and the effect is removed and announced when it reaches 0. Re-applying a kind sets
`remaining = max(remaining, new_duration)`. Required kinds:

| kind           | effect                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `poisoned`     | 1 damage at the start of each of the actor's turns, before the countdown                               |
| `confused`     | each attempted move has a 50% chance (`rng_bool(50)`) of going in a uniformly chosen direction instead |
| `hasted`       | speed 150                                                                                              |
| `slowed`       | speed 50                                                                                               |
| `blind`        | sight radius 0 (only the actor's own tile is visible); memory is still drawn                           |
| `regenerating` | heal 1 HP every 5th of the actor's turns                                                               |
| `weakened`     | melee damage −2                                                                                        |

**R35.** Hunger. Nutrition starts at 1200 and caps at 2000. Each player action costs 1
nutrition, doubled while a ring of hunger is worn. Thresholds, evaluated after each player
action:

| nutrition | state        | effect                                                              |
| --------- | ------------ | ------------------------------------------------------------------- |
| 1500–2000 | Satiated     | none                                                                |
| 300–1499  | (none shown) | none                                                                |
| 150–299   | Hungry       | none                                                                |
| 50–149    | Weak         | melee damage −1                                                     |
| 1–49      | Fainting     | 20% chance (`rng_bool(20)`) per player turn that the action is lost |
| 0         | Starving     | 1 HP damage per player turn                                         |

Eating above 2000 is refused with "You are too full to eat that." and costs no action.

**R36.** Experience and levels. `xp_threshold(n) = 5 * n * (n - 1)` — level 2 at 10 XP, 3 at
30, 4 at 60, 5 at 100, 6 at 150, 7 at 210, 8 at 280, 9 at 360, 10 at 450, and so on with no
cap. Killing a monster grants its table `xp`. On level up: `max_hp += d(6) + 2` and current HP
increases by the same amount; announce "Welcome to level N.". Multiple levels can be gained
from one kill and each is rolled separately. The player starts at level 1 with 20 max HP.

**R37.** Starting kit: a dagger (uncursed, +0) equipped in `weapon`, leather armor (uncursed,
+0) equipped in `body`, 2 food rations, 1 potion of healing. The dagger, the leather armor,
and the potion-of-healing type start identified: the two equipped items display as `dagger +0`
and `leather armor +0`, and healing potions show their true name. No other type begins
identified. The player starts on depth 1's `<`.

### 4.8 Death, saving, and the message log

**R38.** Permadeath. When the player's HP reaches 0 or below, the game ends immediately with
status `dead`, prints a tombstone screen in interactive mode, appends one line to
`deaths.log` in the process's working directory, and deletes any save file for that game.

**R39.** `deaths.log` is newline-delimited JSON, one object per death, with exactly these keys
in this order: `seed`, `depth`, `turn`, `cause`, `killer`, `player_level`, `xp`, `gold`,
`max_depth`, `timestamp` (ISO-8601 UTC, e.g. `2026-08-20T18:04:31Z`). `cause` is a short
phrase such as `killed by an ogre`, `starved to death`, or `died of poison`; `killer` is the
monster id or `null`.

**R40.** Save and load. `--save <path>` names the save file (default `save.json` in the
working directory). `S` saves and exits with status `saved`; `--load <path>` resumes. The save
must round-trip the **entire** game state exactly: every generated level (tiles, doors,
explored flags, items on the floor), every monster with HP, statuses, AI state (`last_known`,
asleep, ranged cooldowns), the player, inventory letters and stack counts, equipment and
enchantment/curse state, the identification mapping and identified set, gold, nutrition,
turn counter, message log, and **the internal state of both RNG streams**. Continuing from a
load must produce exactly the same subsequent play as if the game had never been interrupted;
`test.sh` verifies this by splitting an input script (§6). The save is a single file, carries
`"format_version": 1`, and loading a file with a different version exits with code 3 and a
clear message. The save file is deleted the moment it is successfully loaded — no save-scumming.

**R41.** Message log. Each of these events emits exactly one message: an attack (hit, miss, or
kill), damage from any other source, a move blocked by terrain, opening a door, picking up,
dropping, equipping or unequipping an item, quaffing, reading or eating and the effect that
follows, a status gained or expiring, a hunger state change (R35), a level-up, taking a
staircase, and a type becoming identified. The log retains the last 200 messages. The bottom
pane shows the most recent 4. Consecutive identical messages collapse into
`You hit the kobold. (x3)`. `m` opens a full-screen history overlay scrollable with
`PgUp`/`PgDn`/`k`/`j`, closed with `Esc`. When more than 4 new messages are generated in
a single turn in interactive mode, show `--more--` and wait for a key.

### 4.9 Interface

**R42.** Minimum terminal 80×24. Fixed layout:

| Rows  | Columns | Content                                                                         |
| ----- | ------- | ------------------------------------------------------------------------------- |
| 0     | 0–79    | status line: `Depth:N HP:h/H Lvl:L XP:x AC:a Gold:g Turn:t <hunger> <statuses>` |
| 1–18  | 0–61    | map viewport, 62×18, camera centred on the player and clamped to the map        |
| 1–18  | 62–79   | sidebar: equipped items, visible monster list with HP bars                      |
| 19–23 | 0–79    | message pane, 4 messages plus one status/prompt line                            |

If the terminal is smaller than 80×24, print a message to stderr naming both the required
minimum (80×24) and the size detected, then exit with code 2. A cell's
glyph is chosen by precedence: player `@` > visible monster > item (top of the stack at that
tile) > terrain (`#` wall, `.` floor, `+` closed door, `'` open door, `<` up, `>` down).

**R43.** Key bindings, exactly:

| Key               | Action                                                        |
| ----------------- | ------------------------------------------------------------- |
| `h j k l y u b n` | move/attack W, S, N, E, NW, NE, SW, SE                        |
| arrow keys        | move/attack W, S, N, E                                        |
| `.`               | wait one turn                                                 |
| `>` / `<`         | descend / ascend (must be standing on the staircase)          |
| `g`               | pick up the top item on this tile                             |
| `i`               | inventory overlay (`Esc` closes)                              |
| `w`               | equip: prompts `Wield/wear what? [a-z, Esc]`                  |
| `T`               | unequip: prompts for the slot letter `w`/`b`/`h`/`r`          |
| `q` `r` `e` `d`   | quaff, read, eat, drop — each prompts for an inventory letter |
| `x`               | examine mode: movement keys move a cursor, `Esc` exits        |
| `m`               | message history overlay                                       |
| `S`               | save and quit                                                 |
| `Q`               | quit without saving, confirmed with `y`                       |
| `?`               | help overlay listing every binding                            |
| `Esc`             | cancel the current prompt or overlay                          |

Any key with no binding in the current context is ignored and consumes no turn.

---

## 5. Technical constraints

**T1.** No game engine, no roguelike toolkit. Explicitly forbidden: libtcod / python-tcod,
bracket-lib / rltk, rot.js, BearLibTerminal, any ECS framework, and any library providing FOV,
pathfinding, dungeon generation, or a game loop. You write those.

**T2.** The terminal layer is raw-mode against platform primitives (termios / `tcsetattr` /
Win32 console, plus ANSI escape sequences) or a **thin** terminal library that only does
raw mode, key decoding, cursor movement, and colour. Permitted examples: `crossterm` or
`termion` (rust), `golang.org/x/term` or `tcell` (go), `<termios.h>` + ANSI or ncurses (cpp),
`termios`/`curses` from the standard library (python), `process.stdin.setRawMode` (ts). Beyond
that, prefer the standard library; vendor anything else, since builds have no network access.

**T3.** Terminal state must be restored on **every** exit path: normal quit, death, `Ctrl-C`
(SIGINT), SIGTERM, an unhandled panic/exception, and an error exit. Restore means: cooked
mode back on, cursor shown, alternate screen left, colours reset. A crash that leaves the
user's shell in raw mode is a hard failure of this requirement.

**T4.** No busy-wait. The interactive loop blocks on input (or polls with a timeout of at
least 10 ms). A loop that spins on a non-blocking read burning CPU fails this requirement.

**T5.** Render budget: on a level with 1000 tiles visible, a full frame must be produced in
under 16 ms (60 fps), measured as the median of 100 consecutive full redraws. Redraw only on
state change, write one buffered frame per redraw (a single write syscall where the language
allows), and do not clear the whole screen every frame.

**T6.** No network access at build time or run time.

**T7.** Module structure is scored. The implementation must be split into at least 16 source
files, each owning one concern, none longer than 600 lines. The floor is 16 because each of
these sixteen concerns lives in a file of its own: RNG, dungeon generation, FOV, pathfinding,
turn scheduler, actor/entity model, monster AI, combat, items and inventory, status effects,
hunger and progression, save/load serialization, rendering, input and key mapping, game state
and loop, headless and selftest driver. The dependency direction is one-way: rules modules
(everything except rendering, input, and the loop) must not import the rendering or input
modules. Document the file →
concern map and the dependency direction in `MODULES.md`.

**T8.** Exit codes: `0` success (including a normal death or quit), `1` runtime error, `2`
usage or terminal-size error, `3` save format version mismatch, `4` `--selftest` failure.

---

## 6. Headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven without a
terminal. Every solution in this category must therefore support both of the following, and
neither may require a TTY, an alternate screen, or any terminal escape output.

```
./run.sh --headless --script <path> --seed <n>
./run.sh --selftest
```

**H1.** `--headless --script <path> --seed <n>` reads a newline-delimited input script, applies
each line as if it had been typed, and on exit prints exactly one line of JSON to **stdout**
summarising the final game state, followed by a single `\n`. Nothing else may go to stdout in
this mode; diagnostics go to stderr. Exit code 0 unless the run itself errored. If the game
ends before the script is exhausted, remaining lines are discarded; if the script is exhausted
while the game is still running, the summary reports `"status":"alive"`.

**H2.** Script format: one key per line. A line is either a single literal character (`h`,
`q`, `a`, `>`), or a bracketed name from exactly this set: `[ESC]`, `[ENTER]`, `[SPACE]`,
`[TAB]`, `[UP]`, `[DOWN]`, `[LEFT]`, `[RIGHT]`, `[PGUP]`, `[PGDN]`. Blank lines and lines whose
first character is `#` are ignored. Any other line is a usage error (exit 2).

**H3.** **Given the same seed and the same input script, the JSON summary must be
byte-identical across runs**, across processes, and across machines of the same architecture.
No timestamps, no addresses, no map/dict iteration order, no floats.

**H4.** The summary object has exactly these keys, in exactly this order, serialised compactly
(`,` and `:` separators with no spaces, keys in insertion order, no trailing whitespace):

| Key              | Type               | Meaning                                                                                                                    |
| ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `schema`         | string             | always `"tui-roguelike/1"`                                                                                                 |
| `seed`           | integer            | the seed the run was given                                                                                                 |
| `turns`          | integer            | value of the scheduler's `turn_counter` at exit                                                                            |
| `depth`          | integer            | current dungeon depth                                                                                                      |
| `max_depth`      | integer            | deepest depth reached this game                                                                                            |
| `status`         | string             | one of `alive`, `dead`, `escaped`, `quit`, `saved`                                                                         |
| `player`         | object             | keys in order: `level`, `xp`, `hp`, `max_hp`, `nutrition`, `accuracy`, `evasion`, `armor` — all integers                   |
| `equipment`      | object             | keys in order `weapon`, `body`, `head`, `ring`; each the item's display name as the player currently knows it, or `"none"` |
| `inventory`      | array of strings   | one entry per stack in letter order, formatted `"a) 2 food rations"`                                                       |
| `statuses`       | array of strings   | active player statuses as `"poisoned:7"` (kind, colon, remaining turns), sorted by kind ascending                          |
| `gold`           | integer            | gold carried                                                                                                               |
| `kills`          | integer            | monsters killed this game                                                                                                  |
| `has_amulet`     | boolean            | whether the Amulet is carried                                                                                              |
| `monsters_alive` | integer            | living monsters on the current level                                                                                       |
| `items_on_floor` | integer            | item stacks on the current level's floor, gold piles included                                                              |
| `explored`       | integer            | explored tiles on the current level                                                                                        |
| `map_digest`     | string             | 16 lowercase hex digits, see H5                                                                                            |
| `view`           | array of 9 strings | 9×9 glyph window centred on the player, see H6                                                                             |
| `messages_tail`  | array of strings   | the last up to 5 messages, oldest first, exactly as displayed                                                              |
| `death`          | object or null     | on death: keys in order `cause`, `killer`, `depth`, `turn`; otherwise `null`                                               |

**H5.** `map_digest` is the FNV-1a 64-bit hash of the current level's terrain: build the string
of 40 rows of 80 terrain glyphs (`#`, `.`, `+`, `'`, `<`, `>`; items and actors excluded, doors
by their current open/closed state) joined by `\n` with no trailing newline, hash its UTF-8
bytes with offset basis `0xcbf29ce484222325` and prime `0x100000001b3`, and print it as 16
lowercase hex digits. Test vectors for your implementation: `""` → `cbf29ce484222325`,
`"hello"` → `a430d84680aabd0b`, `"the quick brown fox"` → `59aeb7b40bd8c122`.

**H6.** `view` is nine strings of nine characters, rows top to bottom, the player at the centre
of row index 4 column index 4. Each cell uses the display rules of R42 restricted to what the
player knows: currently visible cells show the full precedence stack; explored-but-not-visible
cells show remembered terrain and remembered items; unexplored cells and cells outside the map
are a single space.

**H7.** `--selftest` runs built-in invariant checks with no terminal, prints one line per check
to stdout in the form `ok <check-name>` or `FAIL <check-name>: <detail>`, ends with
`selftest: <passed>/<total>`, and exits 0 if and only if every check passed (otherwise exit 4).
These checks are required, with these exact names:

| Check name             | Asserts                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rng-vectors`          | the five SplitMix64 outputs for state 0 in R2                                                                                                                                                 |
| `rng-bounds`           | 10 000 `rng_int(3, 17)` draws all lie in `[3, 17]` and every value occurs                                                                                                                     |
| `map-connectivity`     | for seeds 1–50 × depths 1–8: `<` exists, `>` exists except at depth 8, and every floor tile is reachable from `<`                                                                             |
| `map-determinism`      | generating `(seed, depth)` twice yields byte-identical tile grids, for 20 pairs                                                                                                               |
| `fov-symmetry`         | on 20 generated levels, 200 random tile pairs each: A sees B iff B sees A                                                                                                                     |
| `fov-radius`           | no visible tile exceeds Chebyshev radius 8; an actor standing on the single floor tile of a 3×3 rectangle whose other eight tiles are wall sees exactly 9 tiles — its own and the eight walls |
| `scheduler-rates`      | over 1000 ticks with cost-100 actions: speed 150 → 1500 actions, 100 → 1000, 60 → 600                                                                                                         |
| `astar-optimal`        | on 20 levels × 100 random passable start/goal pairs, A* path length equals BFS distance, and repeating the query returns the identical path                                                   |
| `save-roundtrip`       | after 300 scripted turns, save → load → save produces byte-identical save data, and 100 further identical inputs produce identical summaries                                                  |
| `inventory-invariants` | ≤ 26 stacks, every count ≥ 1, equipped items are present in the inventory, no item is simultaneously on the floor and carried, a cursed equipped item refuses unequip                         |
| `status-expiry`        | a 5-turn effect is present for exactly 5 of the affected actor's turns and absent on the 6th                                                                                                  |
| `xp-table`             | `xp_threshold(n) == 5*n*(n-1)` for n in 2..10, and a player granted exactly `xp_threshold(n)` XP is level `n`                                                                                 |
| `hunger-thresholds`    | each boundary in R35 (0, 49, 50, 149, 150, 299, 300, 1499, 1500) reports the state named there                                                                                                |

**H8.** `test.sh` must, at minimum:

1. run `./run.sh --selftest` and fail if it exits non-zero;
2. for each recorded script in `tests/scripts/`, run it headless with the seed recorded
   alongside it and assert the stdout line is **byte-identical** to the matching file in
   `tests/expected/`;
3. run at least one recorded script twice and assert the two outputs are byte-identical to
   each other (determinism across processes);
4. run one recorded script split in half through save/load — first half, `S` to save, reload
   with `--load`, second half — and assert the resulting summary is byte-identical to the
   unsplit run's summary;
5. assert that two different seeds with the same script produce different `map_digest` values.

You must ship at least three recorded scripts, each with its seed and expected summary:
`smoke` (a short walk-and-look run), `descend` (reaches depth 3 or deeper), and `combat`
(kills at least one monster and picks up at least one item). Generate the expected files with
your own finished implementation and commit them; they are the regression baseline.

---

## 7. Deliverables

In `tui-games/solutions/{{RUN_ID}}/roguelike/{{LANGUAGE}}/`:

| Path                                         | Contents                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| source tree                                  | ≥ 16 modules per T7, none over 600 lines                                                                              |
| `build.sh`                                   | compiles/installs offline; exit 0; no-op is acceptable for interpreted languages                                      |
| `run.sh`                                     | forwards **all** arguments to the program; supports `--seed`, `--headless --script`, `--selftest`, `--save`, `--load` |
| `test.sh`                                    | the checks in H8; exit 0 iff everything passes                                                                        |
| `README.md`                                  | how to build, run, and play: key bindings, screen layout, CLI flags, exit codes                                       |
| `NOTES.md`                                   | design decisions, what is incomplete, known bugs, anything you would do differently                                   |
| `MODULES.md`                                 | file → concern map, line counts, and the dependency direction argument required by T7                                 |
| `tests/scripts/{smoke,descend,combat}.keys`  | recorded input scripts, first line a `# seed: <n>` comment                                                            |
| `tests/expected/{smoke,descend,combat}.json` | the exact expected summary line for each                                                                              |
| `run.json`                                   | filled in per `CONVENTIONS.md` §5                                                                                     |

All three shell scripts start with `#!/usr/bin/env bash` and `set -euo pipefail`, are
`chmod +x`, and assume the language folder as the working directory.

---

## 8. Definition of done

Verify each of these yourself before you declare the task complete.

- [ ] `./build.sh` exits 0 from a clean checkout with no network access.
- [ ] `./run.sh --seed 12345` starts a playable game in an 80×24 terminal; `Ctrl-C` returns a
      usable shell with the cursor visible.
- [ ] `./run.sh --selftest` prints every check from H7 by name and exits 0.
- [ ] `./run.sh --headless --script tests/scripts/smoke.keys --seed <n>` prints exactly one
      line of JSON on stdout and nothing else.
- [ ] Running that command twice produces byte-identical output.
- [ ] The summary's key order, key set, and compact formatting match H4 exactly.
- [ ] `map_digest` matches the FNV-1a test vectors in H5.
- [ ] All 8 depths generate, every floor tile is reachable from `<`, and the Amulet exists on
      depth 8.
- [ ] FOV is symmetric and explored terrain is drawn from memory while monsters are not.
- [ ] All four AI behaviours are observable: a chaser closes, an archer keeps its distance, an
      imp flees below 30% HP, a zombie stays asleep until noticed.
- [ ] A hasted actor acts 1.5× as often as a normal one, and a zombie 0.6× — verified by
      `scheduler-rates`.
- [ ] Equipping a cursed item is irreversible until a scroll of remove curse is read.
- [ ] Quaffing an unidentified potion identifies that type for the rest of the game.
- [ ] Statuses expire on schedule, hunger crosses every threshold in R35, and levelling follows
      `5n(n−1)`.
- [ ] Save → load → continue produces the same result as an uninterrupted run, and the save
      file is gone after loading.
- [ ] Death appends a well-formed line to `deaths.log` and ends the game with status `dead`.
- [ ] The message log holds 200 entries, collapses duplicates, and scrolls with `m`.
- [ ] `./test.sh` exits 0 and covers all five items of H8.
- [ ] ≥ 16 modules, none over 600 lines, no rules module imports rendering or input, and
      `MODULES.md` documents this.
- [ ] `README.md`, `NOTES.md`, `MODULES.md`, and `run.json` are present and accurate.

---

## 9. Scoring rubric

Total 100 points. Partial credit is awarded per requirement, not per system.

| Weight | Criterion                                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10     | **Build and invocation.** `build.sh` succeeds offline; `run.sh` supports every flag; `--selftest` and `--headless` exist, behave as specified, and use the documented exit codes.                                                       |
| 12     | **Headless determinism and JSON contract.** Exact key set, key order, compact formatting; byte-identical across runs and processes; correct `map_digest` and `view` encoding; nothing but the summary on stdout.                        |
| 10     | **Dungeon generation.** BSP as specified in R6–R10, 8 levels, doors, stairs, Amulet, guaranteed connectivity (R11), and per-`(seed, depth)` determinism (R4).                                                                           |
| 10     | **Field of view.** Symmetric shadowcasting with correct radius and wall/door occlusion; explored-map memory with the item/monster distinction of R15.                                                                                   |
| 12     | **Pathfinding and AI.** A* per R22 returning shortest, deterministic paths; all four behaviours of R23 implemented as written, including the ranged distance band and the coward's 30% threshold.                                       |
| 8      | **Turn scheduler.** The energy model of R17/R18, correct interleaving of speed 60/100/130/150 actors, player tie-break, and the exact action counts of R19.                                                                             |
| 10     | **Items, inventory, equipment.** 26 letter slots with correct reuse, consumable stacking, four slots, the R28 tables, generation weights, appearance shuffling and identification (R30), and curses (R31).                              |
| 10     | **Rules fidelity.** Combat formula R33 including crit/auto-miss handling, the generic status system R34, hunger R35, and XP/levelling R36 — each matching the stated numbers.                                                           |
| 8      | **Save/load, permadeath, death log.** Complete state round-trip including RNG state, split-script equivalence, version rejection with exit 3, delete-on-load, and a well-formed `deaths.log`.                                           |
| 6      | **Module structure.** ≥ 16 single-concern files, the 600-line ceiling, one-way dependencies with no rules→UI import, and an accurate `MODULES.md`.                                                                                      |
| 4      | **Interface quality.** The R42 layout, the full R43 key map, message log with scrollback and duplicate collapsing, terminal restored on every exit path including SIGINT and panic, no busy-wait, buffered redraw only on state change. |

Deductions apply for: any stdout pollution in headless mode; non-determinism from language RNG,
hash iteration order, or wall-clock reads; a single-file implementation; a solution that only
runs on the author's machine; and any `--selftest` check that is stubbed out to pass.
