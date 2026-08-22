; case asmerr-001-unknownop
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  FROBNICATE
  RET
.end
