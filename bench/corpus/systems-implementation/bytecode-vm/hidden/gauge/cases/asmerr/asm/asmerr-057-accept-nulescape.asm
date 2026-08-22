; case asmerr-057-accept-nulescape
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_STR "a\0b"
  POP
  RET
.end
