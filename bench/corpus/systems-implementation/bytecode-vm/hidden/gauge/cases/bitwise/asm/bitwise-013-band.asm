; case bitwise-013-band
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT -8
  PUSH_INT 7
  BAND
  PRINT
  RET
.end
