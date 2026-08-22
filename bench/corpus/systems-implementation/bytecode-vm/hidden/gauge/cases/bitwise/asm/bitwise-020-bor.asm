; case bitwise-020-bor
; expect exit=0 stdout="255\n"
.func main arity=0 locals=0
  PUSH_INT 255
  PUSH_INT 15
  BOR
  PRINT
  RET
.end
