; case asmerr-013-unknowndirective
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  .weird 1
  RET
.end
