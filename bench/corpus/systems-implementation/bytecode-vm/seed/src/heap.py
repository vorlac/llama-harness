# The object heap of SPEC.md section 9: a mark-and-sweep collector whose counts
# are observable through GCLIVE and whose budget is observable through --heap.
#
# Permanent objects - the constant-pool strings and the entry closure - are
# never in `objects`, so they are never counted, never charged and never swept,
# which is what section 9.1 asks for. Neither kind references a heap object, so
# marking never has to traverse one.

from errors import SvmError
from values import Arr, Closure, Str


class Heap:
    def __init__(self, limit: int, stress: bool, roots):
        self.limit = limit
        self.stress = stress
        # A callable returning every root of section 9.3 items 1 to 4. The
        # operands of the instruction being executed are item 5 and are passed
        # to `allocate` by the instruction itself.
        self.roots = roots
        self.objects = []

    def allocate(self, obj, extra=()):
        if self.stress or len(self.objects) >= self.limit:
            self.collect(extra)
        if len(self.objects) >= self.limit:
            raise SvmError("E_OOM", "heap of %d objects is full" % self.limit)
        self.objects.append(obj)
        return obj

    def collect(self, extra=()) -> int:
        marked = set()
        pending = list(self.roots())
        pending.extend(extra)
        while pending:
            value = pending.pop()
            if not isinstance(value, (Str, Arr, Closure)):
                continue
            if value.permanent or id(value) in marked:
                continue
            marked.add(id(value))
            if isinstance(value, Arr):
                pending.extend(value.items)
            elif isinstance(value, Closure):
                pending.extend(value.upvalues)
        self.objects = [obj for obj in self.objects if id(obj) in marked]
        return len(self.objects)
