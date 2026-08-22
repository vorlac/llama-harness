; case bitwise-040-bxor
; expect exit=0 stdout="-1032168870\n"
.func main arity=0 locals=0
  PUSH_INT 123456789
  PUSH_INT -987654321
  BXOR
  PRINT
  RET
.end
