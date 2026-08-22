; case arith-063-sub
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT 1000000007
  PUSH_INT 1000000009
  SUB
  PRINT
  RET
.end
