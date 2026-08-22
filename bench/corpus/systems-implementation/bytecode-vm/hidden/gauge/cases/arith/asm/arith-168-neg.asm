; case arith-168-neg
; expect exit=0 stdout="-4294967296\n"
.func main arity=0 locals=0
  PUSH_INT 4294967296
  NEG
  PRINT
  RET
.end
