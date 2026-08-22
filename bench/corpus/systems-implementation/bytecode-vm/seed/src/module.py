# The module format of SPEC.md section 5 and the validation of section 13.
#
# Reading and writing share one set of structures, so what the assembler builds
# and what the loader accepts are the same shape by construction. Validation is
# in two halves: the structural and per-function checks 1 to 14, which decide
# whether the file can be decoded at all, and the per-instruction checks 15 to
# 20, which decide whether the decoded instructions refer to things that exist.

import struct

from errors import SvmError
from opcodes import (
    BY_OPCODE,
    HALT,
    NONE,
    OPERAND_SIZE,
    RET,
    U8,
)

MAGIC = b"SVM1"
HEADER_SIZE = 16
MAX_CONSTANTS = 65536

INT_TAG = 0x01
STR_TAG = 0x02


class Function:
    __slots__ = ("name_const", "arity", "num_locals", "num_upvalues", "upvalues", "code")

    def __init__(self, name_const, arity, num_locals, num_upvalues, upvalues, code):
        self.name_const = name_const
        self.arity = arity
        self.num_locals = num_locals
        self.num_upvalues = num_upvalues
        self.upvalues = upvalues
        self.code = code


class Module:
    __slots__ = ("constants", "functions")

    def __init__(self, constants, functions):
        # A constant is ("int", value) or ("str", bytes).
        self.constants = constants
        self.functions = functions

    def name_of(self, index: int) -> bytes:
        return self.constants[self.functions[index].name_const][1]


def write_module(module: Module) -> bytes:
    out = bytearray()
    out += MAGIC
    out += struct.pack("<HHII", 1, 0, len(module.constants), len(module.functions))
    for tag, value in module.constants:
        if tag == "int":
            out.append(INT_TAG)
            out += struct.pack("<q", value)
        else:
            out.append(STR_TAG)
            out += struct.pack("<I", len(value))
            out += value
    for function in module.functions:
        out += struct.pack("<I", function.name_const)
        out += bytes((function.arity, function.num_locals, function.num_upvalues, 0))
        for kind, index in function.upvalues:
            out += bytes((kind, index))
        out += struct.pack("<I", len(function.code))
        out += function.code
    return bytes(out)


def read_module(data: bytes, error_code: str = "E_BAD_CODE") -> Module:
    """A module image, decoded and checked against section 13's checks 1 to 14.

    `error_code` is what a refusal reports: `E_BAD_CODE` for the loader, and
    `E_ASM` when the assembler runs these same checks over what it just built.
    """

    def refuse(detail):
        raise SvmError(error_code, detail)

    if len(data) < HEADER_SIZE or data[:4] != MAGIC:
        refuse("not an svm module")
    version, flags, constant_count, function_count = struct.unpack_from(
        "<HHII", data, 4
    )
    if version != 1:
        refuse("version %d" % version)
    if flags != 0:
        refuse("flags %d" % flags)
    if not 1 <= constant_count <= MAX_CONSTANTS:
        refuse("constant_count %d" % constant_count)
    if function_count < 1:
        refuse("function_count %d" % function_count)

    cursor = HEADER_SIZE
    constants = []
    for index in range(constant_count):
        if cursor >= len(data):
            refuse("constant %d runs past the file" % index)
        tag = data[cursor]
        cursor += 1
        if tag == INT_TAG:
            if cursor + 8 > len(data):
                refuse("constant %d runs past the file" % index)
            constants.append(("int", struct.unpack_from("<q", data, cursor)[0]))
            cursor += 8
        elif tag == STR_TAG:
            if cursor + 4 > len(data):
                refuse("constant %d runs past the file" % index)
            length = struct.unpack_from("<I", data, cursor)[0]
            cursor += 4
            if cursor + length > len(data):
                refuse("constant %d runs past the file" % index)
            constants.append(("str", data[cursor : cursor + length]))
            cursor += length
        else:
            refuse("constant %d has tag %#04x" % (index, tag))

    functions = []
    for index in range(function_count):
        if cursor + 12 > len(data):
            refuse("function %d runs past the file" % index)
        name_const = struct.unpack_from("<I", data, cursor)[0]
        arity, num_locals, num_upvalues, reserved = data[cursor + 4 : cursor + 8]
        cursor += 8
        if reserved != 0:
            refuse("function %d reserved byte is %d" % (index, reserved))
        if cursor + 2 * num_upvalues > len(data):
            refuse("function %d upvalues run past the file" % index)
        upvalues = []
        for _ in range(num_upvalues):
            kind, slot = data[cursor], data[cursor + 1]
            if kind not in (0, 1):
                refuse("function %d has upvalue kind %d" % (index, kind))
            upvalues.append((kind, slot))
            cursor += 2
        if cursor + 4 > len(data):
            refuse("function %d code length runs past the file" % index)
        code_length = struct.unpack_from("<I", data, cursor)[0]
        cursor += 4
        if code_length < 1:
            refuse("function %d has empty code" % index)
        if cursor + code_length > len(data):
            refuse("function %d code runs past the file" % index)
        code = data[cursor : cursor + code_length]
        cursor += code_length
        if name_const >= len(constants) or constants[name_const][0] != "str":
            refuse("function %d name_const %d" % (index, name_const))
        if arity > num_locals:
            refuse("function %d arity %d exceeds locals %d" % (index, arity, num_locals))
        functions.append(
            Function(name_const, arity, num_locals, num_upvalues, upvalues, code)
        )

    if cursor != len(data):
        refuse("%d trailing byte(s)" % (len(data) - cursor))
    if functions[0].arity != 0:
        refuse("function 0 has arity %d" % functions[0].arity)

    module = Module(constants, functions)
    for index, function in enumerate(functions):
        decode_code(function.code, index, error_code)
    return module


def decode_code(code: bytes, function_index: int, error_code: str):
    """Every instruction offset in a function's code, checks 12 and 13."""
    offsets = []
    cursor = 0
    last = None
    while cursor < len(code):
        opcode = code[cursor]
        entry = BY_OPCODE.get(opcode)
        if entry is None:
            raise SvmError(
                error_code,
                "function %d has opcode %#04x at %d" % (function_index, opcode, cursor),
            )
        size = 1 + OPERAND_SIZE[entry[1]]
        if cursor + size > len(code):
            raise SvmError(
                error_code,
                "function %d instruction at %d runs past its code"
                % (function_index, cursor),
            )
        offsets.append(cursor)
        last = opcode
        cursor += size
    if last not in (RET, HALT):
        raise SvmError(
            error_code, "function %d does not end in RET or HALT" % function_index
        )
    return offsets


def operand(code: bytes, offset: int) -> int:
    """The decoded operand of the instruction at `offset`, 0 when it has none."""
    layout = BY_OPCODE[code[offset]][1]
    if layout == NONE:
        return 0
    if layout == U8:
        return code[offset + 1]
    value = code[offset + 1] | (code[offset + 2] << 8)
    if layout == "i16" and value > 0x7FFF:
        value -= 0x10000
    return value
