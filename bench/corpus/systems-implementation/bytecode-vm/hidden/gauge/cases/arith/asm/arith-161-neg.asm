; case arith-161-neg
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  NEG
  PRINT
  RET
.end
