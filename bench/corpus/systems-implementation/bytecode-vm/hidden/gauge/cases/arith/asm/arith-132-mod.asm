; case arith-132-mod
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT -5
  MOD
  PRINT
  RET
.end
