; case bitwise-002-band
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT -1
  BAND
  PRINT
  RET
.end
