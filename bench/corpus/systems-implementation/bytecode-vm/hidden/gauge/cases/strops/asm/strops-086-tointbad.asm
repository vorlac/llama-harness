; case strops-086-tointbad
; expect exit=4 stdout=""
; expect error=E_VALUE
.func main arity=0 locals=0
  PUSH_STR "0x10"
  TOINT
  PRINT
  RET
.end
