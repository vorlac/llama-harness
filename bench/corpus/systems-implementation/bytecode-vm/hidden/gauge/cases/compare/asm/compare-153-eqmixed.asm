; case compare-153-eqmixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_FALSE
  EQ
  PRINT
  RET
.end
