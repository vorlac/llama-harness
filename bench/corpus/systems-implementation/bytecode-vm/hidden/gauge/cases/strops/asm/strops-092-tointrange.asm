; case strops-092-tointrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "99999999999999999999999"
  TOINT
  PRINT
  RET
.end
