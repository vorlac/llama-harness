; case bitwise-015-bor
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 0
  BOR
  PRINT
  RET
.end
