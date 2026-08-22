; case compare-156-nemixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_TRUE
  NE
  PRINT
  RET
.end
