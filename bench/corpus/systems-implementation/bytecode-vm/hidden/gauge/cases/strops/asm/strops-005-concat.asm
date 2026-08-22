; case strops-005-concat
; expect exit=0 stdout="hello, world\n"
.func main arity=0 locals=0
  PUSH_STR "hello, "
  PUSH_STR "world"
  CONCAT
  PRINT
  RET
.end
