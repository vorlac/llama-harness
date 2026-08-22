; case locals-013-slotrange
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=2
  LOAD_LOCAL 2
  PRINT
  RET
.end
