; case bitwise-060-shl
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 1
  SHL
  PRINT
  RET
.end
