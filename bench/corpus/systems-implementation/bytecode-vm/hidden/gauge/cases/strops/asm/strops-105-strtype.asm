; case strops-105-strtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_INT 3
  LEN
  PRINT
  RET
.end
