; case asmerr-011-duplicatelabel
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
l:
  NOP
l:
  JMP l
  RET
.end
