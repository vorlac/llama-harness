; case asmerr-017-nestedfunc
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
.func inner arity=0 locals=0
  RET
.end
