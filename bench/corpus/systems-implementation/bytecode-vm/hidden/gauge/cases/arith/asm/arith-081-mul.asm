; case arith-081-mul
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 4294967296
  PUSH_INT 4294967296
  MUL
  PRINT
  RET
.end
