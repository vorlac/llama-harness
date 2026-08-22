; case arith-012-add
; expect exit=0 stdout="-10\n"
.func main arity=0 locals=0
  PUSH_INT -7
  PUSH_INT -3
  ADD
  PRINT
  RET
.end
