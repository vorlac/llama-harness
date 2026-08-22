; case errors-008-e_assert
; expect exit=4 stdout="before\n"
; expect error=E_ASSERT
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_NIL
  ASSERT
  RET
.end
