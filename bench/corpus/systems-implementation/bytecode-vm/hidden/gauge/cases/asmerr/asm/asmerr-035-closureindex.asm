; case asmerr-035-closureindex
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  CLOSURE #7
  RET
.end
