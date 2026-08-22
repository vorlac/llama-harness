; case strops-079-tointbad
; expect exit=4 stdout=""
; expect error=E_VALUE
.func main arity=0 locals=0
  PUSH_STR ""
  TOINT
  PRINT
  RET
.end
