; case strops-067-ord
; expect exit=0 stdout="122\n"
.func main arity=0 locals=0
  PUSH_STR "z"
  ORD
  PRINT
  RET
.end
