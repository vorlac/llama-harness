; case arith-013-add
; expect exit=0 stdout="125\n"
.func main arity=0 locals=0
  PUSH_INT 100
  PUSH_INT 25
  ADD
  PRINT
  RET
.end
