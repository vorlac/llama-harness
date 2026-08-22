; case errors-013-e_range
; expect exit=4 stdout="before\n"
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR "before"
  PRINT
  NEW_ARRAY 0
  PUSH_INT 0
  ARR_GET
  RET
.end
