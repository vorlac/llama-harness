; case arith-114-div
; expect exit=0 stdout="3074457345618258602\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 3
  DIV
  PRINT
  RET
.end
