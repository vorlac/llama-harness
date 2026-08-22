; case asmerr-048-storeupvalrange
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=1
  CLOSURE f
  RET
.end
.func f arity=0 locals=0 upvals=1
  .upval local 0
  PUSH_INT 1
  STORE_UPVAL 1
  RET
.end
