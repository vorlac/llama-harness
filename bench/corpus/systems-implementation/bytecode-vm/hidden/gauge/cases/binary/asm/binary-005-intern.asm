; case binary-005-intern
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 5
  PUSH_INT 5
  ADD
  PUSH_STR "a"
  PUSH_STR "a"
  CONCAT
  PRINT
  PRINT
  RET
.end
