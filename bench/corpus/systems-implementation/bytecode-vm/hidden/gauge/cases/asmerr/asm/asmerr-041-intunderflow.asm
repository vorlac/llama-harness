; case asmerr-041-intunderflow
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT -9223372036854775809
  POP
  RET
.end
