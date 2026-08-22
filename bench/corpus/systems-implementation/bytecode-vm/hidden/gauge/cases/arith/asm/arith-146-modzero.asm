; case arith-146-modzero
; expect exit=4 stdout=""
; expect error=E_DIV_ZERO
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  MOD
  PRINT
  RET
.end
