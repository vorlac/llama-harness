; case asmerr-040-intoverflow
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT 9223372036854775808
  POP
  RET
.end
