# The opcode table of SPEC.md section 6 and appendix A.
#
# One table serves the assembler, the loader, the disassembler and the
# interpreter, so a mnemonic, an opcode byte and an operand layout can never
# disagree between them.

NONE = "none"
U8 = "u8"
U16 = "u16"
I16 = "i16"

OPERAND_SIZE = {NONE: 0, U8: 1, U16: 2, I16: 2}

TABLE = (
    (0x00, "NOP", NONE),
    (0x01, "PUSH_NIL", NONE),
    (0x02, "PUSH_TRUE", NONE),
    (0x03, "PUSH_FALSE", NONE),
    (0x04, "PUSH_INT", U16),
    (0x05, "PUSH_STR", U16),
    (0x06, "POP", NONE),
    (0x07, "DUP", NONE),
    (0x08, "SWAP", NONE),
    (0x10, "LOAD_LOCAL", U8),
    (0x11, "STORE_LOCAL", U8),
    (0x12, "LOAD_GLOBAL", U16),
    (0x13, "STORE_GLOBAL", U16),
    (0x14, "LOAD_UPVAL", U8),
    (0x15, "STORE_UPVAL", U8),
    (0x20, "ADD", NONE),
    (0x21, "SUB", NONE),
    (0x22, "MUL", NONE),
    (0x23, "DIV", NONE),
    (0x24, "MOD", NONE),
    (0x25, "NEG", NONE),
    (0x26, "NOT", NONE),
    (0x27, "BAND", NONE),
    (0x28, "BOR", NONE),
    (0x29, "BXOR", NONE),
    (0x2A, "BNOT", NONE),
    (0x2B, "SHL", NONE),
    (0x2C, "SHR", NONE),
    (0x30, "EQ", NONE),
    (0x31, "NE", NONE),
    (0x32, "LT", NONE),
    (0x33, "LE", NONE),
    (0x34, "GT", NONE),
    (0x35, "GE", NONE),
    (0x40, "JMP", I16),
    (0x41, "JMP_IF_FALSE", I16),
    (0x42, "JMP_IF_TRUE", I16),
    (0x50, "CALL", U8),
    (0x51, "RET", NONE),
    (0x52, "CLOSURE", U16),
    (0x60, "NEW_ARRAY", U8),
    (0x61, "ARR_GET", NONE),
    (0x62, "ARR_SET", NONE),
    (0x63, "ARR_PUSH", NONE),
    (0x64, "ARR_POP", NONE),
    (0x65, "LEN", NONE),
    (0x70, "CONCAT", NONE),
    (0x71, "SUBSTR", NONE),
    (0x72, "INDEXOF", NONE),
    (0x73, "TOSTR", NONE),
    (0x74, "TOINT", NONE),
    (0x75, "CHR", NONE),
    (0x76, "ORD", NONE),
    (0x80, "PRINT", NONE),
    (0x81, "WRITE", NONE),
    (0x82, "TYPEOF", NONE),
    (0x83, "ASSERT", NONE),
    (0x90, "GC", NONE),
    (0x91, "GCLIVE", NONE),
    (0x92, "HALT", NONE),
)

BY_OPCODE = {opcode: (name, layout) for opcode, name, layout in TABLE}
BY_NAME = {name: (opcode, layout) for opcode, name, layout in TABLE}

RET = 0x51
HALT = 0x92
JUMPS = frozenset((0x40, 0x41, 0x42))
INT_CONSTANT_OPS = frozenset((0x04,))
STRING_CONSTANT_OPS = frozenset((0x05, 0x12, 0x13))
GLOBAL_OPS = frozenset((0x12, 0x13))
LOCAL_OPS = frozenset((0x10, 0x11))
UPVAL_OPS = frozenset((0x14, 0x15))
CLOSURE_OP = 0x52


def instruction_size(opcode: int) -> int:
    return 1 + OPERAND_SIZE[BY_OPCODE[opcode][1]]
