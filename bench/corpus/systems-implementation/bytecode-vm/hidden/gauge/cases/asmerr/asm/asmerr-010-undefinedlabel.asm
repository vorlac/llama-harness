; case asmerr-010-undefinedlabel
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  JMP nowhere
  RET
.end
