; case arith-042-sub
; expect exit=0 stdout="10\n"
.func main arity=0 locals=0
  PUSH_INT 7
  PUSH_INT -3
  SUB
  PRINT
  RET
.end
