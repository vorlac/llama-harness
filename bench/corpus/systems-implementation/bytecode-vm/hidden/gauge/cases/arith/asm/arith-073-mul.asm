; case arith-073-mul
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT -1
  PUSH_INT -1
  MUL
  PRINT
  RET
.end
