; case bitwise-081-shr
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 7
  PUSH_INT 3
  SHR
  PRINT
  RET
.end
