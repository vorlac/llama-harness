; case arith-017-add
; expect exit=0 stdout="8589934592\n"
.func main arity=0 locals=0
  PUSH_INT 4294967296
  PUSH_INT 4294967296
  ADD
  PRINT
  RET
.end
