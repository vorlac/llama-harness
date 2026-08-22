; case arith-205-chain
; expect exit=0 stdout="7\n"
.func main arity=0 locals=0
  PUSH_INT 3
  PUSH_INT 4
  ADD
  PUSH_INT 5
  MUL
  PUSH_INT 7
  SUB
  PUSH_INT 4
  DIV
  PRINT
  RET
.end
