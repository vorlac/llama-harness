; case compare-184-getype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_FALSE
  GE
  PRINT
  RET
.end
