; case errors-016-halt
; expect exit=0 stdout="one\n"
.func main arity=0 locals=0
  PUSH_STR "one"
  PRINT
  HALT
  PUSH_STR "two"
  PRINT
  RET
.end
