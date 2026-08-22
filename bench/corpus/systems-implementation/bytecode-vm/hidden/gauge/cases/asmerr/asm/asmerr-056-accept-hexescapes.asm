; case asmerr-056-accept-hexescapes
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_STR "\x00\xff\xA0"
  POP
  RET
.end
