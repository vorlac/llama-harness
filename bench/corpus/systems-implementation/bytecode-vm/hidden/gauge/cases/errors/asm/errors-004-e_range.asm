; case errors-004-e_range
; expect exit=4 stdout="before\n"
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_INT 1
  PUSH_INT 64
  SHL
  RET
.end
