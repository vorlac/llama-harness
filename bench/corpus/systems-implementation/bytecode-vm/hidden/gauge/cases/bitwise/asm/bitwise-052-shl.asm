; case bitwise-052-shl
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 1
  SHL
  PRINT
  RET
.end
