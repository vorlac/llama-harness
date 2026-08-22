; case asmerr-015-strayend
; expect exit=2 stdout=""
; expect error=E_ASM
.end
.func main arity=0 locals=0
  RET
.end
