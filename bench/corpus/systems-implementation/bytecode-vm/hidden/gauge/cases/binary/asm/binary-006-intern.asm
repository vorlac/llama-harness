; case binary-006-intern
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_STR "1"
  PRINT
  PRINT
  RET
.end
