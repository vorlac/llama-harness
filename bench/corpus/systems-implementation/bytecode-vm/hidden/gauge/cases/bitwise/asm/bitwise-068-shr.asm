; case bitwise-068-shr
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 1
  SHR
  PRINT
  RET
.end
