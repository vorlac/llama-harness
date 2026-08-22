; case arith-046-sub
; expect exit=0 stdout="-75\n"
.func main arity=0 locals=0
  PUSH_INT 25
  PUSH_INT 100
  SUB
  PRINT
  RET
.end
