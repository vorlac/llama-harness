; case strops-068-ord
; expect exit=0 stdout="10\n"
.func main arity=0 locals=0
  PUSH_STR "\n"
  ORD
  PRINT
  RET
.end
