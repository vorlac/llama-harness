; case compare-007-eqint
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT -9223372036854775808
  EQ
  PRINT
  RET
.end
