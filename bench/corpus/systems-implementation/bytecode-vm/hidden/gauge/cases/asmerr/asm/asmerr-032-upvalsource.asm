; case asmerr-032-upvalsource
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  CLOSURE f
  RET
.end
.func f arity=0 locals=0 upvals=1
  .upval local 0
  RET
.end
