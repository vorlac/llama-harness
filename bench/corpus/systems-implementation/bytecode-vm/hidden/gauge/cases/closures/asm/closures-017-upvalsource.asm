; case closures-017-upvalsource
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  CLOSURE f
  CALL 0
  PRINT
  RET
.end
.func f arity=0 locals=0 upvals=1
  .upval local 0
  PUSH_INT 1
  RET
.end
