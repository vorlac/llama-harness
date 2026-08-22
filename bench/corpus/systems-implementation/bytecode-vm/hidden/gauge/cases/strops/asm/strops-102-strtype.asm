; case strops-102-strtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 0
  PUSH_INT 0
  SUBSTR
  PRINT
  RET
.end
