; case asmerr-021-noterminator
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_INT 1
.end
