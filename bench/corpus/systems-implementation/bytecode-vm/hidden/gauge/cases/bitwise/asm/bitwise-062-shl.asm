; case bitwise-062-shl
; expect exit=0 stdout="13573471044894720\n"
.func main arity=0 locals=0
  PUSH_INT 12345
  PUSH_INT 40
  SHL
  PRINT
  RET
.end
