; case bitwise-046-bnot
; expect exit=0 stdout="-43\n"
.func main arity=0 locals=0
  PUSH_INT 42
  BNOT
  PRINT
  RET
.end
