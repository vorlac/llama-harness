; case calls-015-calltype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "f"
  CALL 0
  PRINT
  RET
.end
