; case strops-091-tointrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "-9223372036854775809"
  TOINT
  PRINT
  RET
.end
