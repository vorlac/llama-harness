; case compare-151-eqmixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_TRUE
  PUSH_FALSE
  EQ
  PRINT
  RET
.end
