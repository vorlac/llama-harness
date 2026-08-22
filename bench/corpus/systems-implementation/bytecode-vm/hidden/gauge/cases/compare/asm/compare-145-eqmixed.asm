; case compare-145-eqmixed
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_NIL
  PUSH_NIL
  EQ
  PRINT
  RET
.end
