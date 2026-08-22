; case bitwise-080-shr
; expect exit=0 stdout="-2\n"
.func main arity=0 locals=0
  PUSH_INT -7
  PUSH_INT 2
  SHR
  PRINT
  RET
.end
