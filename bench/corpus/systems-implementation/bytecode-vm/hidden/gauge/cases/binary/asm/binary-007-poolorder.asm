; case binary-007-poolorder
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 7
  POP
  CLOSURE second
  POP
  RET
.end
.func second arity=0 locals=0
  PUSH_INT 8
  RET
.end
