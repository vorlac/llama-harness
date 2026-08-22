# The canonical disassembly of SPEC.md section 11.
#
# The text this produces is what `asm` must turn back into the same bytes, so
# every choice here is the one the assembler's own rules invert: labels name
# instruction offsets, a global prints bare when its name is an identifier, and
# a CLOSURE prints a function name only when that name identifies the function
# uniquely.

import re

from module import decode_code, operand
from opcodes import BY_OPCODE, CLOSURE_OP, GLOBAL_OPS, JUMPS
from values import quote

IDENTIFIER = re.compile(rb"[A-Za-z_][A-Za-z0-9_]*\Z")


def disassemble(module) -> bytes:
    counts = {}
    for function in module.functions:
        name = module.constants[function.name_const][1]
        counts[name] = counts.get(name, 0) + 1
    out = bytearray(b"; svm disassembly\n")
    for index, function in enumerate(module.functions):
        out += b".func %s arity=%d locals=%d upvals=%d\n" % (
            module.constants[function.name_const][1],
            function.arity,
            function.num_locals,
            function.num_upvalues,
        )
        for kind, slot in function.upvalues:
            out += b"  .upval %s %d\n" % (b"local" if kind == 0 else b"upval", slot)
        offsets = decode_code(function.code, index, "E_BAD_CODE")
        targets = set()
        for offset in offsets:
            opcode = function.code[offset]
            if opcode in JUMPS:
                targets.add(offset + 3 + operand(function.code, offset))
        for offset in offsets:
            if offset in targets:
                out += b"L%04x:\n" % offset
            out += b"  " + _instruction(module, function, offset, counts) + b"\n"
        out += b".end\n"
    return bytes(out)


def _instruction(module, function, offset, counts) -> bytes:
    code = function.code
    opcode = code[offset]
    mnemonic, layout = BY_OPCODE[opcode]
    text = mnemonic.encode("ascii")
    if layout == "none":
        return text
    value = operand(code, offset)
    if opcode == 0x04:
        return text + b" " + str(module.constants[value][1]).encode("ascii")
    if opcode == 0x05:
        return text + b" " + quote(module.constants[value][1])
    if opcode in GLOBAL_OPS:
        name = module.constants[value][1]
        if IDENTIFIER.match(name):
            return text + b" " + name
        return text + b" " + quote(name)
    if opcode in JUMPS:
        return text + b" L%04x" % (offset + 3 + value)
    if opcode == CLOSURE_OP:
        name = module.constants[module.functions[value].name_const][1]
        if counts.get(name) == 1 and IDENTIFIER.match(name):
            return text + b" " + name
        return text + b" #%d" % value
    return text + b" %d" % value
