; case bitwise-082-shr
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 63
  SHR
  PRINT
  RET
.end
