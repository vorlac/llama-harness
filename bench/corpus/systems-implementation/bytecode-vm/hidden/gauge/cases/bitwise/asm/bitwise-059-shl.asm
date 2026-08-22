; case bitwise-059-shl
; expect exit=0 stdout="-72057594037927936\n"
.func main arity=0 locals=0
  PUSH_INT 255
  PUSH_INT 56
  SHL
  PRINT
  RET
.end
