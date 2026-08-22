; case strops-084-tointbad
; expect exit=4 stdout=""
; expect error=E_VALUE
.func main arity=0 locals=0
  PUSH_STR "1a"
  TOINT
  PRINT
  RET
.end
