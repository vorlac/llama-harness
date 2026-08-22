; case asmerr-006-localwidth
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=1
  LOAD_LOCAL 256
  RET
.end
