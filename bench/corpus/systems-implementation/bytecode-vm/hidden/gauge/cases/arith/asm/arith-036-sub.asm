; case arith-036-sub
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 1
  SUB
  PRINT
  RET
.end
