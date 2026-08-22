; case arith-108-div
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT -5
  DIV
  PRINT
  RET
.end
