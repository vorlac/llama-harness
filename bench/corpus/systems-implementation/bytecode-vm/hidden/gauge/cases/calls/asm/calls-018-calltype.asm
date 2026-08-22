; case calls-018-calltype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  CALL 0
  PRINT
  RET
.end
