; case closures-014-upvalrange
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  LOAD_UPVAL 0
  PRINT
  RET
.end
