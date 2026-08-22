; case asmerr-044-intwherestr
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_STR 1
  POP
  RET
.end
