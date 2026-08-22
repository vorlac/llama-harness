; case asmerr-034-closureunknown
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  CLOSURE nosuch
  RET
.end
