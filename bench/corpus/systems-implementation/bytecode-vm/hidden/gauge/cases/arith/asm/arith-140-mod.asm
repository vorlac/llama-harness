; case arith-140-mod
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT -100
  PUSH_INT 7
  MOD
  PRINT
  RET
.end
