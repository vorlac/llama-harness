; case strops-097-tointtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  NEW_ARRAY 0
  TOINT
  PRINT
  RET
.end
