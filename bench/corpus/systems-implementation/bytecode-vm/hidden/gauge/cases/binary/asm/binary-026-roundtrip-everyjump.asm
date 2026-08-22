; case binary-026-roundtrip-everyjump
; expect exit=0 stdout=""
.func main arity=0 locals=1
  PUSH_TRUE
  JMP_IF_TRUE a
  JMP b
a:
  PUSH_FALSE
  JMP_IF_FALSE c
  JMP b
c:
  PUSH_INT 1
  STORE_LOCAL 0
b:
  LOAD_LOCAL 0
  PRINT
  RET
.end
