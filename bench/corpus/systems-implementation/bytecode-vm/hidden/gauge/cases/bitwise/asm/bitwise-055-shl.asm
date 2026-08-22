; case bitwise-055-shl
; expect exit=0 stdout="4611686018427387904\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 62
  SHL
  PRINT
  RET
.end
