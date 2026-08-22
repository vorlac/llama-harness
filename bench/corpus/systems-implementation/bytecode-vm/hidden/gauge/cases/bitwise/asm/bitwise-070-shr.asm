; case bitwise-070-shr
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_INT -256
  PUSH_INT 8
  SHR
  PRINT
  RET
.end
