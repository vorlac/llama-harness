; case arith-035-sub
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 1
  SUB
  PRINT
  RET
.end
