; case arith-179-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_INT 1
  SUB
  PRINT
  RET
.end
