; case asmerr-004-extraoperand2
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT 1 2
  RET
.end
