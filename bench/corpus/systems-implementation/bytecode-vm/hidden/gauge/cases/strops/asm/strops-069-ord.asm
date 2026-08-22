; case strops-069-ord
; expect exit=0 stdout="32\n"
.func main arity=0 locals=0
  PUSH_STR " "
  ORD
  PRINT
  RET
.end
