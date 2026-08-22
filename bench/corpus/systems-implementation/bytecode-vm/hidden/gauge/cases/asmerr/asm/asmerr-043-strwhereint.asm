; case asmerr-043-strwhereint
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT "1"
  POP
  RET
.end
