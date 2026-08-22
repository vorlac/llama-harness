; case bitwise-077-shr
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 62
  SHR
  PRINT
  RET
.end
