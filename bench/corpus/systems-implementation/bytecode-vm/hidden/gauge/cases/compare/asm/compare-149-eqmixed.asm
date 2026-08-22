; case compare-149-eqmixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_TRUE
  EQ
  PRINT
  RET
.end
