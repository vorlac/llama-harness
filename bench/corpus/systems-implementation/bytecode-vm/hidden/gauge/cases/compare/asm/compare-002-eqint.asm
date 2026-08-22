; case compare-002-eqint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 0
  EQ
  PRINT
  RET
.end
