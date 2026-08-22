; case arith-014-add
; expect exit=0 stdout="125\n"
.func main arity=0 locals=0
  PUSH_INT 25
  PUSH_INT 100
  ADD
  PRINT
  RET
.end
