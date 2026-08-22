; case arith-118-div
; expect exit=0 stdout="14\n"
.func main arity=0 locals=0
  PUSH_INT -100
  PUSH_INT -7
  DIV
  PRINT
  RET
.end
