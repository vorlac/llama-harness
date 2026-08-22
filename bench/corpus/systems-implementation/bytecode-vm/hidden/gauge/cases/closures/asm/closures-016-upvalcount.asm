; case closures-016-upvalcount
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  CLOSURE f
  CALL 0
  PRINT
  RET
.end
.func f arity=0 locals=0 upvals=2
  .upval local 0
  LOAD_UPVAL 0
  RET
.end
