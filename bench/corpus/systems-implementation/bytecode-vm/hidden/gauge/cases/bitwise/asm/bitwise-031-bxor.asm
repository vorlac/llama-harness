; case bitwise-031-bxor
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT -1
  PUSH_INT 0
  BXOR
  PRINT
  RET
.end
