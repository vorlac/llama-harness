; case arith-163-neg
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT -1
  NEG
  PRINT
  RET
.end
