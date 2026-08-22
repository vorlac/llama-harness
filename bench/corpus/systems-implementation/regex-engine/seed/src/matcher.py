# Running a compiled program over a subject.
#
# This is a backtracking executor: it walks the program depth first, keeping
# one capture array and undoing writes on the way back out, and it finds an
# unanchored match by trying every start offset in turn. It is correct on the
# preference order of SPEC.md section 5.3 and on the capture rules of section
# 5.4, and it is neither linear in the subject nor bounded on the patterns of
# section 11. NOTES.md records what has to replace it.

WORD_RANGES = ((0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A))


def search(prog, groups, codes, start=0):
    """The leftmost-first match beginning at or after `start`, or None.

    `codes` is the subject as a list of code point values, which is what makes
    every offset in a reply a code point index.
    """
    slots = 2 * groups + 2
    for pos in range(start, len(codes) + 1):
        caps = run_at(prog, codes, pos, slots)
        if caps is not None:
            return caps
    return None


def find_all(prog, groups, codes):
    """Every successive non-overlapping match, per SPEC.md section 5.7."""
    spans = []
    pos = 0
    limit = len(codes)
    while pos <= limit:
        caps = search(prog, groups, codes, pos)
        if caps is None:
            break
        begin, end = caps[0], caps[1]
        spans.append((begin, end))
        pos = end if end > begin else begin + 1
    return spans


def run_at(prog, codes, pos, slots):
    """The program run anchored at `pos`; the capture array, or None.

    The `(pc, position)` guard is what keeps a repetition whose body can match
    the empty string from iterating for ever. It is path-local: every entry is
    withdrawn when the path that added it is abandoned, so it prunes a loop and
    never memoises a failure across branches.
    """
    caps = [-1] * slots
    trail = []
    seen = set()
    seen_order = []
    stack = []
    limit = len(codes)
    pc = 0
    while True:
        failed = False
        key = (pc, pos)
        if key in seen:
            failed = True
        else:
            seen.add(key)
            seen_order.append(key)
            ins = prog[pc]
            op = ins[0]
            if op == "char":
                if pos < limit and codes[pos] == ins[1]:
                    pc += 1
                    pos += 1
                else:
                    failed = True
            elif op == "any":
                if pos < limit and codes[pos] != 0x0A:
                    pc += 1
                    pos += 1
                else:
                    failed = True
            elif op == "class":
                if pos < limit and in_class(codes[pos], ins[1], ins[2]):
                    pc += 1
                    pos += 1
                else:
                    failed = True
            elif op == "split":
                stack.append((ins[2], pos, len(trail), len(seen_order)))
                pc = ins[1]
            elif op == "jmp":
                pc = ins[1]
            elif op == "save":
                slot = ins[1]
                trail.append((slot, caps[slot]))
                caps[slot] = pos
                pc += 1
            elif op == "assert":
                if holds(ins[1], codes, pos):
                    pc += 1
                else:
                    failed = True
            else:
                return caps
        if failed:
            if not stack:
                return None
            pc, pos, depth, watermark = stack.pop()
            while len(trail) > depth:
                slot, previous = trail.pop()
                caps[slot] = previous
            while len(seen_order) > watermark:
                seen.discard(seen_order.pop())


def in_class(code, negated, ranges) -> bool:
    inside = False
    for lo, hi in ranges:
        if lo <= code <= hi:
            inside = True
            break
    return inside != negated


def holds(kind, codes, pos) -> bool:
    if kind == "bol":
        return pos == 0
    if kind == "eol":
        return pos == len(codes)
    before = is_word(codes[pos - 1]) if pos > 0 else False
    after = is_word(codes[pos]) if pos < len(codes) else False
    boundary = before != after
    return boundary if kind == "wordb" else not boundary


def is_word(code) -> bool:
    for lo, hi in WORD_RANGES:
        if lo <= code <= hi:
            return True
    return False
