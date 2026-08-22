; case bitwise-044-bnot
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT 1
  BNOT
  PRINT
  RET
.end
