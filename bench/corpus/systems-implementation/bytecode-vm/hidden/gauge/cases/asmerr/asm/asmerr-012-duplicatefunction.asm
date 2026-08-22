; case asmerr-012-duplicatefunction
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  RET
.end
.func f arity=0 locals=0
  RET
.end
.func f arity=0 locals=0
  RET
.end
