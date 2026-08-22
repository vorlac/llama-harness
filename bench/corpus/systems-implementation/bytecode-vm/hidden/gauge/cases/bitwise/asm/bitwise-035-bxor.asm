; case bitwise-035-bxor
; expect exit=0 stdout="1148435428713435120\n"
.func main arity=0 locals=0
  PUSH_INT 1085102592571150095
  PUSH_INT 71777214294589695
  BXOR
  PRINT
  RET
.end
