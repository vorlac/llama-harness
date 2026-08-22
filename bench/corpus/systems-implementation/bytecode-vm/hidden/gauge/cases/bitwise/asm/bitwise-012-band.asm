; case bitwise-012-band
; expect exit=0 stdout="83985669\n"
.func main arity=0 locals=0
  PUSH_INT 123456789
  PUSH_INT -987654321
  BAND
  PRINT
  RET
.end
