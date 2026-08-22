; case asmerr-025-negativelocals
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=-1
  RET
.end
