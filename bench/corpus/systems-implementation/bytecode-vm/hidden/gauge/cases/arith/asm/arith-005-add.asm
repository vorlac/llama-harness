; case arith-005-add
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  PUSH_INT 2
  PUSH_INT 3
  ADD
  PRINT
  RET
.end
