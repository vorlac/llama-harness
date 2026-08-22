; case bitwise-037-bxor
; expect exit=0 stdout="-9223372036854775807\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 1
  BXOR
  PRINT
  RET
.end
