; case bitwise-007-band
; expect exit=0 stdout="4222189076152335\n"
.func main arity=0 locals=0
  PUSH_INT 1085102592571150095
  PUSH_INT 71777214294589695
  BAND
  PRINT
  RET
.end
