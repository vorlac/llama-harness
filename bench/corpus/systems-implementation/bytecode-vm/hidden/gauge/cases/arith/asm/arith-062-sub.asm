; case arith-062-sub
; expect exit=0 stdout="-6148914691236517208\n"
.func main arity=0 locals=0
  PUSH_INT -6148914691236517205
  PUSH_INT 3
  SUB
  PRINT
  RET
.end
