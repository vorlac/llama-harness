; case compare-150-nemixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_TRUE
  NE
  PRINT
  RET
.end
