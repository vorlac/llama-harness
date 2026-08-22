; case bitwise-041-bxor
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT -8
  PUSH_INT 7
  BXOR
  PRINT
  RET
.end
