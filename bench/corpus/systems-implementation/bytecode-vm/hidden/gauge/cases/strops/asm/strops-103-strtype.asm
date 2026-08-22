; case strops-103-strtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 65
  ORD
  PRINT
  RET
.end
