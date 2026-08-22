; case arith-064-sub
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 2147483647
  PUSH_INT 2147483647
  SUB
  PRINT
  RET
.end
