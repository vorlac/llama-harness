; case asmerr-023-missinglocals
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0
  RET
.end
