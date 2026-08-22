; case errors-003-e_type
; expect exit=4 stdout="before\n"
; expect error=E_TYPE
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  PUSH_NIL
  PUSH_INT 1
  ADD
  RET
.end
