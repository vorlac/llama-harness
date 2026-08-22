; case strops-090-tointrange
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "9223372036854775808"
  TOINT
  PRINT
  RET
.end
