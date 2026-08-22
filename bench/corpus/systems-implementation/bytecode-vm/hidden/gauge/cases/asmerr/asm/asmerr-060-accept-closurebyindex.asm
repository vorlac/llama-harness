; case asmerr-060-accept-closurebyindex
; expect exit=0 stdout=""
.func main arity=0 locals=0
  CLOSURE #1
  POP
  RET
.end
.func other arity=0 locals=0
  RET
.end
