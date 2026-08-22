; case arith-031-add
; expect exit=0 stdout="2000000016\n"
.func main arity=0 locals=0
  PUSH_INT 1000000007
  PUSH_INT 1000000009
  ADD
  PRINT
  RET
.end
