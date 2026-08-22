# The assembly language of SPEC.md section 4, lowered to a module.
#
# Source is bytes and never text: section 4.3 lets a string literal carry any
# byte, including bytes above 0x7E, so decoding the file would change what the
# literal denotes.
#
# One pass builds the functions and interns constants in exactly the order
# section 4.7 fixes - a function's own name, then its instructions' constants in
# order - because the suite compares module bytes. A second pass resolves what
# the first cannot know yet: a `CLOSURE` may name a function defined later, and
# a jump's displacement is only known once its target label has an offset.

import re

from errors import SvmError
from module import Function, Module, read_module, write_module
from opcodes import BY_NAME, I16, NONE, OPERAND_SIZE, U8, U16
from values import INT_MAX, INT_MIN, wrap

IDENTIFIER = re.compile(rb"[A-Za-z_][A-Za-z0-9_]*\Z")
DECIMAL = re.compile(rb"-?[0-9]+\Z")
HEX = re.compile(rb"0[xX][0-9a-fA-F]{1,16}\Z")

STRING_ESCAPES = {
    0x5C: 0x5C,
    0x22: 0x22,
    ord("n"): 0x0A,
    ord("r"): 0x0D,
    ord("t"): 0x09,
    ord("0"): 0x00,
}

WHITESPACE = b" \t"


def fail(detail: str):
    raise SvmError("E_ASM", detail)


def tokenize(line: bytes):
    """One source line's tokens: `("word", bytes)` and `("str", bytes)`."""
    tokens = []
    index = 0
    size = len(line)
    while index < size:
        byte = line[index]
        if byte in WHITESPACE:
            index += 1
            continue
        if byte == 0x3B:  # ';'
            break
        if byte == 0x22:  # '"'
            literal = bytearray()
            index += 1
            while True:
                if index >= size:
                    fail("unterminated string literal")
                current = line[index]
                if current == 0x22:
                    index += 1
                    break
                if current != 0x5C:
                    literal.append(current)
                    index += 1
                    continue
                if index + 1 >= size:
                    fail("unterminated escape")
                escaped = line[index + 1]
                if escaped in STRING_ESCAPES:
                    literal.append(STRING_ESCAPES[escaped])
                    index += 2
                    continue
                if escaped == ord("x"):
                    digits = line[index + 2 : index + 4]
                    if len(digits) != 2 or not re.match(rb"[0-9a-fA-F]{2}\Z", digits):
                        fail("malformed \\x escape")
                    literal.append(int(digits, 16))
                    index += 4
                    continue
                fail("unknown escape \\%s" % chr(escaped))
            tokens.append(("str", bytes(literal)))
            continue
        start = index
        while index < size and line[index] not in WHITESPACE and line[index] != 0x3B:
            if line[index] == 0x22:
                break
            index += 1
        tokens.append(("word", line[start:index]))
    return tokens


def parse_int_literal(token: bytes) -> int:
    if HEX.match(token):
        return wrap(int(token[2:], 16))
    if not DECIMAL.match(token):
        fail("not an integer literal: %r" % token)
    value = int(token)
    if not INT_MIN <= value <= INT_MAX:
        fail("integer literal out of range: %r" % token)
    return value


def parse_byte(token: bytes) -> int:
    if not re.match(rb"[0-9]+\Z", token):
        fail("not a decimal count: %r" % token)
    value = int(token)
    if value > 255:
        fail("count %d is outside 0..255" % value)
    return value


class Pool:
    """The constant pool, interned in the order section 4.7 fixes."""

    def __init__(self):
        self.entries = []
        self.index = {}

    def intern(self, tag: str, value) -> int:
        key = (tag, value)
        found = self.index.get(key)
        if found is not None:
            return found
        if len(self.entries) >= 65536:
            fail("more than 65536 constants")
        self.index[key] = len(self.entries)
        self.entries.append(key)
        return self.index[key]


class Draft:
    """One function under construction."""

    def __init__(self, name, arity, num_locals, num_upvalues):
        self.name = name
        self.arity = arity
        self.num_locals = num_locals
        self.num_upvalues = num_upvalues
        self.upvalues = []
        self.labels = {}
        # (opcode, layout, resolved operand or a pending reference, offset)
        self.instructions = []
        self.length = 0
        self.started = False


def assemble(source: bytes) -> Module:
    pool = Pool()
    drafts = []
    current = None
    for raw in source.split(b"\n"):
        line = raw[:-1] if raw.endswith(b"\r") else raw
        tokens = tokenize(line)
        if not tokens:
            continue
        kind, head = tokens[0]
        if kind == "word" and head.startswith(b"."):
            current = _directive(drafts, current, pool, head, tokens)
            continue
        if current is None:
            fail("instruction outside a function")
        if kind == "word" and head.endswith(b":"):
            if len(tokens) != 1:
                fail("a label must be alone on its line")
            _label(current, head[:-1])
            continue
        _instruction(current, pool, tokens)
    if current is not None:
        fail("file ends inside a function")
    if not drafts:
        fail("no function in the source")
    return _resolve(drafts, pool)


def _directive(drafts, current, pool, head, tokens):
    word = head.lower()
    if word == b".func":
        if current is not None:
            fail(".func inside a function")
        return _begin(drafts, pool, tokens)
    if word == b".end":
        if current is None:
            fail(".end without .func")
        if len(tokens) != 1:
            fail("trailing token after .end")
        if not current.instructions:
            fail("function %r has no instruction" % current.name)
        if len(current.upvalues) != current.num_upvalues:
            fail("function %r declares %d upvalues" % (current.name, current.num_upvalues))
        last = current.instructions[-1][0]
        if last not in (BY_NAME["RET"][0], BY_NAME["HALT"][0]):
            fail("function %r does not end in RET or HALT" % current.name)
        return None
    if word == b".upval":
        if current is None:
            fail(".upval outside a function")
        if current.started:
            fail(".upval after the first instruction or label")
        if len(tokens) != 3 or tokens[1][0] != "word" or tokens[2][0] != "word":
            fail(".upval takes a kind and an index")
        kind = tokens[1][1].lower()
        if kind not in (b"local", b"upval"):
            fail(".upval kind %r" % tokens[1][1])
        current.upvalues.append((0 if kind == b"local" else 1, parse_byte(tokens[2][1])))
        if len(current.upvalues) > current.num_upvalues:
            fail("function %r declares too many upvalues" % current.name)
        return current
    fail("unknown directive %r" % head)


def _begin(drafts, pool, tokens):
    if len(tokens) not in (4, 5):
        fail(".func takes a name, arity= and locals=, and may take upvals=")
    if tokens[1][0] != "word" or not IDENTIFIER.match(tokens[1][1]):
        fail(".func name %r is not an identifier" % tokens[1][1])
    name = tokens[1][1]
    if any(draft.name == name for draft in drafts):
        fail("duplicate function name %r" % name)
    fields = []
    for label, (kind, token) in zip((b"arity=", b"locals=", b"upvals="), tokens[2:]):
        # Section 4.1: directives and their keywords are matched
        # case-insensitively; only names are case-sensitive.
        if kind != "word" or not token.lower().startswith(label):
            fail(".func header expects %s" % label.decode("ascii"))
        fields.append(parse_byte(token[len(label) :]))
    if len(fields) == 2:
        fields.append(0)
    arity, num_locals, num_upvalues = fields
    if arity > num_locals:
        fail("function %r has arity %d over locals %d" % (name, arity, num_locals))
    if not drafts and arity != 0:
        fail("function 0 must have arity 0")
    draft = Draft(name, arity, num_locals, num_upvalues)
    pool.intern("str", name)
    drafts.append(draft)
    return draft


def _label(draft, name):
    if not IDENTIFIER.match(name):
        fail("label %r is not an identifier" % name)
    if name in draft.labels:
        fail("duplicate label %r" % name)
    draft.started = True
    draft.labels[name] = draft.length


def _instruction(draft, pool, tokens):
    kind, head = tokens[0]
    if kind != "word":
        fail("expected a mnemonic")
    mnemonic = head.upper().decode("latin-1")
    entry = BY_NAME.get(mnemonic)
    if entry is None:
        fail("unknown mnemonic %r" % head)
    opcode, layout = entry
    draft.started = True
    rest = tokens[1:]
    if layout == NONE:
        if rest:
            fail("%s takes no operand" % mnemonic)
        value = 0
    else:
        if len(rest) != 1:
            fail("%s takes exactly one operand" % mnemonic)
        value = _operand(draft, pool, mnemonic, rest[0])
    draft.instructions.append([opcode, layout, value, draft.length])
    draft.length += 1 + OPERAND_SIZE[layout]


def _operand(draft, pool, mnemonic, token):
    kind, text = token
    if mnemonic == "PUSH_INT":
        if kind != "word":
            fail("PUSH_INT takes an integer literal")
        return pool.intern("int", parse_int_literal(text))
    if mnemonic == "PUSH_STR":
        if kind != "str":
            fail("PUSH_STR takes a string literal")
        return pool.intern("str", text)
    if mnemonic in ("LOAD_GLOBAL", "STORE_GLOBAL"):
        if kind == "word" and not IDENTIFIER.match(text):
            fail("%s takes a name or a string literal" % mnemonic)
        if not text:
            fail("%s takes a non-empty name" % mnemonic)
        return pool.intern("str", text)
    if kind != "word":
        fail("%s does not take a string literal" % mnemonic)
    if mnemonic in ("LOAD_LOCAL", "STORE_LOCAL"):
        slot = parse_byte(text)
        if slot >= draft.num_locals:
            fail("%s %d is outside this function's locals" % (mnemonic, slot))
        return slot
    if mnemonic in ("LOAD_UPVAL", "STORE_UPVAL"):
        slot = parse_byte(text)
        if slot >= draft.num_upvalues:
            fail("%s %d is outside this function's upvalues" % (mnemonic, slot))
        return slot
    if mnemonic == "CLOSURE":
        if text.startswith(b"#"):
            return ("function-index", parse_index(text[1:]))
        if not IDENTIFIER.match(text):
            fail("CLOSURE takes a function name or #<index>")
        return ("function-name", text)
    if mnemonic in ("JMP", "JMP_IF_FALSE", "JMP_IF_TRUE"):
        if not IDENTIFIER.match(text):
            fail("%s takes a label" % mnemonic)
        return ("label", text)
    return parse_byte(text)


def parse_index(token: bytes) -> int:
    if not re.match(rb"[0-9]+\Z", token):
        fail("not a decimal function index: %r" % token)
    return int(token)


def _resolve(drafts, pool) -> Module:
    by_name = {draft.name: index for index, draft in enumerate(drafts)}
    functions = []
    for draft in drafts:
        code = bytearray()
        for opcode, layout, value, offset in draft.instructions:
            code.append(opcode)
            if layout == NONE:
                continue
            if isinstance(value, tuple):
                what, payload = value
                if what == "function-name":
                    if payload not in by_name:
                        fail("CLOSURE names unknown function %r" % payload)
                    value = by_name[payload]
                elif what == "function-index":
                    if payload >= len(drafts):
                        fail("CLOSURE names unknown function #%d" % payload)
                    value = payload
                else:
                    if payload not in draft.labels:
                        fail("undefined label %r" % payload)
                    value = draft.labels[payload] - (offset + 3)
                    if not -32768 <= value <= 32767:
                        fail("jump displacement %d is out of range" % value)
            if layout == U8:
                code.append(value)
            elif layout == U16:
                if value > 65535:
                    fail("operand %d does not fit in a u16" % value)
                code += bytes((value & 0xFF, value >> 8))
            elif layout == I16:
                code += (value & 0xFFFF).to_bytes(2, "little")
        functions.append(
            Function(
                pool.index[("str", draft.name)],
                draft.arity,
                draft.num_locals,
                draft.num_upvalues,
                draft.upvalues,
                bytes(code),
            )
        )
    module = Module(list(pool.entries), functions)
    # Section 4.9: the assembler runs the loader's own checks over what it
    # built, so a source file can never produce a module the loader refuses.
    read_module(write_module(module), error_code="E_ASM")
    return module
