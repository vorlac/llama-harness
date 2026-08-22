; case bitwise-021-bor
; expect exit=0 stdout="1152657617789587455\n"
.func main arity=0 locals=0
  PUSH_INT 1085102592571150095
  PUSH_INT 71777214294589695
  BOR
  PRINT
  RET
.end
