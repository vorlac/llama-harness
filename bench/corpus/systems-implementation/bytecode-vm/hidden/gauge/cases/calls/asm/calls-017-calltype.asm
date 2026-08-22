; case calls-017-calltype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  CALL 0
  PRINT
  RET
.end
