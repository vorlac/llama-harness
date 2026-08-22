; case bitwise-014-band
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 1024
  PUSH_INT 1023
  BAND
  PRINT
  RET
.end
