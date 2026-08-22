; case bitwise-061-shl
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 1
  SHL
  PRINT
  RET
.end
