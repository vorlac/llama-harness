; case arith-078-mul
; expect exit=0 stdout="2500\n"
.func main arity=0 locals=0
  PUSH_INT 25
  PUSH_INT 100
  MUL
  PRINT
  RET
.end
