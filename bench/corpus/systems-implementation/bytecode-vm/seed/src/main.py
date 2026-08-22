# The command line of SPEC.md section 3.
#
# stdout carries program output only and stderr carries diagnostics only, so
# every failure path here flushes stdout first and then writes the one
# `error:` line section 10.1 defines.

import sys

from asm import assemble
from disasm import disassemble
from errors import SvmError
from module import read_module, write_module
from vm import Vm

SUBCOMMANDS = {"version": 0, "asm": 2, "dis": 1, "run": 1, "exec": 1}
COUNTED_OPTIONS = {"--max-depth": "max_depth", "--max-stack": "max_stack", "--heap": "heap"}


class Options:
    def __init__(self):
        self.trace = False
        self.gc_stress = False
        self.max_depth = 256
        self.max_stack = 1024
        self.heap = 65536


def usage(detail: str):
    raise SvmError("E_USAGE", detail)


def parse(argv):
    if not argv:
        usage("no subcommand")
    subcommand = argv[0]
    if subcommand not in SUBCOMMANDS:
        usage("unknown subcommand %r" % subcommand)
    options = Options()
    operands = []
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument == "--trace":
            options.trace = True
            index += 1
            continue
        if argument == "--gc-stress":
            options.gc_stress = True
            index += 1
            continue
        if argument in COUNTED_OPTIONS:
            if index + 1 >= len(argv):
                usage("%s needs a value" % argument)
            text = argv[index + 1]
            if not text.isdigit() or int(text) < 1:
                usage("%s takes a positive integer" % argument)
            setattr(options, COUNTED_OPTIONS[argument], int(text))
            index += 2
            continue
        if argument.startswith("--"):
            usage("unknown option %r" % argument)
        operands.append(argument)
        index += 1
    if len(operands) != SUBCOMMANDS[subcommand]:
        usage(
            "%s takes %d operand(s), given %d"
            % (subcommand, SUBCOMMANDS[subcommand], len(operands))
        )
    return subcommand, options, operands


def read_file(path: str) -> bytes:
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError as exc:
        usage("cannot read %s: %s" % (path, exc.strerror))


def main(argv) -> int:
    out = sys.stdout.buffer
    subcommand, options, operands = parse(argv)
    if subcommand == "version":
        out.write(b"svm 1\n")
        return 0
    if subcommand == "asm":
        module = assemble(read_file(operands[0]))
        image = write_module(module)
        try:
            with open(operands[1], "wb") as handle:
                handle.write(image)
        except OSError as exc:
            usage("cannot write %s: %s" % (operands[1], exc.strerror))
        return 0
    if subcommand == "dis":
        out.write(disassemble(read_module(read_file(operands[0]))))
        return 0
    if subcommand == "run":
        module = read_module(read_file(operands[0]))
    else:
        module = assemble(read_file(operands[0]))
    return Vm(module, options).run()


if __name__ == "__main__":
    try:
        status = main(sys.argv[1:])
    except SvmError as error:
        sys.stdout.buffer.flush()
        sys.stderr.write(error.line() + "\n")
        sys.stderr.flush()
        sys.exit(error.status)
    sys.stdout.buffer.flush()
    sys.exit(status)
