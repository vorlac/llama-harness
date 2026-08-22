; case binary-021-roundtrip-loop
; expect exit=0 stdout=""
.func main arity=0 locals=1
  PUSH_INT 10
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
