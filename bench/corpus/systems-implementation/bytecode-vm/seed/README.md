# `bytecode-vm` workspace

An implementation of SVM, the stack virtual machine pinned by `SPEC.md`: an
assembler, a module format, a disassembler, an interpreter and a mark-and-sweep
collector. What is here is a partial implementation: it passes every worked
example in `reference-io/`, and `NOTES.md` names what it does not meet.

## Layout

```
SPEC.md                    the normative specification; authoritative
NOTES.md                   what is implemented, what is not, and why
build.sh                   a no-op; the VM is Python and runs from source
vm.sh                      the harness entry point, SPEC.md section 3
run.sh                     forwards to vm.sh
test.sh                    the visible check
src/opcodes.py             the opcode table shared by every stage
src/errors.py              the error codes and their exit statuses
src/values.py              the six value types and the display form
src/module.py              the module format and its validation
src/asm.py                 assembly source to a module
src/disasm.py              a module to its canonical disassembly
src/heap.py                the mark-and-sweep collector
src/vm.py                  the interpreter
src/main.py                the command line
reference-io/              five worked programs and the script that checks them
```

## Running it

Nothing here carries an execute bit, so every script is reached through its
interpreter:

```sh
bash vm.sh version
bash vm.sh exec reference-io/smoke.asm
bash vm.sh asm reference-io/smoke.asm /tmp/smoke.svm
bash vm.sh dis /tmp/smoke.svm
bash vm.sh exec --trace reference-io/closure.asm
bash test.sh
```

## The visible check and the graded run

`bash test.sh` runs `reference-io/check_refio.py`, which is the checklist in
`reference-io/README.md`: byte-exact assembly for two modules, byte-exact
disassembly and the round trip for three, the two traces, the collector under a
heap of eight, and the trap's exit status and error code.

The graded run is a 1077-case conformance suite that is **not in this
workspace**. It drives `vm.sh` from outside as an opaque subprocess and checks
exit statuses, stdout byte for byte, error codes, module bytes and trace lines.

## Dependencies

Python 3, standard library only. No third-party package.
