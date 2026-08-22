; case compare-172-letype
; expect exit=4 stdout=""
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_FALSE
  LE
  PRINT
  RET
.end
