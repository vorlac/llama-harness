; case compare-183-getype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_NIL
  PUSH_NIL
  GE
  PRINT
  RET
.end
