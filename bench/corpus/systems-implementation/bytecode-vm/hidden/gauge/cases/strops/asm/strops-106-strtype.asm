; case strops-106-strtype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_NIL
  LEN
  PRINT
  RET
.end
