; case arith-074-mul
; expect exit=0 stdout="-21\n"
.func main arity=0 locals=0
  PUSH_INT 7
  PUSH_INT -3
  MUL
  PRINT
  RET
.end
