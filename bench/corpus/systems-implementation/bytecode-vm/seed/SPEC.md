# SVM: a stack virtual machine, assembler and disassembler

**Specification version 1. This document is normative.**

Everything an implementation is judged on is defined here. Where a real-world
system would leave a detail to the implementation, this document picks one
behaviour and says so explicitly; "implementation-defined" appears nowhere. Two
independent implementations that follow this document must agree, byte for
byte, on every output the conformance suite inspects.

Nothing in this workspace carries an execute bit: it is seeded from a text
manifest, which carries file contents and not file modes. Every script is
reached through its interpreter - `bash vm.sh`, `bash test.sh` - and the graded
runner restores `vm.sh`'s mode before it spawns it.

---

## 1. What you are building

A single program, reachable through `vm.sh`, that provides:

| Component | Job |
|---|---|
| Assembler | Text assembly (section 4) to a binary module (section 5). |
| Loader / validator | Read a module, reject a malformed one before executing anything (section 13). |
| Virtual machine | Execute a module: a stack machine with call frames, locals, globals, arrays, strings and closures (sections 6-8). |
| Garbage collector | Mark and sweep over a documented root set, with an object budget (section 9). |
| Disassembler | Module back to canonical assembly that reassembles to identical bytes (section 11). |
| Tracer | One line per executed instruction, in a fixed format (section 12). |

No third-party libraries for any of it. The standard library of your language is
fine for I/O, byte buffers, string formatting and collections; a parser
generator, a bytecode library, an existing VM, or an off-the-shelf GC is not.

---

## 2. Terminology and conventions

- **Byte** means an 8-bit value, 0-255. Strings are byte strings; nothing in
  this VM is Unicode-aware.
- **Integer** means a signed 64-bit two's complement value. `INT_MIN` is
  -9223372036854775808 and `INT_MAX` is 9223372036854775807.
- All multi-byte fields in the module format are **little-endian**.
- Offsets written `0x0000` or `0000` in a trace or a disassembly label are byte
  offsets from the start of a function's code array.
- "Raise `E_X`" means: stop execution and report the error exactly as section 10
  requires.
- MUST, MUST NOT and MAY carry their usual force. Everything unqualified is a
  MUST.

---

## 3. Harness contract

This is how the conformance runner and every operator talks to your
implementation. It is exact. An implementation that gets the semantics right and
the contract wrong scores zero, because nothing can drive it.

### 3.1 The entry point

The workspace root contains an executable `vm.sh`:

```sh
#!/usr/bin/env bash
set -euo pipefail
# ... dispatch to your build output ...
```

It is invoked with the workspace as the working directory. It must not need
network access and must not write anywhere except the paths it is given and the
system temporary directory.

### 3.2 Command line

```
vm.sh version
vm.sh asm  [options] <source.asm> <output.svm>
vm.sh dis  [options] <module.svm>
vm.sh run  [options] <module.svm>
vm.sh exec [options] <source.asm>
```

- The subcommand is the first argument and is matched **case-sensitively**.
- Options come after the subcommand and before the positional operands. An
  implementation MAY accept options in other positions; the suite never relies
  on it.
- Any unknown subcommand, unknown option, missing operand or extra operand is a
  usage error: `E_USAGE`, exit status 1.

| Subcommand | Behaviour |
|---|---|
| `version` | Write exactly `svm 1\n` to stdout. Exit 0. |
| `asm` | Assemble `<source.asm>` and write the module to `<output.svm>`. On success exit 0. On failure raise `E_ASM` (exit 2) and do not leave a partially written output file behind that a later step could mistake for a module. |
| `dis` | Load and validate `<module.svm>`, write its canonical disassembly (section 11) to stdout, exit 0. A module that fails validation raises `E_BAD_CODE` (exit 3). |
| `run` | Load, validate and execute `<module.svm>`. |
| `exec` | Assemble `<source.asm>` in memory (or through a temporary file of your choosing) and execute the result. Assembly failure raises `E_ASM` (exit 2); everything after that behaves exactly as `run`. |

### 3.3 Options

| Option | Default | Meaning |
|---|---|---|
| `--trace` | off | Write an execution trace to stderr, format per section 12. Accepted by `run` and `exec`. |
| `--max-depth N` | 256 | Maximum number of simultaneously active call frames, including the entry frame. |
| `--max-stack N` | 1024 | Maximum number of values on **one frame's** operand stack. |
| `--heap N` | 65536 | Maximum number of simultaneously live garbage-collected objects (section 9). |
| `--gc-stress` | off | Run a full collection immediately before every allocation. |

`N` is a decimal integer, given as a separate argument (`--heap 8`, not
`--heap=8`). `N` must be at least 1; anything else is `E_USAGE`. Options that a
subcommand does not use (for example `--heap` on `dis`) are accepted and ignored.

### 3.4 Streams and exit status

- **stdout** carries program output only: whatever `PRINT` and `WRITE` produce,
  the disassembly from `dis`, or the version string. Never a diagnostic.
- **stderr** carries diagnostics only: the trace and the error line.
- Output written before an error occurs must still reach stdout. Buffering is
  fine; losing buffered output on the error path is not.

| Exit status | Meaning |
|---|---|
| 0 | Normal termination. |
| 1 | Usage error (`E_USAGE`). |
| 2 | Assembly error (`E_ASM`). |
| 3 | Module failed validation (`E_BAD_CODE`). |
| 4 | Runtime trap: `E_TYPE`, `E_DIV_ZERO`, `E_RANGE`, `E_VALUE`, `E_UNDEF_GLOBAL`, `E_ARITY`, `E_UNDERFLOW`, `E_ASSERT`. |
| 5 | `E_STACK_OVERFLOW` (call depth or operand stack). |
| 6 | `E_OOM` (heap budget exhausted after a collection). |

---

## 4. The assembly language

### 4.1 Lexical structure

- A source file is a sequence of lines. A line ends at `\n`; a `\r` immediately
  before the `\n` is discarded, so CRLF files assemble identically. A file
  without a final newline is legal.
- `;` begins a comment that runs to the end of the line, **except** inside a
  string literal.
- Leading and trailing whitespace on a line is insignificant. Spaces and tabs
  separate tokens; runs of whitespace are equivalent to one space.
- A line that is empty or contains only a comment produces nothing.
- Mnemonics and directives are matched **case-insensitively**: `PUSH_INT`,
  `push_int` and `Push_Int` are the same instruction. Function names, label
  names and global names are **case-sensitive**.
- An **identifier** matches `[A-Za-z_][A-Za-z0-9_]*`.

### 4.2 Integer literals

- Decimal: an optional `-`, then one or more digits. The value must lie in
  `[INT_MIN, INT_MAX]`; outside that range is `E_ASM`. Leading zeros are
  allowed. `-0` is 0.
- Hexadecimal: `0x` or `0X` followed by 1 to 16 hex digits, case-insensitive.
  The digits denote a 64-bit pattern, which is then read as a signed value:
  `0xffffffffffffffff` is -1. A leading `-` is not allowed on a hex literal.

### 4.3 String literals

A string literal is `"` ... `"` on a single line. An unterminated literal is
`E_ASM`. Inside it, these escapes are recognised:

| Escape | Byte |
|---|---|
| `\\` | 0x5C |
| `\"` | 0x22 |
| `\n` | 0x0A |
| `\r` | 0x0D |
| `\t` | 0x09 |
| `\0` | 0x00 |
| `\xHH` | the byte `HH`, exactly two hex digits, case-insensitive |

Any other character after a backslash is `E_ASM`. `\x` with fewer than two hex
digits is `E_ASM`. Every other byte between the quotes stands for itself,
including bytes above 0x7E. A literal may be empty (`""`).

### 4.4 Function definitions

```
.func <name> arity=<n> locals=<n> [upvals=<n>]
  [.upval local <n>]
  [.upval upval <n>]
  <label>:
  <MNEMONIC> [operand]
  ...
.end
```

- `<name>` is an identifier. Function names must be unique within a source file.
- The three header fields appear in exactly this order. `arity=` and `locals=`
  are required; `upvals=` may be omitted and then means 0. Each value is a
  decimal integer in 0..255; anything else is `E_ASM`.
- `arity` must be less than or equal to `locals`.
- Functions are numbered by order of appearance, from 0. **Function 0 is the
  entry point** and must have `arity=0`. Its name is not otherwise special.
- Exactly `upvals` `.upval` directives must appear, before the first
  instruction of the function and before any label. Their order is the upvalue
  order. `local <n>` captures slot `n` of the frame that executes the `CLOSURE`
  instruction; `upval <n>` captures upvalue `n` of that frame's own closure. Any
  other kind word is `E_ASM`.
- A `.func` inside a function, an `.end` without a `.func`, an instruction
  outside a function, an unknown directive, or a file that ends inside a
  function is `E_ASM`.
- A file must contain at least one function.
- A function's code must not be empty, and its last instruction must be `RET` or
  `HALT`.

### 4.5 Labels

A label is `<identifier>:` and must be the only token on its line. It names the
byte offset of the next instruction emitted in the same function. A label may
sit immediately before `.end`, in which case it names the offset one past the
last instruction — a jump to it is out of range and is rejected by section 13.
Labels are scoped to the function that defines them. Duplicate labels in one
function, and references to labels that are never defined, are `E_ASM`.

### 4.6 Operand forms

| Operand kind | Written as | Instructions |
|---|---|---|
| Integer constant | integer literal (section 4.2) | `PUSH_INT` |
| String constant | string literal (section 4.3) | `PUSH_STR` |
| Global name | identifier, or a string literal | `LOAD_GLOBAL`, `STORE_GLOBAL` |
| Local slot | decimal 0..255, less than the function's `locals` | `LOAD_LOCAL`, `STORE_LOCAL` |
| Upvalue index | decimal 0..255, less than the function's `upvals` | `LOAD_UPVAL`, `STORE_UPVAL` |
| Function reference | function name, or `#<index>` | `CLOSURE` |
| Label | label name | `JMP`, `JMP_IF_FALSE`, `JMP_IF_TRUE` |
| Count | decimal 0..255 | `CALL`, `NEW_ARRAY` |

A global name given as an identifier denotes the same global as the identical
name given as a string: `LOAD_GLOBAL x` and `LOAD_GLOBAL "x"` are the same
instruction and share one constant. A global name must not be empty.

An operand of the wrong shape, an operand where none is expected, a missing
operand, a trailing token after the operand, a count or index outside 0..255, or
a `CLOSURE` naming a function that does not exist is `E_ASM`.

### 4.7 Constant pool construction

The pool must be built exactly this way, because the suite compares module bytes:

1. Walk the functions in source order.
2. For each function, first intern its **name** as a string constant.
3. Then walk that function's instructions in order; for each instruction that
   carries a constant operand — `PUSH_INT` (integer), `PUSH_STR`,
   `LOAD_GLOBAL`, `STORE_GLOBAL` (strings) — intern that operand.

Interning appends a new entry unless an entry with the same **tag and value**
already exists, in which case its index is reused. Integers and strings are
different tags, so the integer `1` and the string `"1"` never share an entry.
Byte-identical strings share one entry. The pool may hold at most 65536 entries;
more is `E_ASM`.

### 4.8 Jump encoding

`JMP`, `JMP_IF_FALSE` and `JMP_IF_TRUE` encode a **signed 16-bit displacement
relative to the address of the following instruction**:

```
displacement = target_offset - (address_of_jump + 3)
```

A displacement outside `[-32768, 32767]` is `E_ASM`.

### 4.9 The assembler validates what it produces

After building a module, the assembler MUST run the module validation of
section 13 over it and reject the source if validation fails, reporting `E_ASM`
(exit 2). A source file can therefore never produce a module that the loader
would refuse.

---

## 5. The module format

A module file (`.svm`) is a header, then the constant pool, then the functions,
with nothing between them and **nothing after the last function**. Trailing
bytes are a validation failure.

### 5.1 Header (16 bytes)

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | 4 | magic | `53 56 4D 31`, the ASCII bytes `SVM1` |
| 4 | 2 | version | 1 |
| 6 | 2 | flags | 0 (reserved) |
| 8 | 4 | constant_count | number of pool entries, 1..65536 |
| 12 | 4 | function_count | number of functions, at least 1 |

Any other magic, any version other than 1, and any non-zero flags word are
rejected.

### 5.2 Constant pool

`constant_count` entries follow the header back to back. Each entry begins with
a one-byte tag:

| Tag | Kind | Payload |
|---|---|---|
| `0x01` | integer | 8 bytes, signed 64-bit little-endian |
| `0x02` | string | 4 bytes unsigned length `L`, then exactly `L` bytes |

Any other tag is rejected. A string's bytes are the string; there is no
terminator and no encoding requirement. Constants are addressed by their
zero-based index.

### 5.3 Functions

`function_count` function records follow the pool back to back:

| Size | Field | Notes |
|---|---|---|
| 4 | name_const | index of a **string** constant |
| 1 | arity | 0..255, must be <= num_locals |
| 1 | num_locals | 0..255 |
| 1 | num_upvalues | 0..255 |
| 1 | reserved | must be 0 |
| 2 x num_upvalues | upvalue descriptors | see below |
| 4 | code_length | in bytes, must be >= 1 |
| code_length | code | the instruction stream |

Each upvalue descriptor is two bytes: a **kind** (`0x00` = capture a local of
the creating frame, `0x01` = capture an upvalue of the creating frame's closure)
and an **index**. Any other kind is rejected.

Function 0 is the entry point and must have `arity` 0.

### 5.4 Instruction encoding

Every instruction is one opcode byte followed by a fixed operand layout that
depends only on the opcode:

| Operand layout | Bytes |
|---|---|
| none | 0 |
| `u8` | 1 |
| `u16` | 2, little-endian |
| `i16` | 2, little-endian, signed |

An opcode byte that is not in the table of section 6, or an instruction whose
operand bytes run past the end of the code array, is rejected.

### 5.5 Worked example

`reference-io/smoke.asm`:

```
.func main arity=0 locals=0
  PUSH_STR "hello, svm"
  PRINT
  PUSH_INT 6
  PUSH_INT 7
  MUL
  PRINT
  RET
.end
```

assembles to exactly these 83 bytes:

```
offset  bytes                        meaning
0000    53 56 4d 31                  magic "SVM1"
0004    01 00                        version 1
0006    00 00                        flags 0
0008    04 00 00 00                  constant_count = 4
000c    01 00 00 00                  function_count = 1
0010    02 04 00 00 00 6d 61 69 6e   k0: string "main"
0019    02 0a 00 00 00               k1: string, length 10
001e    68 65 6c 6c 6f 2c 20 73 76 6d    "hello, svm"
0028    01 06 00 00 00 00 00 00 00   k2: integer 6
0031    01 07 00 00 00 00 00 00 00   k3: integer 7
003a    00 00 00 00                  fn0 name_const = 0
003e    00 00 00 00                  arity 0, locals 0, upvalues 0, reserved 0
0042    0d 00 00 00                  code_length = 13
0046    05 01 00                     PUSH_STR k1
0049    80                           PRINT
004a    04 02 00                     PUSH_INT k2
004d    04 03 00                     PUSH_INT k3
0050    22                           MUL
0051    80                           PRINT
0052    51                           RET
```

as one hex string:

```
53564d3101000000040000000100000002040000006d61696e020a00000068656c6c6f2c
2073766d01060000000000000001070000000000000000000000000000000d0000000501
0080040200040300228051
```

Note the pool order: the function's own name is interned first, then the
constants of its body in the order the instructions appear.

---

## 6. Instruction set

Stack effects are written `before -- after`, with the top of the stack on the
right. Every instruction that pops fewer values than are present leaves the rest
untouched. Popping from an empty operand stack raises `E_UNDERFLOW`.

### 6.1 Stack and constants

| Opcode | Mnemonic | Operand | Effect | Semantics |
|---|---|---|---|---|
| `0x00` | `NOP` | — | `--` | Nothing. |
| `0x01` | `PUSH_NIL` | — | `-- nil` | |
| `0x02` | `PUSH_TRUE` | — | `-- true` | |
| `0x03` | `PUSH_FALSE` | — | `-- false` | |
| `0x04` | `PUSH_INT` | `u16` k | `-- v` | Push integer constant `k`. `k` must be an integer constant. |
| `0x05` | `PUSH_STR` | `u16` k | `-- v` | Push string constant `k`. `k` must be a string constant. The value is the permanent constant object itself (section 9). |
| `0x06` | `POP` | — | `v --` | |
| `0x07` | `DUP` | — | `v -- v v` | Copies the reference, not the object. |
| `0x08` | `SWAP` | — | `a b -- b a` | |

### 6.2 Variables

| Opcode | Mnemonic | Operand | Effect | Semantics |
|---|---|---|---|---|
| `0x10` | `LOAD_LOCAL` | `u8` i | `-- v` | Push local slot `i` of the current frame. |
| `0x11` | `STORE_LOCAL` | `u8` i | `v --` | Pop and store into slot `i`. |
| `0x12` | `LOAD_GLOBAL` | `u16` k | `-- v` | Push the global named by string constant `k`. Undefined name raises `E_UNDEF_GLOBAL`. |
| `0x13` | `STORE_GLOBAL` | `u16` k | `v --` | Pop and store, defining the global if it does not exist. |
| `0x14` | `LOAD_UPVAL` | `u8` i | `-- v` | Push upvalue `i` of the current frame's closure. |
| `0x15` | `STORE_UPVAL` | `u8` i | `v --` | Pop and store into upvalue `i` of the current frame's closure. The change persists in that closure object and is visible to later calls of the same closure. |

### 6.3 Arithmetic

All arithmetic operands must be integers; anything else raises `E_TYPE`.

| Opcode | Mnemonic | Effect | Semantics |
|---|---|---|---|
| `0x20` | `ADD` | `a b -- a+b` | Wrapping two's complement. |
| `0x21` | `SUB` | `a b -- a-b` | Wrapping. |
| `0x22` | `MUL` | `a b -- a*b` | Wrapping (the low 64 bits of the product). |
| `0x23` | `DIV` | `a b -- a/b` | Truncated toward zero. `b == 0` raises `E_DIV_ZERO`. `INT_MIN / -1` wraps to `INT_MIN`. |
| `0x24` | `MOD` | `a b -- a%b` | Remainder of the truncated division: the result has the sign of `a`, and `(a/b)*b + a%b == a` under wrapping. `b == 0` raises `E_DIV_ZERO`. `INT_MIN % -1` is 0. |
| `0x25` | `NEG` | `a -- -a` | Wrapping; `NEG INT_MIN` is `INT_MIN`. |
| `0x26` | `NOT` | `a -- b` | Push `true` if `a` is falsey, else `false`. Accepts any type. |
| `0x27` | `BAND` | `a b -- a&b` | |
| `0x28` | `BOR` | `a b -- a\|b` | |
| `0x29` | `BXOR` | `a b -- a^b` | |
| `0x2A` | `BNOT` | `a -- ~a` | |
| `0x2B` | `SHL` | `a n -- a<<n` | Wrapping; bits shifted out are discarded. `n` outside 0..63 raises `E_RANGE`. |
| `0x2C` | `SHR` | `a n -- a>>n` | Arithmetic (sign-propagating) shift. `n` outside 0..63 raises `E_RANGE`. |

Examples that pin the division rules: `7/2 = 3`, `-7/2 = -3`, `7/-2 = -3`,
`-7/-2 = 3`, `7%2 = 1`, `-7%2 = -1`, `7%-2 = 1`, `-7%-2 = -1`.

### 6.4 Comparison

| Opcode | Mnemonic | Effect | Semantics |
|---|---|---|---|
| `0x30` | `EQ` | `a b -- bool` | See section 7.3. Never raises. |
| `0x31` | `NE` | `a b -- bool` | The negation of `EQ`. |
| `0x32` | `LT` | `a b -- bool` | Ordering, section 7.4. |
| `0x33` | `LE` | `a b -- bool` | |
| `0x34` | `GT` | `a b -- bool` | |
| `0x35` | `GE` | `a b -- bool` | |

### 6.5 Control flow

| Opcode | Mnemonic | Operand | Effect | Semantics |
|---|---|---|---|---|
| `0x40` | `JMP` | `i16` d | `--` | `pc = pc + 3 + d`. |
| `0x41` | `JMP_IF_FALSE` | `i16` d | `v --` | Pops. Jumps if `v` is falsey. |
| `0x42` | `JMP_IF_TRUE` | `i16` d | `v --` | Pops. Jumps if `v` is truthy. |
| `0x50` | `CALL` | `u8` n | `f a1..an -- r` | Call, section 8.2. |
| `0x51` | `RET` | — | `... --` | Return, section 8.3. |
| `0x52` | `CLOSURE` | `u16` f | `-- closure` | Create a closure over function `f`, capturing its upvalues from the current frame per the descriptors. |

Both conditional jumps pop their operand whether or not the branch is taken.

### 6.6 Arrays

| Opcode | Mnemonic | Operand | Effect | Semantics |
|---|---|---|---|---|
| `0x60` | `NEW_ARRAY` | `u8` n | `v1..vn -- arr` | Pop `n` values; `v1` becomes element 0. Allocates. |
| `0x61` | `ARR_GET` | — | `arr i -- v` | `E_TYPE` if `arr` is not an array or `i` is not an integer; `E_RANGE` if `i < 0` or `i >= len`. |
| `0x62` | `ARR_SET` | — | `arr i v --` | Same checks; pushes nothing. |
| `0x63` | `ARR_PUSH` | — | `arr v --` | Append; the array grows by one. Pushes nothing. Does not allocate a new object. |
| `0x64` | `ARR_POP` | — | `arr -- v` | Remove and push the last element. `E_RANGE` on an empty array. |
| `0x65` | `LEN` | — | `v -- n` | Length of a string in bytes or of an array in elements. Any other type raises `E_TYPE`. |

### 6.7 Strings

| Opcode | Mnemonic | Effect | Semantics |
|---|---|---|---|
| `0x70` | `CONCAT` | `a b -- ab` | Both must be strings. Always allocates. |
| `0x71` | `SUBSTR` | `s start len -- t` | Byte slice. `E_RANGE` unless `start >= 0`, `len >= 0` and `start + len <= LEN(s)`; there is **no clamping**. Always allocates. |
| `0x72` | `INDEXOF` | `hay needle -- i` | Byte index of the first occurrence, or -1. An empty needle gives 0. Both must be strings. |
| `0x73` | `TOSTR` | `v -- s` | The display form of `v` (section 7.5). Always allocates. |
| `0x74` | `TOINT` | `v -- i` | Integer: unchanged. `true`/`false`: 1/0. String: optional `+` or `-`, then one or more decimal digits, and nothing else — the whole string must be consumed. A malformed string raises `E_VALUE`; a well-formed one outside the 64-bit range raises `E_RANGE`. `nil`, arrays and closures raise `E_TYPE`. |
| `0x75` | `CHR` | `i -- s` | One-byte string. `i` outside 0..255 raises `E_RANGE`. Always allocates. |
| `0x76` | `ORD` | `s -- i` | The first byte of `s`, 0..255. Empty string raises `E_RANGE`. |

### 6.8 Output, introspection and the heap

| Opcode | Mnemonic | Effect | Semantics |
|---|---|---|---|
| `0x80` | `PRINT` | `v --` | Write the display form of `v` followed by `\n` (0x0A) to stdout. |
| `0x81` | `WRITE` | `v --` | Write the display form of `v` to stdout with no newline. |
| `0x82` | `TYPEOF` | `v -- s` | One of `nil`, `bool`, `int`, `str`, `array`, `fn`. Always allocates. |
| `0x83` | `ASSERT` | `v --` | Pops; if `v` is falsey, raise `E_ASSERT`. |
| `0x90` | `GC` | `--` | Run a full collection now. |
| `0x91` | `GCLIVE` | `-- n` | Run a full collection, then push the number of live objects as an integer (section 9.5). |
| `0x92` | `HALT` | `--` | Stop the program immediately with exit status 0. Any remaining frames and stack values are discarded. |

Opcodes not listed anywhere in section 6 do not exist and are rejected by
validation.

---

## 7. Values

### 7.1 The six types

`nil`, `bool`, `int`, `str`, `array`, `fn` (a closure). There are no floating
point numbers anywhere in this VM.

`str`, `array` and `fn` are **reference** types: a value of these types is a
reference to an object. `DUP`, `STORE_LOCAL`, `ARR_PUSH` and argument passing
copy the reference, never the object. Strings are immutable; arrays are mutable;
a closure's upvalue slots are mutable through `STORE_UPVAL`.

### 7.2 Truthiness

`nil` and `false` are falsey. **Everything else is truthy**, including the
integer 0, the empty string, and the empty array.

### 7.3 Equality

`EQ` never raises. Values of different types are never equal — there is no
numeric or string coercion, so `1` and `"1"`, and `0` and `false`, are all
unequal.

| Type | Equal when |
|---|---|
| `nil` | always (both are nil) |
| `bool` | same value |
| `int` | same value |
| `str` | same byte content, regardless of identity |
| `array` | the same object (identity) |
| `fn` | the same object (identity) |

Two `CLOSURE` instructions over the same function produce two distinct closures
that are not equal.

### 7.4 Ordering

`LT`, `LE`, `GT` and `GE` are defined for two integers and for two strings, and
raise `E_TYPE` for everything else, including two `nil`s, two booleans, two
arrays, and any mixed pair. Strings compare lexicographically by unsigned byte
value; a prefix sorts before the longer string.

### 7.5 Display form

This is what `PRINT`, `WRITE` and `TOSTR` produce.

| Value | Display |
|---|---|
| `nil` | `nil` |
| `true` / `false` | `true` / `false` |
| integer | decimal, with a leading `-` when negative and no `+` or padding |
| string | its bytes, verbatim, with no quotes and no escaping |
| array | `[`, the elements separated by `, ` (comma then one space), `]`; the empty array is `[]` |
| closure | `<fn NAME>`, where `NAME` is the function's name from the constant pool |

Inside an array, a string element is rendered **quoted and escaped** rather than
verbatim: a `"`, then each byte as `\\`, `\"`, `\n`, `\r`, `\t`, or `\xHH` with
two **lowercase** hex digits for any byte below 0x20 or above 0x7E, or the byte
itself otherwise, then a closing `"`. Nested arrays and closures use their own
display form recursively.

An array that is reachable from itself renders as `[...]` at the point where the
cycle closes: while rendering an array, if an element is an array that is
already being rendered further up the current path, emit exactly `[...]` for it.
So an array that contains itself prints as `[[...]]`.

---

## 8. Execution

### 8.1 Frames

A frame holds:

- the closure being executed (and through it, the function and its upvalues),
- a program counter, a byte offset into that function's code,
- `num_locals` local slots, every one of them initialised to `nil`,
- its own operand stack, empty at entry.

A frame's operand stack is private. A callee cannot see or pop the caller's
values; a caller cannot see what the callee left behind. Attempting to pop past
the bottom of the current frame's stack raises `E_UNDERFLOW`.

Execution starts in frame 1, running function 0 through a closure the VM creates
for it with no upvalues. Its locals are `nil` and its stack is empty. If control
reaches the end of a function's code without a `RET` or `HALT`, the module was
invalid and section 13 should have rejected it.

### 8.2 CALL

`CALL n` expects the callee below its arguments: push the closure, then argument
1 through argument `n`, then execute `CALL n`.

1. Pop `n` values as the arguments, then pop one more as the callee.
2. If the callee is not a closure, raise `E_TYPE`.
3. If `n` does not equal the callee's arity, raise `E_ARITY`.
4. If the number of active frames is already `--max-depth`, raise
   `E_STACK_OVERFLOW`.
5. Push a new frame. Argument 1 goes to local slot 0, argument 2 to slot 1, and
   so on; the remaining slots are `nil`.

### 8.3 RET

1. If the current frame's operand stack is non-empty, the top value is the
   return value; if it is empty, the return value is `nil`. Anything else left
   on that frame's stack is discarded.
2. Pop the frame.
3. If that was the entry frame, the program terminates with exit status 0 and
   the return value is discarded — it is **not** an exit code.
4. Otherwise push the return value onto the caller's operand stack.

### 8.4 Limits

- **Call depth.** At most `--max-depth` frames are active at once, counting the
  entry frame. Exceeding it raises `E_STACK_OVERFLOW` (exit 5). With the default
  of 256, a chain of 255 nested calls below `main` is fine and the 256th call
  fails.
- **Operand stack.** At most `--max-stack` values on **one** frame's stack.
  Pushing past it raises `E_STACK_OVERFLOW` (exit 5). The limit is per frame:
  ten frames each holding 100 values are within the default.

Neither limit may be enforced by relying on the host language's own stack. A
recursive interpreter that overflows the host stack before reaching
`--max-depth` fails this specification.

---

## 9. Memory and garbage collection

The object model here is **observable behaviour**, not an implementation
suggestion. However you represent values internally, `GCLIVE` and `--heap` must
report and enforce exactly the counts this section defines.

### 9.1 What is an object

A garbage-collected object is one of:

- a string created at runtime,
- an array,
- a closure.

Two things are **permanent**: every string in the constant pool, and the entry
closure the VM creates for function 0. Permanent objects are always reachable,
are never collected, are never counted by `GCLIVE`, and are never charged
against the heap budget.

Runtime strings are never interned. Two `CONCAT` operations producing the same
bytes produce two distinct objects.

### 9.2 What allocates

Exactly these operations allocate, and each allocates exactly **one** object,
every time, with no fast paths or caching:

| Operation | Object |
|---|---|
| `NEW_ARRAY` | array |
| `CLOSURE` | closure |
| `CONCAT` | string (even when the result is empty) |
| `SUBSTR` | string (even when the result is empty or equals the whole input) |
| `TOSTR` | string |
| `TYPEOF` | string |
| `CHR` | string |

Nothing else allocates. `PUSH_STR` pushes the permanent constant object.
`ARR_PUSH` grows an array in place. `DUP` copies a reference.

### 9.3 The root set

A collection marks from exactly these roots, and from nothing else:

1. Every local slot of **every** active frame, not only the innermost.
2. Every value on the operand stack of **every** active frame.
3. The closure of every active frame.
4. Every value in the global table.
5. The operands of the operation currently executing: any value an instruction
   has conceptually consumed but whose work is not finished is still a root for
   the duration of an allocation that instruction performs. `CONCAT` must not
   lose its two input strings to a collection triggered by its own allocation.

From those roots, marking follows: array elements, closure upvalues. Everything
unmarked is swept.

### 9.4 The budget

`--heap N` bounds the number of live objects. Let `allocated` be the number of
objects the allocator currently holds.

1. If `--gc-stress` is set, run a full collection.
2. Otherwise, if `allocated == N`, run a full collection.
3. If `allocated == N` still, raise `E_OOM` (exit 6).
4. Allocate; `allocated` becomes `allocated + 1`.

A program that never keeps more than `N - 1` objects reachable therefore
completes under any `N`, no matter how much garbage it creates. A program that
needs `N + 1` live objects at once fails deterministically.

### 9.5 GCLIVE

`GCLIVE` runs a full collection and then pushes the number of surviving objects.
Because the collection happens first, the count never includes garbage that has
not been noticed yet, which makes it identical across implementations. The
integer it pushes is a value, not an object.

`GC` runs the same collection and pushes nothing.

Cycles must be reclaimed. A pair of arrays that reference each other and are
reachable from nothing else is garbage, and a run of the conformance suite
proves it: a loop that builds and abandons thousands of such pairs must complete
inside a heap of eight objects.

---

## 10. Errors

### 10.1 The error line

On any failure, write **one** line to stderr:

```
error: <CODE>
```

or, if you want to say more,

```
error: <CODE>: <anything you like>
```

The line must begin with `error: ` followed immediately by the code. The suite
reads the first stderr line that matches `^error: (E_[A-Z_]+)\b` and compares
only the code, so the trailing detail is yours to choose — a function name, a
program counter, an offending value. Exactly one such line per failed run.

A successful run (exit 0) must not write any line starting with `error: `.

### 10.2 The codes

| Code | Exit | Raised when |
|---|---|---|
| `E_USAGE` | 1 | Bad command line. |
| `E_ASM` | 2 | The assembler rejected the source. |
| `E_BAD_CODE` | 3 | Module validation failed (section 13). |
| `E_TYPE` | 4 | An operand had the wrong type. |
| `E_DIV_ZERO` | 4 | `DIV` or `MOD` by zero. |
| `E_RANGE` | 4 | Index, shift count, substring window, byte value or array pop out of range. |
| `E_VALUE` | 4 | `TOINT` on a string that is not an integer. |
| `E_UNDEF_GLOBAL` | 4 | `LOAD_GLOBAL` of a name never stored. |
| `E_ARITY` | 4 | `CALL n` where `n` is not the callee's arity. |
| `E_UNDERFLOW` | 4 | Pop from an empty frame operand stack. |
| `E_ASSERT` | 4 | `ASSERT` on a falsey value. |
| `E_STACK_OVERFLOW` | 5 | Call-depth or operand-stack limit exceeded. |
| `E_OOM` | 6 | Heap budget exhausted after a collection. |

A trap terminates the program immediately. There is no exception handling in
this VM: nothing catches, nothing unwinds beyond stopping.

---

## 11. Canonical disassembly

`dis` writes a text form of the module that, fed back to `asm`, produces a
byte-identical module. The suite checks both the exact text for a few modules
and the round-trip property for many.

```
; svm disassembly
.func <name> arity=<n> locals=<n> upvals=<n>
  .upval local <n>
  LOAD_LOCAL 0
L0018:
  RET
.end
```

Rules:

- The first line is exactly `; svm disassembly`.
- One `.func` line per function, in index order, always printing all three
  header fields including `upvals=0`. The name is the function's name constant.
- `.upval` lines come next, one per upvalue in order, indented two spaces.
- Instructions are indented two spaces; mnemonics are uppercase.
- A label line `L<offset>:` at column 0 precedes any instruction that is the
  target of a jump within the same function, where `<offset>` is the four-digit
  lowercase hex byte offset of that instruction. Offsets that nothing jumps to
  get no label.
- Jump operands are written as those labels.
- `.end` at column 0 closes each function. There are no blank lines anywhere,
  and the file ends with a newline after the final `.end`.
- `PUSH_INT` prints its value in decimal. `PUSH_STR` prints the string literal
  using the canonical escapes of section 7.5 (`\\`, `\"`, `\n`, `\r`, `\t`,
  `\xHH` lowercase, otherwise the byte itself).
- `LOAD_GLOBAL` and `STORE_GLOBAL` print a bare identifier when the name matches
  `[A-Za-z_][A-Za-z0-9_]*`, and a quoted, escaped string literal otherwise.
- `CLOSURE` prints the target function's name when that name is unique across
  the module and is a valid identifier, and `#<index>` in decimal otherwise.
- All other operands print in decimal.

---

## 12. Trace format

With `--trace`, write one line to stderr **before** executing each instruction:

```
trace: depth=<d> fn=<f> pc=<pppp> op=<MNEMONIC> sp=<s>
```

| Field | Meaning |
|---|---|
| `depth` | Number of active frames, in decimal. The entry frame is 1. |
| `fn` | Index of the function being executed, in decimal. |
| `pc` | Byte offset of the opcode within its function's code, four lowercase hex digits, zero-padded. |
| `op` | The uppercase mnemonic. |
| `sp` | Number of values on the current frame's operand stack **before** the instruction runs, in decimal. |

Exactly one space between fields, no trailing space. The trace of a trapping
program ends with the line for the instruction that trapped, followed by the
error line. No other line written to stderr may begin with `trace: `.

A four-instruction example, `PUSH_INT 6; PUSH_INT 7; MUL; PRINT`, at the top of
`main`:

```
trace: depth=1 fn=0 pc=0000 op=PUSH_INT sp=0
trace: depth=1 fn=0 pc=0003 op=PUSH_INT sp=1
trace: depth=1 fn=0 pc=0006 op=MUL sp=2
trace: depth=1 fn=0 pc=0007 op=PRINT sp=1
```

---

## 13. Module validation

`run` and `dis` must validate a module completely **before** executing anything
or printing anything, and `asm` must run the same checks over what it just built
(section 4.9). A module that fails any check is rejected with `E_BAD_CODE`
(exit 3), or `E_ASM` (exit 2) when the assembler is the one rejecting it.

Structural checks:

1. The file is at least 16 bytes and begins with `SVM1`.
2. `version` is 1 and `flags` is 0.
3. `constant_count` is 1..65536 and `function_count` is at least 1.
4. Every constant's tag is `0x01` or `0x02`, and every constant's payload lies
   inside the file.
5. Every function record, including its upvalue descriptors and its code array,
   lies inside the file.
6. There are no bytes after the last function record.

Per-function checks:

7. `name_const` is in range and names a **string** constant.
8. `arity <= num_locals`.
9. `reserved` is 0.
10. Every upvalue descriptor kind is 0 or 1.
11. `code_length >= 1`.
12. The code decodes cleanly from offset 0: every opcode exists, and no
    instruction's operands run past the end of the code array.
13. The last instruction is `RET` or `HALT`.
14. Function 0 has `arity == 0`.

Per-instruction checks (using the decode from check 12):

15. `PUSH_INT` names an integer constant that exists; `PUSH_STR`,
    `LOAD_GLOBAL` and `STORE_GLOBAL` name a string constant that exists.
16. `LOAD_LOCAL` and `STORE_LOCAL` indices are less than `num_locals`.
17. `LOAD_UPVAL` and `STORE_UPVAL` indices are less than `num_upvalues`.
18. `CLOSURE` names a function index that exists.
19. For each `CLOSURE f` appearing in function `F`, every upvalue descriptor of
    `f` is satisfiable from `F`: a `local` descriptor's index is less than
    `F.num_locals`, and an `upval` descriptor's index is less than
    `F.num_upvalues`.
20. Every jump lands inside the same function's code array **and on the first
    byte of an instruction**. A jump into the middle of an instruction's
    operands is invalid.

A global name constant must not be the empty string.

---

## 14. The conformance suite

The suite is the grader and it is **not in this workspace**. It is
materialized outside it, after this process has exited, and it drives `vm.sh`
from there. There is no case file here to read, and reading one would be a
failed run rather than a clever one.

What is here is `reference-io/` and the visible check `bash test.sh`, which runs
the checklist in `reference-io/README.md`.

The runner drives `vm.sh` as an opaque subprocess: nothing in it is written in
the language of this workspace, and nothing in it knows what that language is.

Each case names a **mode**, which is how the runner drives you:

| Mode | What the runner does | What it checks |
|---|---|---|
| `exec` | `vm.sh exec [args] <case.asm>` | exit status, stdout byte for byte, error code |
| `run` | writes `input_hex` to a file (or assembles `source` first), then `vm.sh run [args] <file>` | the same |
| `asm` | `vm.sh asm [args] <case.asm> <tmp.svm>` | exit status, error code, and the output bytes against `expect_bytes_hex` when present |
| `dis` | assembles `source` or writes `input_hex`, then `vm.sh dis <file>` | exit status, stdout byte for byte |
| `roundtrip` | `asm` → `dis` → `asm` again | all three exit 0 and the two modules are byte-identical |
| `trace` | `vm.sh exec --trace [args] <case.asm>` | exit status, stdout, error code, and the `trace: ` lines in order |

A case's `args` are extra options passed straight through, for example
`["--heap", "8"]` or `["--max-depth", "20"]`.

The groups, in the order the runner reports them:

| Group | What it pins down |
|---|---|
| `asmerr` | Source the assembler must reject, and source it must accept. |
| `binary` | Byte-exact module output, pool interning order, canonical disassembly, round-tripping. |
| `loader` | Hand-built byte images that validation must refuse. |
| `arith`, `bitwise`, `compare` | The numeric and comparison semantics, including every overflow and range edge. |
| `strops` | String operations and conversions. |
| `control`, `locals`, `globals`, `calls` | Jumps, slots, the global table, frames. |
| `closures` | Capture by value, upvalue mutation, capture chains. |
| `arrays`, `display` | Reference semantics and the display form, cycles included. |
| `errors` | Every trap, its exit status, and output surviving the failure. |
| `depth` | Both limits, either side of the boundary. |
| `gc` | Allocation counting, roots, cycles, the budget, stress. |
| `trace` | Exact trace output. |
| `integration` | Whole algorithms: a sieve, a sort, Ackermann, a memoised Fibonacci. |

Every case is independent: a fresh process, a fresh heap, a fresh global table.

### 14.1 What counts as cheating

The suite is a sample of the specification, not the definition of it. Detecting
a particular case — by file name, by source text, by a hash of the input, by the
exact byte sequence a case uses — and producing the expected answer without
implementing the behaviour is an automatic failure of the whole task, no matter
what the pass rate says. So is special-casing a constant that only appears in
one test. Implement section 4 through section 13; the cases will pass on their
own.

---

## 15. Deliverables

In the workspace:

| Path | Required | Contents |
|---|---|---|
| `vm.sh` | yes | The harness entry point of section 3. |
| `build.sh` | yes | Compile or install. Exit 0. No network. A no-op for interpreted languages. |
| `run.sh` | yes | Forwards its arguments to `vm.sh`. |
| `test.sh` | yes | The visible check: `reference-io/check_refio.py`. Do not weaken it. |
| `NOTES.md` | yes | What is built, what is left out, and the pass rate last measured per group. |
| `src/` | yes | The implementation. |

`reference-io/` holds worked input/output examples for the harness contract, and
`reference-io/check_refio.py` runs the checklist over all of them. Check the
plumbing against them before anything else; they are the fastest way to find out
that `asm` writes to the wrong path or that an exit code is off by one.

---

## Appendix A: opcode summary

| Hex | Mnemonic | Operand | | Hex | Mnemonic | Operand |
|---|---|---|---|---|---|---|
| `00` | `NOP` | — | | `40` | `JMP` | `i16` |
| `01` | `PUSH_NIL` | — | | `41` | `JMP_IF_FALSE` | `i16` |
| `02` | `PUSH_TRUE` | — | | `42` | `JMP_IF_TRUE` | `i16` |
| `03` | `PUSH_FALSE` | — | | `50` | `CALL` | `u8` |
| `04` | `PUSH_INT` | `u16` | | `51` | `RET` | — |
| `05` | `PUSH_STR` | `u16` | | `52` | `CLOSURE` | `u16` |
| `06` | `POP` | — | | `60` | `NEW_ARRAY` | `u8` |
| `07` | `DUP` | — | | `61` | `ARR_GET` | — |
| `08` | `SWAP` | — | | `62` | `ARR_SET` | — |
| `10` | `LOAD_LOCAL` | `u8` | | `63` | `ARR_PUSH` | — |
| `11` | `STORE_LOCAL` | `u8` | | `64` | `ARR_POP` | — |
| `12` | `LOAD_GLOBAL` | `u16` | | `65` | `LEN` | — |
| `13` | `STORE_GLOBAL` | `u16` | | `70` | `CONCAT` | — |
| `14` | `LOAD_UPVAL` | `u8` | | `71` | `SUBSTR` | — |
| `15` | `STORE_UPVAL` | `u8` | | `72` | `INDEXOF` | — |
| `20` | `ADD` | — | | `73` | `TOSTR` | — |
| `21` | `SUB` | — | | `74` | `TOINT` | — |
| `22` | `MUL` | — | | `75` | `CHR` | — |
| `23` | `DIV` | — | | `76` | `ORD` | — |
| `24` | `MOD` | — | | `80` | `PRINT` | — |
| `25` | `NEG` | — | | `81` | `WRITE` | — |
| `26` | `NOT` | — | | `82` | `TYPEOF` | — |
| `27` | `BAND` | — | | `83` | `ASSERT` | — |
| `28` | `BOR` | — | | `90` | `GC` | — |
| `29` | `BXOR` | — | | `91` | `GCLIVE` | — |
| `2A` | `BNOT` | — | | `92` | `HALT` | — |
| `2B` | `SHL` | — | | `30` | `EQ` | — |
| `2C` | `SHR` | — | | `31` | `NE` | — |
| `32` | `LT` | — | | `33` | `LE` | — |
| `34` | `GT` | — | | `35` | `GE` | — |

## Appendix B: a suggested order of work

Nothing here is required, but this order gets a working system earliest and
makes each conformance group light up in turn.

1. Value representation, the display form, and `PRINT`. Then the module reader
   and `run` for a hand-built module - `reference-io/min.svm.hex` is 38 bytes.
2. The assembler: lexer, `.func` parsing, constant interning, label fixups.
   Group `binary` starts passing once the pool order is right.
3. The interpreter loop: stack, locals, arithmetic, jumps. Groups `arith`,
   `bitwise`, `compare`, `control`, `locals`.
4. Frames, `CALL`, `RET`, the depth limit. Groups `calls`, `depth`.
5. Arrays, strings, globals, closures. Groups `arrays`, `strops`, `globals`,
   `closures`, `display`.
6. Validation, the error codes, the exit statuses. Groups `loader`, `asmerr`,
   `errors`.
7. The disassembler and the round-trip property.
8. The collector last, because everything else exercises it: object counting,
   the root set, mark and sweep, the budget, `GCLIVE`. Group `gc`.
9. The tracer, which is half an hour once the interpreter loop is clean.
