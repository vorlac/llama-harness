; case arith-065-mul
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  MUL
  PRINT
  RET
.end
