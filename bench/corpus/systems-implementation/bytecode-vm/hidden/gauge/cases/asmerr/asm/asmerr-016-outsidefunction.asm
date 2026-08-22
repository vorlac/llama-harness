; case asmerr-016-outsidefunction
; expect exit=2 stdout=""
; expect error=E_ASM
  PUSH_INT 1
.func main arity=0 locals=0
  RET
.end
