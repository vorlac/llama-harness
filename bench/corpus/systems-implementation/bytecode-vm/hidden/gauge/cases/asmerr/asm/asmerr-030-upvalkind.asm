; case asmerr-030-upvalkind
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=1
  CLOSURE f
  RET
.end
.func f arity=0 locals=0 upvals=1
  .upval global 0
  RET
.end
