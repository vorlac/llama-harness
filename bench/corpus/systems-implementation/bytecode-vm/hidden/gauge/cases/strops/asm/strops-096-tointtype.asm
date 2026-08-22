; case strops-096-tointtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_NIL
  TOINT
  PRINT
  RET
.end
