; case bitwise-053-shl
; expect exit=0 stdout="2147483648\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 31
  SHL
  PRINT
  RET
.end
