; case strops-066-ord
; expect exit=0 stdout="65\n"
.func main arity=0 locals=0
  PUSH_STR "AB"
  ORD
  PRINT
  RET
.end
