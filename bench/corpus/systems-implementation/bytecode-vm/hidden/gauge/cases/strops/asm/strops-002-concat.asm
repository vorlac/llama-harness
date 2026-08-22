; case strops-002-concat
; expect exit=0 stdout="a\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR ""
  CONCAT
  PRINT
  RET
.end
