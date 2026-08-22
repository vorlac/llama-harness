; case compare-147-eqmixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_NIL
  PUSH_FALSE
  EQ
  PRINT
  RET
.end
