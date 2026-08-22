; case arith-096-mul
; expect exit=0 stdout="4611686014132420609\n"
.func main arity=0 locals=0
  PUSH_INT 2147483647
  PUSH_INT 2147483647
  MUL
  PRINT
  RET
.end
