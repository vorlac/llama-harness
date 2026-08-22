; case arith-197-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_INT 1
  MOD
  PRINT
  RET
.end
