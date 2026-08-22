; case bitwise-050-bnot
; expect exit=0 stdout="-256\n"
.func main arity=0 locals=0
  PUSH_INT 255
  BNOT
  PRINT
  RET
.end
