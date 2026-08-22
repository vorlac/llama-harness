# `bytecode-vm` — implementation notes

## What this workspace is

A partial implementation of `SPEC.md`. The assembler, the module format, the
disassembler and its round trip, the whole instruction set, frames and both
limits, the error codes and their exit statuses, the trace, and the
mark-and-sweep collector with its budget are all here. Every worked example in
`reference-io/` passes, including the byte-exact modules and the two traces.

The last graded run of this workspace, against the 1077-case conformance suite,
reported:

```
GROUP asmerr         passed=60 failed=2
GROUP binary         passed=33 failed=0
GROUP loader         passed=39 failed=13
GROUP arith          passed=205 failed=0
GROUP bitwise        passed=100 failed=0
GROUP compare        passed=191 failed=0
GROUP strops         passed=110 failed=0
GROUP control        passed=55 failed=0
GROUP locals         passed=15 failed=0
GROUP globals        passed=12 failed=0
GROUP calls          passed=23 failed=0
GROUP closures       passed=16 failed=1
GROUP arrays         passed=37 failed=2
GROUP display        passed=55 failed=20
GROUP errors         passed=20 failed=0
GROUP depth          passed=19 failed=0
GROUP gc             passed=34 failed=0
GROUP trace          passed=4 failed=0
GROUP integration    passed=11 failed=0
SUMMARY passed=1039 failed=38 total=1077 pass_rate=96.5%
```

Every one of the 38 failures is attributable to one of the two requirements
below: 16 to the missing validation (13 in `loader`, 2 in `asmerr`, 1 in
`closures`) and 22 to the missing display rule (20 in `display`, 2 in `arrays`).

## Unimplemented

### Section 13 — the per-instruction checks, 15 to 20

`src/module.py:read_module` runs the structural and per-function checks 1 to 14:
the header, the pool, every record's extent, the trailing-bytes rule, the clean
decode of section 5.4 and the RET-or-HALT terminator. It does not run checks 15
to 20, which are about what a decoded instruction **refers to**:

- 15: `PUSH_INT` names an integer constant that exists, and `PUSH_STR`,
  `LOAD_GLOBAL` and `STORE_GLOBAL` name a string constant that exists;
- 16 and 17: a local or upvalue index is inside the function's own count;
- 18: `CLOSURE` names a function that exists;
- 19: for each `CLOSURE f` in function `F`, every upvalue descriptor of `f` is
  satisfiable from `F`;
- 20: every jump lands inside the same function's code and on the first byte of
  an instruction.

Section 13 also requires that a global name constant is not the empty string.

Two consequences follow from where this belongs. `src/asm.py:_resolve` already
runs the loader's checks over the module it just built, per section 4.9, so
adding these to `read_module` fixes the assembler at the same time - which is
what the two failing `asmerr` cases are. And `src/vm.py:_closure` carries a
runtime guard for check 19 that reports `E_BAD_CODE`, because a module that
reached execution without being refused still has to end with one `error:` line
rather than a host-level fault; that guard is a backstop and not the check.

### Section 7.5 — a string inside an array

`src/values.py:_render` renders a string the same way at every depth: its bytes,
verbatim. Section 7.5 says that inside an array a string element is rendered
**quoted and escaped** instead - a `"`, then each byte as `\\`, `\"`, `\n`,
`\r`, `\t`, or `\xHH` with two lowercase hex digits for any byte below 0x20 or
above 0x7E, or the byte itself otherwise, then a closing `"`.

`quote` in the same file already produces exactly that form: the disassembler
uses it for `PUSH_STR` operands, where section 11 asks for the same escaping.
What is missing is the distinction between the top level and inside an array, so
`_render` has no way to know which of the two it is producing.

Everything else about the display form is here, the cycle rule included: an
array reachable from itself renders as `[...]` at the point where the cycle
closes, so an array containing itself prints as `[[...]]`.

## Requirements index

| Section | Requirement                                                    | Where                                    |
| ------- | -------------------------------------------------------------- | ---------------------------------------- |
| §3.2    | The five subcommands and their operand counts                    | `src/main.py:parse`                      |
| §3.3    | The five options and their values                                | `src/main.py:parse`                      |
| §3.4    | stdout for output, stderr for diagnostics, the exit statuses     | `src/main.py`                            |
| §4.1    | Lexical structure, case rules, comments                          | `src/asm.py:tokenize`                    |
| §4.2    | Decimal and hexadecimal integer literals                         | `src/asm.py:parse_int_literal`           |
| §4.3    | String literals and their escapes                                | `src/asm.py:tokenize`                    |
| §4.4    | `.func`, `.upval`, `.end` and their rules                        | `src/asm.py:_directive`                  |
| §4.5    | Labels, scoped to their function                                 | `src/asm.py:_label`                      |
| §4.6    | Every operand form                                               | `src/asm.py:_operand`                    |
| §4.7    | Constant-pool interning order                                    | `src/asm.py:Pool`                        |
| §4.8    | Jump displacement encoding                                       | `src/asm.py:_resolve`                    |
| §4.9    | The assembler validates what it produces                         | `src/asm.py:_resolve`                    |
| §5      | The module format, read and written                              | `src/module.py`                          |
| §6      | The instruction set                                              | `src/vm.py`                              |
| §7.1-7.4| The six types, truthiness, equality, ordering                    | `src/values.py`                          |
| §7.5    | The display form, cycles included                                | `src/values.py:_render`                  |
| §7.5    | A string inside an array is quoted and escaped                   | **unimplemented** — see above            |
| §8.1    | Frames: locals, a private operand stack                          | `src/vm.py:Frame`                        |
| §8.2    | `CALL`: argument binding, arity, depth                           | `src/vm.py:_call`                        |
| §8.3    | `RET`: the return value and the caller's stack                   | `src/vm.py:_ret`                         |
| §8.4    | Both limits, neither leaning on the host stack                   | `src/vm.py:_push`, `src/vm.py:_call`     |
| §9      | Objects, the root set, the budget, `GCLIVE`                      | `src/heap.py`                            |
| §10     | The error line, the codes and the exit statuses                  | `src/errors.py`, `src/main.py`           |
| §11     | Canonical disassembly and the round trip                         | `src/disasm.py`                          |
| §12     | The trace format                                                 | `src/vm.py:_loop`                        |
| §13     | Validation, checks 1 to 14                                       | `src/module.py:read_module`              |
| §13     | Validation, checks 15 to 20                                      | **unimplemented** — see above            |

## Design decisions

- **One opcode table.** `src/opcodes.py` is the only place a mnemonic, an opcode
  byte and an operand layout are related, so the assembler, the loader, the
  disassembler and the interpreter cannot disagree about any of the three.
- **Source is bytes, never text.** Section 4.3 lets a string literal carry any
  byte, including bytes above 0x7E, so decoding the file would change what the
  literal denotes. The same is true of program output, which is written to
  `sys.stdout.buffer`.
- **The interpreter is iterative and frames live in a list.** Section 8.4
  forbids leaning on the host language's own stack: a call chain has to reach
  `--max-depth` and raise `E_STACK_OVERFLOW` rather than exhausting the
  interpreter that runs it.
- **Permanent objects are outside the heap.** Constant-pool strings and the
  entry closure are never in `Heap.objects`, so they are never counted by
  `GCLIVE`, never charged against `--heap` and never swept. Neither kind
  references a heap object, so marking never has to traverse one.
- **An allocating instruction hands its own operands to the allocator.** Section
  9.3 item 5 makes them roots for the duration of the allocation, which is why
  `CONCAT` passes both input strings to `Heap.allocate` and `NEW_ARRAY` passes
  every element.
- **The assembler resolves in two passes.** Constants are interned in the first,
  in exactly the order section 4.7 fixes, because the suite compares module
  bytes; function references and jump targets are resolved in the second,
  because a `CLOSURE` may name a function defined later and a label's offset is
  only known once its function is complete.
