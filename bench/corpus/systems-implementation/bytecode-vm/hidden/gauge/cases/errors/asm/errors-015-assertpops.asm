; case errors-015-assertpops
; expect exit=0 stdout="5\n"
.func main arity=0 locals=0
  PUSH_INT 5
  PUSH_TRUE
  ASSERT
  PRINT
  RET
.end
