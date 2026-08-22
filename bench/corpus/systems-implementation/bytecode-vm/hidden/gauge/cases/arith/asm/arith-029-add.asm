; case arith-029-add
; expect exit=0 stdout="6148914691236517208\n"
.func main arity=0 locals=0
  PUSH_INT 6148914691236517205
  PUSH_INT 3
  ADD
  PRINT
  RET
.end
