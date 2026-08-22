; case asmerr-059-accept-hexintwrap
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 0xffffffffffffffff
  POP
  RET
.end
