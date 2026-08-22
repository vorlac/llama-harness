; case bitwise-076-shr
; expect exit=0 stdout="-4611686018427387904\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PUSH_INT 1
  SHR
  PRINT
  RET
.end
