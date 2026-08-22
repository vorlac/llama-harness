; case arrays-039-lenoftype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  LEN
  PRINT
  RET
.end
