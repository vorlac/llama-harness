; case bitwise-008-band
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 1
  BAND
  PRINT
  RET
.end
