; case asmerr-026-hugelocals
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=257
  RET
.end
