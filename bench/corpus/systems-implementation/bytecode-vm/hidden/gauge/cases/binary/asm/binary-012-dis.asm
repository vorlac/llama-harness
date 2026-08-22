; case binary-012-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=1 upvals=0\n  PUSH_INT 3\n  STORE_LOCAL 0\nL0005:\n  LOAD_LOCAL 0\n  JMP_IF_FALSE L0018\n  LOAD_LOCAL 0\n  PRINT\n  LOAD_LOCAL 0\n  PUSH_INT 1\n  SUB\n  STORE_LOCAL 0\n  JMP L0005\nL0018:\n  RET\n.end\n"
.func main arity=0 locals=1
  PUSH_INT 3
  STORE_LOCAL 0
top:
  LOAD_LOCAL 0
  JMP_IF_FALSE out
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  STORE_LOCAL 0
  JMP top
out:
  RET
.end
