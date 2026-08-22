; case arith-109-div
; expect exit=0 stdout="9223372036854775807\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 1
  DIV
  PRINT
  RET
.end
