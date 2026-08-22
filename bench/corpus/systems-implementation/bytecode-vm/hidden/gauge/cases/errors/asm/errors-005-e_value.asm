; case errors-005-e_value
; expect exit=4 stdout="before\n"
; expect error=E_VALUE
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_STR "x"
  TOINT
  RET
.end
