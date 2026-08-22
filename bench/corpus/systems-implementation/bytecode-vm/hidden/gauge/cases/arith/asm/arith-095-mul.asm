; case arith-095-mul
; expect exit=0 stdout="1000000016000000063\n"
.func main arity=0 locals=0
  PUSH_INT 1000000007
  PUSH_INT 1000000009
  MUL
  PRINT
  RET
.end
