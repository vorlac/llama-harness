; case asmerr-018-entryarity
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=1 locals=1
  RET
.end
