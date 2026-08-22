; case bitwise-029-bxor
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  BXOR
  PRINT
  RET
.end
