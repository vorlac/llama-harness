; case bitwise-064-shl
; expect exit=0 stdout="7\n"
.func main arity=0 locals=0
  PUSH_INT 7
  PUSH_INT 0
  SHL
  PRINT
  RET
.end
