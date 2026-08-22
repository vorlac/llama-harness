; case strops-004-concat
; expect exit=0 stdout="abcd\n"
.func main arity=0 locals=0
  PUSH_STR "ab"
  PUSH_STR "cd"
  CONCAT
  PRINT
  RET
.end
