; case compare-146-nemixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_NIL
  PUSH_NIL
  NE
  PRINT
  RET
.end
