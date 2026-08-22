; case asmerr-009-arraywidth
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  NEW_ARRAY 300
  RET
.end
