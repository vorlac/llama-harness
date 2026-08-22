; case asmerr-047-upvalrangeop
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  LOAD_UPVAL 0
  RET
.end
