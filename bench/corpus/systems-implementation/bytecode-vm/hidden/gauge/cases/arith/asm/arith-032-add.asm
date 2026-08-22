; case arith-032-add
; expect exit=0 stdout="4294967294\n"
.func main arity=0 locals=0
  PUSH_INT 2147483647
  PUSH_INT 2147483647
  ADD
  PRINT
  RET
.end
