; case strops-052-chrord
; expect exit=0 stdout="10\n"
.func main arity=0 locals=0
  PUSH_INT 10
  CHR
  ORD
  PRINT
  RET
.end
