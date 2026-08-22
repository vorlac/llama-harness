; case bitwise-018-bor
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT -1
  PUSH_INT -1
  BOR
  PRINT
  RET
.end
