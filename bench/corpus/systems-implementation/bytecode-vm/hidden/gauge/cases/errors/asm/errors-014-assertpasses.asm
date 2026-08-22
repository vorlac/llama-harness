; case errors-014-assertpasses
; expect exit=0 stdout="ok\n"
.func main arity=0 locals=0
  PUSH_TRUE
  ASSERT
  PUSH_INT 0
  ASSERT
  PUSH_STR ""
  ASSERT
  NEW_ARRAY 0
  ASSERT
  PUSH_STR "ok"
  PRINT
  RET
.end
