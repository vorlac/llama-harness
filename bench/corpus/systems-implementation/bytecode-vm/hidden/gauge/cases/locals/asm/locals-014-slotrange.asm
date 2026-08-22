; case locals-014-slotrange
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_LOCAL 0
  RET
.end
