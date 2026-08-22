; case arith-045-sub
; expect exit=0 stdout="75\n"
.func main arity=0 locals=0
  PUSH_INT 100
  PUSH_INT 25
  SUB
  PRINT
  RET
.end
