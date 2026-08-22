; case bitwise-034-bxor
; expect exit=0 stdout="240\n"
.func main arity=0 locals=0
  PUSH_INT 255
  PUSH_INT 15
  BXOR
  PRINT
  RET
.end
