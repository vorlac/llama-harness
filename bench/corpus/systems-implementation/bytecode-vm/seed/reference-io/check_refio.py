#!/usr/bin/env python3
"""The visible check: the checklist in `reference-io/README.md`.

    python3 reference-io/check_refio.py --vm vm.sh

Five worked programs and the exact output each must produce: byte-exact
assembly for two of them, byte-exact disassembly for three, the round-trip
property, the two traces, the collector's counts under a heap of eight, and the
trap's exit status and error code.

This is not the grader. It checks the plumbing of `SPEC.md` section 3 and one
worked example of each subcommand; the 1077-case conformance suite that grades
the workspace is not in this workspace.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


class Checker:
    def __init__(self, vm, scratch):
        self.vm = vm
        self.scratch = Path(scratch)
        self.problems = []

    def run(self, *arguments):
        return subprocess.run(
            ["bash", str(self.vm)] + [str(item) for item in arguments],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
        )

    def expect(self, label, condition, detail=""):
        if condition:
            print("%-34s ok" % label)
        else:
            print("%-34s FAIL" % label)
            self.problems.append("%s: %s" % (label, detail))

    def check_version(self):
        done = self.run("version")
        self.expect(
            "version",
            done.returncode == 0 and done.stdout == b"svm 1\n" and done.stderr == b"",
            repr((done.returncode, done.stdout, done.stderr)),
        )

    def check_assembly(self, name):
        image = self.scratch / (name + ".svm")
        done = self.run("asm", HERE / (name + ".asm"), image)
        if done.returncode != 0:
            self.expect("asm %s" % name, False, done.stderr.decode("utf-8", "replace"))
            return None
        want = bytes.fromhex(
            (HERE / (name + ".svm.hex")).read_text().replace("\n", "").strip()
        )
        self.expect("asm %s bytes" % name, image.read_bytes() == want, "bytes differ")
        return image

    def check_disassembly(self, name, image):
        if image is None:
            return
        done = self.run("dis", image)
        want = (HERE / (name + ".dis")).read_bytes()
        self.expect(
            "dis %s" % name,
            done.returncode == 0 and done.stdout == want,
            done.stderr.decode("utf-8", "replace") or "text differs",
        )
        # Section 11: the disassembly, fed back to the assembler, must produce
        # the same module.
        source = self.scratch / (name + ".round.asm")
        source.write_bytes(done.stdout)
        again = self.scratch / (name + ".round.svm")
        second = self.run("asm", source, again)
        self.expect(
            "roundtrip %s" % name,
            second.returncode == 0 and again.read_bytes() == image.read_bytes(),
            second.stderr.decode("utf-8", "replace") or "modules differ",
        )

    def check_exec(self, name, arguments=()):
        done = self.run("exec", *(list(arguments) + [HERE / (name + ".asm")]))
        want = (HERE / (name + ".expected-stdout")).read_bytes()
        self.expect(
            "exec %s%s" % (name, " " + " ".join(arguments) if arguments else ""),
            done.returncode == 0 and done.stdout == want,
            done.stderr.decode("utf-8", "replace") or repr(done.stdout),
        )

    def check_trace(self, name):
        done = self.run("exec", "--trace", HERE / (name + ".asm"))
        want = (HERE / (name + ".trace")).read_bytes()
        self.expect(
            "trace %s" % name, done.stderr == want, "trace differs"
        )

    def check_trap(self):
        done = self.run("exec", HERE / "trap.asm")
        first = done.stderr.split(b"\n")[0]
        self.expect(
            "trap",
            done.returncode == 4
            and done.stdout == (HERE / "trap.expected-stdout").read_bytes()
            and first.startswith(b"error: E_DIV_ZERO"),
            repr((done.returncode, done.stdout, first)),
        )

    def check_usage(self):
        done = self.run("nonesuch")
        self.expect("unknown subcommand", done.returncode == 1, repr(done.returncode))
        broken = self.scratch / "broken.svm"
        broken.write_bytes(b"NOPE" + bytes(32))
        done = self.run("run", broken)
        self.expect("corrupt module", done.returncode == 3, repr(done.returncode))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vm", default="vm.sh")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as scratch:
        checker = Checker(Path(args.vm).resolve(), scratch)
        checker.check_version()
        for name in ("min", "smoke"):
            image = checker.check_assembly(name)
            checker.check_disassembly(name, image)
        closure = checker.scratch / "closure.svm"
        if checker.run("asm", HERE / "closure.asm", closure).returncode == 0:
            checker.check_disassembly("closure", closure)
        checker.check_exec("smoke")
        checker.check_exec("closure")
        checker.check_exec("gc")
        checker.check_exec("gc", ["--heap", "8", "--gc-stress"])
        checker.check_trace("smoke")
        checker.check_trace("closure")
        checker.check_trap()
        checker.check_usage()
        if checker.problems:
            for problem in checker.problems:
                print(problem, file=sys.stderr)
            print("FAIL %d problem(s)" % len(checker.problems))
            return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
