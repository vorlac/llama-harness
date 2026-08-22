; case arith-101-div
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_INT 6
  PUSH_INT 3
  DIV
  PRINT
  RET
.end
