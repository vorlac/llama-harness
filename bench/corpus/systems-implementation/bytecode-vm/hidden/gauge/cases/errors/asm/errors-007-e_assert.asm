; case errors-007-e_assert
; expect exit=4 stdout="before\n"
; expect error=E_ASSERT
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_FALSE
  ASSERT
  RET
.end
