; case compare-152-nemixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_FALSE
  NE
  PRINT
  RET
.end
