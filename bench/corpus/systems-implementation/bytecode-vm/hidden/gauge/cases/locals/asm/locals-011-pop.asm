; case locals-011-pop
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  POP
  PRINT
  RET
.end
