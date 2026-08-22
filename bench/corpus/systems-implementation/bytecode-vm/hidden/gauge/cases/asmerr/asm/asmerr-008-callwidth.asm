; case asmerr-008-callwidth
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  CALL 256
  RET
.end
