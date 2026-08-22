; case arith-079-mul
; expect exit=0 stdout="121932631112635269\n"
.func main arity=0 locals=0
  PUSH_INT 123456789
  PUSH_INT 987654321
  MUL
  PRINT
  RET
.end
