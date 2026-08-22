; case asmerr-031-upvalaftercode
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=1
  CLOSURE f
  RET
.end
.func f arity=0 locals=0 upvals=1
  NOP
  .upval local 0
  RET
.end
