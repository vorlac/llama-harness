; case errors-011-e_underflow
; expect exit=4 stdout="before\n"
; expect error=E_UNDERFLOW
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_INT 1
  ADD
  RET
.end
