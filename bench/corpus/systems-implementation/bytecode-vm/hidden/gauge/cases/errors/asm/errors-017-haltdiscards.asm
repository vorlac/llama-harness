; case errors-017-haltdiscards
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  HALT
  RET
.end
