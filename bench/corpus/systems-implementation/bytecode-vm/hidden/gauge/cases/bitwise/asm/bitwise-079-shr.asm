; case bitwise-079-shr
; expect exit=0 stdout="-4\n"
.func main arity=0 locals=0
  PUSH_INT -7
  PUSH_INT 1
  SHR
  PRINT
  RET
.end
