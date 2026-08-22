; case arith-198-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_FALSE
  MOD
  PRINT
  RET
.end
