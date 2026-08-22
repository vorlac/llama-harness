; case asmerr-003-extraoperand
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  RET 1
.end
