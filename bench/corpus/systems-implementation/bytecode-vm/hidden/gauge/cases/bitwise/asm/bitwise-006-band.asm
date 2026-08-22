; case bitwise-006-band
; expect exit=0 stdout="15\n"
.func main arity=0 locals=0
  PUSH_INT 255
  PUSH_INT 15
  BAND
  PRINT
  RET
.end
