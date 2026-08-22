; case compare-158-nemixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_NIL
  NE
  PRINT
  RET
.end
