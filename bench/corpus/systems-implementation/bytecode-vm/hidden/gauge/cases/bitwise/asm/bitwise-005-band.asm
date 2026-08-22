; case bitwise-005-band
; expect exit=0 stdout="8\n"
.func main arity=0 locals=0
  PUSH_INT 12
  PUSH_INT 10
  BAND
  PRINT
  RET
.end
