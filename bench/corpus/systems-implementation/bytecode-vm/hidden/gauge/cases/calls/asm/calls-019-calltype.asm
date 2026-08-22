; case calls-019-calltype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  CALL 1
  PRINT
  RET
.end
