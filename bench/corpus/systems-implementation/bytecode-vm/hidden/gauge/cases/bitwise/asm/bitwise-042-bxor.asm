; case bitwise-042-bxor
; expect exit=0 stdout="2047\n"
.func main arity=0 locals=0
  PUSH_INT 1024
  PUSH_INT 1023
  BXOR
  PRINT
  RET
.end
