; case asmerr-046-globalempty
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  LOAD_GLOBAL ""
  RET
.end
