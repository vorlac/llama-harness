# The node tree of `parse.py`, lowered to the instruction program of SPEC.md
# section 9.
#
# The program is the anchored program for the pattern: it describes matching
# that begins at one given position. Unanchored search belongs to the matcher
# and must not appear here as a `.*?` prefix.
#
# An instruction is a list, not a tuple, because `split` and `jmp` targets are
# patched after the branch they jump over has been emitted.

from errors import RegexError
from parse import Parser

PROGRAM_LIMIT = 100000


def compile_pattern(pattern: str):
    """`(program, capture group count)` for a pattern, or a `RegexError`."""
    node, groups = Parser(pattern).parse()
    # Section 8: the ceiling is a compile-time check, and rejecting an
    # over-large program before allocating it is the point of the limit, so
    # the size is computed over the tree first.
    if 3 + _size(node) > PROGRAM_LIMIT:
        raise RegexError("program-too-large", -1)
    prog = [["save", 0]]
    _emit(node, prog)
    prog.append(["save", 1])
    prog.append(["match"])
    return prog, groups


def _size(node) -> int:
    """How many instructions a node lowers to, without lowering it."""
    kind = node[0]
    if kind == "empty":
        return 0
    if kind in ("char", "any", "class", "assert"):
        return 1
    if kind == "group":
        inner = _size(node[2])
        return inner + 2 if node[1] is not None else inner
    if kind == "cat":
        return sum(_size(item) for item in node[1])
    if kind == "alt":
        return sum(_size(item) for item in node[1]) + 2 * (len(node[1]) - 1)
    if kind == "rep":
        inner = _size(node[1])
        low, high = node[2], node[3]
        if high is None:
            return inner + 2 if low == 0 else low * inner + 1
        return low * inner + (high - low) * (inner + 1)
    raise AssertionError("unknown node %r" % (kind,))


def _emit(node, prog) -> None:
    kind = node[0]
    if kind == "empty":
        return
    if kind == "char":
        prog.append(["char", node[1]])
        return
    if kind == "any":
        prog.append(["any"])
        return
    if kind == "class":
        prog.append(["class", node[1], node[2]])
        return
    if kind == "assert":
        prog.append(["assert", node[1]])
        return
    if kind == "cat":
        for item in node[1]:
            _emit(item, prog)
        return
    if kind == "group":
        gid = node[1]
        if gid is None:
            _emit(node[2], prog)
            return
        prog.append(["save", 2 * gid])
        _emit(node[2], prog)
        prog.append(["save", 2 * gid + 1])
        return
    if kind == "alt":
        _emit_alt(node[1], prog)
        return
    if kind == "rep":
        # `node[4]` is the preference flag of section 5.3, which the parser
        # records and this lowering does not read. NOTES.md carries the entry.
        _emit_rep(node[1], node[2], node[3], prog)
        return
    raise AssertionError("unknown node %r" % (kind,))


def _emit_alt(branches, prog) -> None:
    # The leftmost branch is the highest-priority one, so it is always the
    # `split`'s first target.
    jumps = []
    last = len(branches) - 1
    for index, branch in enumerate(branches):
        if index == last:
            _emit(branch, prog)
            break
        split = len(prog)
        prog.append(["split", 0, 0])
        prog[split][1] = len(prog)
        _emit(branch, prog)
        jumps.append(len(prog))
        prog.append(["jmp", 0])
        prog[split][2] = len(prog)
    end = len(prog)
    for slot in jumps:
        prog[slot][1] = end


def _emit_rep(body, low, high, prog) -> None:
    """A repetition, expanded. Every split here prefers one more iteration."""
    if high is None:
        if low == 0:
            _emit_star(body, prog)
        else:
            for _ in range(low - 1):
                _emit(body, prog)
            _emit_plus(body, prog)
        return
    for _ in range(low):
        _emit(body, prog)
    optional = high - low
    if optional == 0:
        return
    splits = []
    for _ in range(optional):
        split = len(prog)
        prog.append(["split", 0, 0])
        splits.append(split)
        prog[split][1] = len(prog)
        _emit(body, prog)
    end = len(prog)
    for split in splits:
        prog[split][2] = end


def _emit_star(body, prog) -> None:
    # `x*` is lowered as an optional `x+`: one split guards entry to the body
    # and a second one closes the loop, rather than a back-jump to the first.
    # The two forms accept the same language, and this one keeps the loop's
    # exit edge distinct from its entry edge, which is what lets a simulation
    # leave a body that matched the empty string with that iteration's capture
    # writes intact.
    entry = len(prog)
    prog.append(["split", 0, 0])
    start = len(prog)
    _emit(body, prog)
    again = len(prog)
    prog.append(["split", 0, 0])
    end = len(prog)
    for split in (entry, again):
        prog[split][1], prog[split][2] = start, end


def _emit_plus(body, prog) -> None:
    start = len(prog)
    _emit(body, prog)
    split = len(prog)
    prog.append(["split", start, 0])
    prog[split][2] = len(prog)


def format_instruction(ins) -> str:
    """One dump line's text, without its program counter (section 9.4)."""
    op = ins[0]
    if op == "char":
        return "char %s" % _hex(ins[1])
    if op == "any":
        return "any"
    if op == "class":
        polarity = "n" if ins[1] else "p"
        ranges = " ".join("%s-%s" % (_hex(lo), _hex(hi)) for lo, hi in ins[2])
        return "class %s %s" % (polarity, ranges)
    if op == "split":
        return "split %d %d" % (ins[1], ins[2])
    if op == "jmp":
        return "jmp %d" % ins[1]
    if op == "save":
        return "save %d" % ins[1]
    if op == "assert":
        return "assert %s" % ins[1]
    return "match"


def _hex(value: int) -> str:
    """Lowercase, at least two digits, no leading zeros beyond that."""
    return "%02x" % value
