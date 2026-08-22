; case asmerr-027-arityoverlocals
; expect exit=2 stdout=""
; expect error=E_ASM
.func f arity=3 locals=2
  RET
.end
