; case locals-015-slotrange
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=2
  LOAD_LOCAL 256
  PRINT
  RET
.end
