; case bitwise-043-bnot
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT 0
  BNOT
  PRINT
  RET
.end
