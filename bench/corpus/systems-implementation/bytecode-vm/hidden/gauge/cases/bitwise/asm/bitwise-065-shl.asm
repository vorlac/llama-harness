; case bitwise-065-shl
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 2
  PUSH_INT 63
  SHL
  PRINT
  RET
.end
