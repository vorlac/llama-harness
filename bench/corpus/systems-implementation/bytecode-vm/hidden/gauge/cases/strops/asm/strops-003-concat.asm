; case strops-003-concat
; expect exit=0 stdout="a\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR "a"
  CONCAT
  PRINT
  RET
.end
