# The interpreter of SPEC.md sections 6 and 8.
#
# The loop is iterative and frames live in a list, because section 8.4 forbids
# leaning on the host language's own stack: a call chain has to reach
# --max-depth and raise E_STACK_OVERFLOW rather than exhausting the interpreter
# that runs it.

import sys

from errors import SvmError
from heap import Heap
from module import operand
from opcodes import BY_OPCODE
from values import (
    Arr,
    Closure,
    INT_MAX,
    INT_MIN,
    Str,
    compare,
    display,
    equal,
    truthy,
    type_name,
    wrap,
)


class Halt(Exception):
    """`HALT`: the program stops with status 0."""


class Frame:
    __slots__ = ("closure", "function", "code", "pc", "locals", "stack")

    def __init__(self, closure, function, code, num_locals, arguments):
        self.closure = closure
        self.function = function
        self.code = code
        self.pc = 0
        self.locals = list(arguments) + [None] * (num_locals - len(arguments))
        self.stack = []


class Vm:
    def __init__(self, module, options, out=None, err=None):
        self.module = module
        self.max_depth = options.max_depth
        self.max_stack = options.max_stack
        self.trace = options.trace
        self.out = out if out is not None else sys.stdout.buffer
        self.err = err if err is not None else sys.stderr
        self.constants = [
            Str(value, permanent=True) if tag == "str" else value
            for tag, value in module.constants
        ]
        self.names = [module.name_of(index) for index in range(len(module.functions))]
        self.globals = {}
        self.frames = []
        self.heap = Heap(options.heap, options.gc_stress, self._roots)

    # -- roots ----------------------------------------------------------

    def _roots(self):
        for frame in self.frames:
            yield frame.closure
            for value in frame.locals:
                yield value
            for value in frame.stack:
                yield value
        for value in self.globals.values():
            yield value

    # -- stack ----------------------------------------------------------

    @staticmethod
    def _pop(frame):
        if not frame.stack:
            raise SvmError("E_UNDERFLOW", "empty operand stack")
        return frame.stack.pop()

    def _push(self, frame, value):
        if len(frame.stack) >= self.max_stack:
            raise SvmError("E_STACK_OVERFLOW", "operand stack of %d" % self.max_stack)
        frame.stack.append(value)

    def _int(self, value):
        if type_name(value) != "int":
            raise SvmError("E_TYPE", "expected an int, found %s" % type_name(value))
        return value

    def _string(self, value):
        if not isinstance(value, Str):
            raise SvmError("E_TYPE", "expected a str, found %s" % type_name(value))
        return value

    # -- execution ------------------------------------------------------

    def run(self) -> int:
        entry = Closure(0, [], permanent=True)
        function = self.module.functions[0]
        self.frames.append(Frame(entry, 0, function.code, function.num_locals, []))
        try:
            self._loop()
        except Halt:
            pass
        return 0

    def _loop(self):
        while self.frames:
            frame = self.frames[-1]
            code = frame.code
            pc = frame.pc
            opcode = code[pc]
            if self.trace:
                self.err.write(
                    "trace: depth=%d fn=%d pc=%04x op=%s sp=%d\n"
                    % (len(self.frames), frame.function, pc, BY_OPCODE[opcode][0], len(frame.stack))
                )
            frame.pc = pc + 1 + (2 if opcode in _WIDE else 1 if opcode in _NARROW else 0)
            self._step(frame, opcode, code, pc)

    def _step(self, frame, opcode, code, pc):
        push = self._push
        pop = self._pop
        if opcode == 0x00:
            return
        if opcode == 0x01:
            return push(frame, None)
        if opcode == 0x02:
            return push(frame, True)
        if opcode == 0x03:
            return push(frame, False)
        if opcode == 0x04 or opcode == 0x05:
            return push(frame, self.constants[operand(code, pc)])
        if opcode == 0x06:
            pop(frame)
            return
        if opcode == 0x07:
            value = pop(frame)
            push(frame, value)
            return push(frame, value)
        if opcode == 0x08:
            top = pop(frame)
            below = pop(frame)
            push(frame, top)
            return push(frame, below)
        if opcode == 0x10:
            return push(frame, frame.locals[operand(code, pc)])
        if opcode == 0x11:
            frame.locals[operand(code, pc)] = pop(frame)
            return
        if opcode == 0x12:
            name = self.constants[operand(code, pc)].data
            if name not in self.globals:
                raise SvmError("E_UNDEF_GLOBAL", name.decode("latin-1"))
            return push(frame, self.globals[name])
        if opcode == 0x13:
            self.globals[self.constants[operand(code, pc)].data] = pop(frame)
            return
        if opcode == 0x14:
            return push(frame, frame.closure.upvalues[operand(code, pc)])
        if opcode == 0x15:
            frame.closure.upvalues[operand(code, pc)] = pop(frame)
            return
        if 0x20 <= opcode <= 0x2C:
            return self._arithmetic(frame, opcode)
        if 0x30 <= opcode <= 0x35:
            return self._comparison(frame, opcode)
        if opcode == 0x40:
            frame.pc = pc + 3 + operand(code, pc)
            return
        if opcode == 0x41 or opcode == 0x42:
            taken = truthy(pop(frame))
            if taken == (opcode == 0x42):
                frame.pc = pc + 3 + operand(code, pc)
            return
        if opcode == 0x50:
            return self._call(frame, operand(code, pc))
        if opcode == 0x51:
            return self._ret(frame)
        if opcode == 0x52:
            return self._closure(frame, operand(code, pc))
        if 0x60 <= opcode <= 0x65:
            return self._array(frame, opcode, code, pc)
        if 0x70 <= opcode <= 0x76:
            return self._strings(frame, opcode)
        if opcode == 0x80 or opcode == 0x81:
            value = pop(frame)
            self.out.write(display(value, self.names))
            if opcode == 0x80:
                self.out.write(b"\n")
            return
        if opcode == 0x82:
            value = pop(frame)
            text = Str(type_name(value).encode("ascii"))
            return push(frame, self.heap.allocate(text, (value,)))
        if opcode == 0x83:
            if not truthy(pop(frame)):
                raise SvmError("E_ASSERT", "assertion failed")
            return
        if opcode == 0x90:
            self.heap.collect()
            return
        if opcode == 0x91:
            return push(frame, self.heap.collect())
        raise Halt()  # 0x92 HALT; validation has already refused any other byte

    def _arithmetic(self, frame, opcode):
        pop = self._pop
        if opcode in (0x25, 0x26, 0x2A):
            value = pop(frame)
            if opcode == 0x26:
                return self._push(frame, not truthy(value))
            number = self._int(value)
            return self._push(
                frame, wrap(-number) if opcode == 0x25 else wrap(~number)
            )
        right = pop(frame)
        left = pop(frame)
        left = self._int(left)
        right = self._int(right)
        if opcode == 0x20:
            result = left + right
        elif opcode == 0x21:
            result = left - right
        elif opcode == 0x22:
            result = left * right
        elif opcode == 0x23 or opcode == 0x24:
            if right == 0:
                raise SvmError("E_DIV_ZERO", "division by zero")
            quotient = abs(left) // abs(right)
            if (left < 0) != (right < 0):
                quotient = -quotient
            if opcode == 0x23:
                result = quotient
            else:
                result = left - quotient * right
        elif opcode == 0x27:
            result = left & right
        elif opcode == 0x28:
            result = left | right
        elif opcode == 0x29:
            result = left ^ right
        else:
            if not 0 <= right <= 63:
                raise SvmError("E_RANGE", "shift count %d" % right)
            result = left << right if opcode == 0x2B else left >> right
        return self._push(frame, wrap(result))

    def _comparison(self, frame, opcode):
        right = self._pop(frame)
        left = self._pop(frame)
        if opcode == 0x30:
            return self._push(frame, equal(left, right))
        if opcode == 0x31:
            return self._push(frame, not equal(left, right))
        name = {0x32: "LT", 0x33: "LE", 0x34: "GT", 0x35: "GE"}[opcode]
        return self._push(frame, compare(left, right, name))

    def _call(self, frame, count):
        arguments = [self._pop(frame) for _ in range(count)]
        arguments.reverse()
        callee = self._pop(frame)
        if not isinstance(callee, Closure):
            raise SvmError("E_TYPE", "callee is %s" % type_name(callee))
        function = self.module.functions[callee.function]
        if count != function.arity:
            raise SvmError("E_ARITY", "called with %d of %d" % (count, function.arity))
        if len(self.frames) >= self.max_depth:
            raise SvmError("E_STACK_OVERFLOW", "call depth of %d" % self.max_depth)
        self.frames.append(
            Frame(callee, callee.function, function.code, function.num_locals, arguments)
        )

    def _ret(self, frame):
        value = frame.stack[-1] if frame.stack else None
        self.frames.pop()
        if not self.frames:
            return
        self._push(self.frames[-1], value)

    def _closure(self, frame, index):
        function = self.module.functions[index]
        captured = []
        for kind, slot in function.upvalues:
            source = frame.locals if kind == 0 else frame.closure.upvalues
            if slot >= len(source):
                # Section 13 check 19 refuses this module before it runs. The
                # guard is here so a module that reached execution anyway still
                # ends with one `error:` line rather than a host-level fault.
                raise SvmError(
                    "E_BAD_CODE",
                    "function %d captures %s %d, which the creating frame does "
                    "not have" % (index, "local" if kind == 0 else "upvalue", slot),
                )
            captured.append(source[slot])
        closure = Closure(index, captured)
        self._push(frame, self.heap.allocate(closure, tuple(captured)))

    def _array(self, frame, opcode, code, pc):
        pop = self._pop
        if opcode == 0x60:
            count = operand(code, pc)
            items = [pop(frame) for _ in range(count)]
            items.reverse()
            array = Arr(items)
            return self._push(frame, self.heap.allocate(array, tuple(items)))
        if opcode == 0x61:
            index = pop(frame)
            array = pop(frame)
            self._check_array(array, index)
            if not 0 <= index < len(array.items):
                raise SvmError("E_RANGE", "index %d" % index)
            return self._push(frame, array.items[index])
        if opcode == 0x62:
            value = pop(frame)
            index = pop(frame)
            array = pop(frame)
            self._check_array(array, index)
            if not 0 <= index < len(array.items):
                raise SvmError("E_RANGE", "index %d" % index)
            array.items[index] = value
            return
        if opcode == 0x63:
            value = pop(frame)
            array = pop(frame)
            if not isinstance(array, Arr):
                raise SvmError("E_TYPE", "not an array: %s" % type_name(array))
            array.items.append(value)
            return
        if opcode == 0x64:
            array = pop(frame)
            if not isinstance(array, Arr):
                raise SvmError("E_TYPE", "not an array: %s" % type_name(array))
            if not array.items:
                raise SvmError("E_RANGE", "pop from an empty array")
            return self._push(frame, array.items.pop())
        value = pop(frame)
        if isinstance(value, Str):
            return self._push(frame, len(value.data))
        if isinstance(value, Arr):
            return self._push(frame, len(value.items))
        raise SvmError("E_TYPE", "LEN of %s" % type_name(value))

    @staticmethod
    def _check_array(array, index):
        if not isinstance(array, Arr):
            raise SvmError("E_TYPE", "not an array: %s" % type_name(array))
        if type_name(index) != "int":
            raise SvmError("E_TYPE", "index is %s" % type_name(index))

    def _strings(self, frame, opcode):
        pop = self._pop
        if opcode == 0x70:
            right = self._string(pop(frame))
            left = self._string(pop(frame))
            joined = Str(left.data + right.data)
            return self._push(frame, self.heap.allocate(joined, (left, right)))
        if opcode == 0x71:
            length = pop(frame)
            start = pop(frame)
            subject = pop(frame)
            self._string(subject)
            self._int(start)
            self._int(length)
            if start < 0 or length < 0 or start + length > len(subject.data):
                raise SvmError("E_RANGE", "substring %d,%d" % (start, length))
            piece = Str(subject.data[start : start + length])
            return self._push(frame, self.heap.allocate(piece, (subject,)))
        if opcode == 0x72:
            needle = self._string(pop(frame))
            haystack = self._string(pop(frame))
            return self._push(frame, haystack.data.find(needle.data))
        if opcode == 0x73:
            value = pop(frame)
            text = Str(display(value, self.names))
            return self._push(frame, self.heap.allocate(text, (value,)))
        if opcode == 0x74:
            return self._push(frame, self._to_int(pop(frame)))
        if opcode == 0x75:
            code_point = self._int(pop(frame))
            if not 0 <= code_point <= 255:
                raise SvmError("E_RANGE", "CHR %d" % code_point)
            return self._push(frame, self.heap.allocate(Str(bytes((code_point,)))))
        subject = self._string(pop(frame))
        if not subject.data:
            raise SvmError("E_RANGE", "ORD of the empty string")
        return self._push(frame, subject.data[0])

    def _to_int(self, value):
        kind = type_name(value)
        if kind == "int":
            return value
        if kind == "bool":
            return 1 if value else 0
        if kind != "str":
            raise SvmError("E_TYPE", "TOINT of %s" % kind)
        text = value.data
        body = text[1:] if text[:1] in (b"-", b"+") else text
        if not body or not body.isdigit():
            raise SvmError("E_VALUE", "TOINT of %r" % text)
        number = int(body.decode("ascii"))
        if text[:1] == b"-":
            number = -number
        if not INT_MIN <= number <= INT_MAX:
            raise SvmError("E_RANGE", "TOINT out of range")
        return number


_NARROW = frozenset(
    opcode for opcode, (name, layout) in BY_OPCODE.items() if layout == "u8"
)
_WIDE = frozenset(
    opcode for opcode, (name, layout) in BY_OPCODE.items() if layout in ("u16", "i16")
)
