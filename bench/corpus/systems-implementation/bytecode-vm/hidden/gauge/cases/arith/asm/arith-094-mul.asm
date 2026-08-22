; case arith-094-mul
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT -6148914691236517205
  PUSH_INT 3
  MUL
  PRINT
  RET
.end
