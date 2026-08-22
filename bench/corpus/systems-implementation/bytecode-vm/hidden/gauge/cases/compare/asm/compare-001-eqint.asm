; case compare-001-eqint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  EQ
  PRINT
  RET
.end
