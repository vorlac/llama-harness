; case bitwise-056-shl
; expect exit=0 stdout="-9223372036854775808\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 63
  SHL
  PRINT
  RET
.end
