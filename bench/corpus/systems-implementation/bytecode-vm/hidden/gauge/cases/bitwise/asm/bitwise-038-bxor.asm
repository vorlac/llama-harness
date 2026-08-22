; case bitwise-038-bxor
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT -9223372036854775808
  BXOR
  PRINT
  RET
.end
