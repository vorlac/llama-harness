; case arith-193-typeerr
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  PUSH_INT 1
  DIV
  PRINT
  RET
.end
