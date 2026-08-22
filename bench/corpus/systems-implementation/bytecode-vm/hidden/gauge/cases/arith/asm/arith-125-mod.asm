; case arith-125-mod
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 6
  PUSH_INT 3
  MOD
  PRINT
  RET
.end
