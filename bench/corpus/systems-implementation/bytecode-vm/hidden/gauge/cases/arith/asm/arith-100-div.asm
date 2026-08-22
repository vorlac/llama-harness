; case arith-100-div
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_INT -7
  PUSH_INT -2
  DIV
  PRINT
  RET
.end
