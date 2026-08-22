; case bitwise-078-shr
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 63
  SHR
  PRINT
  RET
.end
