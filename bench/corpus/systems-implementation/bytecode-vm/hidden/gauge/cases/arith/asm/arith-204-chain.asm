; case arith-204-chain
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 1
  ADD
  PUSH_INT 1
  SUB
  PUSH_INT 2
  MUL
  PRINT
  RET
.end
