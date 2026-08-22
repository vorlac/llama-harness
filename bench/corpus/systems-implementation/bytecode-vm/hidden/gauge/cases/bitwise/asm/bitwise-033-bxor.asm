; case bitwise-033-bxor
; expect exit=0 stdout="6\n"
.func main arity=0 locals=0
  PUSH_INT 12
  PUSH_INT 10
  BXOR
  PRINT
  RET
.end
