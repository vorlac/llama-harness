; case arith-037-sub
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT 2
  PUSH_INT 3
  SUB
  PRINT
  RET
.end
