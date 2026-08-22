; case strops-008-concat
; expect exit=0 stdout="00\n"
.func main arity=0 locals=0
  PUSH_STR "0"
  PUSH_STR "0"
  CONCAT
  PRINT
  RET
.end
