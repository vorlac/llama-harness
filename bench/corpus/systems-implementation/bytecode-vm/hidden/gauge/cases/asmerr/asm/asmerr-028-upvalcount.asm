; case asmerr-028-upvalcount
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=1
  CLOSURE f
  RET
.end
.func f arity=0 locals=0 upvals=2
  .upval local 0
  RET
.end
