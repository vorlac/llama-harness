; case arith-165-neg
; expect exit=0 stdout="42\n"
.func main arity=0 locals=0
  PUSH_INT -42
  NEG
  PRINT
  RET
.end
