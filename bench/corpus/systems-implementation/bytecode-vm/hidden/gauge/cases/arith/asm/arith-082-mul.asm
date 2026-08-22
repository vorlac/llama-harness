; case arith-082-mul
; expect exit=0 stdout="-12884901888\n"
.func main arity=0 locals=0
  PUSH_INT -4294967296
  PUSH_INT 3
  MUL
  PRINT
  RET
.end
