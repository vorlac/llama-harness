; case asmerr-058-accept-hexint
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 0x7fffffffffffffff
  POP
  RET
.end
