; case bitwise-019-bor
; expect exit=0 stdout="14\n"
.func main arity=0 locals=0
  PUSH_INT 12
  PUSH_INT 10
  BOR
  PRINT
  RET
.end
