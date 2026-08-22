; case strops-083-tointbad
; expect exit=4 stdout=""
; expect error=E_VALUE
.func main arity=0 locals=0
  PUSH_STR "1 "
  TOINT
  PRINT
  RET
.end
