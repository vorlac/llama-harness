; case arith-070-mul
; expect exit=0 stdout="6\n"
.func main arity=0 locals=0
  PUSH_INT 3
  PUSH_INT 2
  MUL
  PRINT
  RET
.end
