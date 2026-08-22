; case compare-155-eqmixed
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_TRUE
  EQ
  PRINT
  RET
.end
