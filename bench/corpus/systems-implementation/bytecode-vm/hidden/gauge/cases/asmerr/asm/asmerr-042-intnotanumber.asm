; case asmerr-042-intnotanumber
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT twelve
  POP
  RET
.end
