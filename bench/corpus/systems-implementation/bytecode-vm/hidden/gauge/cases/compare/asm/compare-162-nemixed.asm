; case compare-162-nemixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_NIL
  NE
  PRINT
  RET
.end
