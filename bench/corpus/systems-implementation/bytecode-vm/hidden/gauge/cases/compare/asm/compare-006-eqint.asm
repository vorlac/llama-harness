; case compare-006-eqint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT -1
  PUSH_INT -1
  EQ
  PRINT
  RET
.end
