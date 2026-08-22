; case asmerr-002-missingoperand
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT
  RET
.end
