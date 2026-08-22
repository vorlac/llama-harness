# Worked examples for the harness contract

Five programs and the exact output each must produce, for one purpose: to check
the plumbing before anything else. Everything here is derived from `SPEC.md`;
where the two ever disagree, `SPEC.md` wins.

`check_refio.py` runs the whole checklist, and `bash test.sh` calls it:

```sh
python3 reference-io/check_refio.py --vm vm.sh
```

## 1. Version

```sh
$ bash vm.sh version
svm 1
```

Exactly `svm 1` and a newline on stdout. Nothing on stderr.

## 2. The smallest module

`min.asm` is one function containing one `RET`. Assembling it must produce the
38 bytes in `min.svm.hex` (the file wraps the hex across lines; join them). The
program prints nothing and exits 0, and `dis` on it reproduces `min.dis`.

## 3. The worked example

`smoke.asm` is the module dissected field by field in `SPEC.md` section 5.5. It
must assemble to the 83 bytes in `smoke.svm.hex`, disassemble to `smoke.dis`,
print `smoke.expected-stdout`, and trace as `smoke.trace`.

If the assembler produces 83 bytes that are not these 83 bytes, the usual
culprit is constant-pool order: a function's own name is interned before
anything in its body (`SPEC.md` section 4.7).

## 4. A call and a frame

`closure.asm` builds a closure, calls it with one argument, and prints the
result. The trace is where frame bookkeeping shows up: `depth` goes to 2, `fn`
to 1, `pc` restarts at `0000`, and `sp` is the callee's own stack, not the
caller's.

## 5. A trap

`trap.asm` prints a line and then divides by zero. Three things at once: stdout
keeps what was already written, stderr carries one line beginning
`error: E_DIV_ZERO`, and the exit status is 4.

## 6. The collector

`gc.asm` builds a two-array cycle, asks for the live count, drops both
references, and asks again. It must print `2` then `0`, under the default heap
and under `--heap 8 --gc-stress`. A reference-counting collector prints `2`
twice and fails this task.

## 7. Checklist

- [ ] `vm.sh version` prints `svm 1`.
- [ ] `asm` of `min.asm` and `smoke.asm` matches the two `.svm.hex` files byte
      for byte.
- [ ] `dis` of both matches the two `.dis` files byte for byte, and feeding that
      output back to `asm` reproduces the same module.
- [ ] `exec` of `smoke.asm`, `closure.asm` and `gc.asm` matches their
      `.expected-stdout` files.
- [ ] `--trace` output matches `smoke.trace` and `closure.trace`.
- [ ] `trap.asm` exits 4 with `error: E_DIV_ZERO` on stderr and `before` on
      stdout.
- [ ] An unknown subcommand exits 1; a corrupt module exits 3.
