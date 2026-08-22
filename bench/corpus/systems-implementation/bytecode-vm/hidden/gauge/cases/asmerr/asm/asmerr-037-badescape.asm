; case asmerr-037-badescape
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_STR "a\qb"
  RET
.end
