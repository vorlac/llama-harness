; case calls-003-noargs
; expect exit=0 stdout="42\n"
.func main arity=0 locals=0
  CLOSURE answer
  CALL 0
  PRINT
  RET
.end
.func answer arity=0 locals=0
  PUSH_INT 42
  RET
.end
