; case bitwise-054-shl
; expect exit=0 stdout="4294967296\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 32
  SHL
  PRINT
  RET
.end
