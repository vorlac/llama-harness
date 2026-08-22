; case bitwise-067-shr
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 0
  SHR
  PRINT
  RET
.end
