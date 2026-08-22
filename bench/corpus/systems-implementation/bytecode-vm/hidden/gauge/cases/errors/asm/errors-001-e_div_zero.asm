; case errors-001-e_div_zero
; expect exit=4 stdout="before\n"
; expect error=E_DIV_ZERO
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_INT 1
  PUSH_INT 0
  DIV
  RET
.end
