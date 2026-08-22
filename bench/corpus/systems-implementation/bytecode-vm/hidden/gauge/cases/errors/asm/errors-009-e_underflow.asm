; case errors-009-e_underflow
; expect exit=4 stdout="before\n"
; expect error=E_UNDERFLOW
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  POP
  RET
.end
