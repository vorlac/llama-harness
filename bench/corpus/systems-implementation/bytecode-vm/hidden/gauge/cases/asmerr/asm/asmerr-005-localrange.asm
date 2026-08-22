; case asmerr-005-localrange
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=1
  LOAD_LOCAL 1
  RET
.end
