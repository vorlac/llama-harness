; case arith-038-sub
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 3
  PUSH_INT 2
  SUB
  PRINT
  RET
.end
